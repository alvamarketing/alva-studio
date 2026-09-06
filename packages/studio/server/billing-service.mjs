import { billingAccessForCompany, enforcementIsValid } from './billing-policy.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';

function fail(message, status = 409) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function validEnvironment(value) {
  return value === 'sandbox' || value === 'production';
}

function cents(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value * 100)) return Math.round(value * 100);
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}

function paymentInput(payment, order, environment) {
  const amountCents = cents(payment.value);
  if (!payment?.id || !payment.status || !order || amountCents === null) return null;
  return {
    environment, orderId: order.id, providerPaymentId: payment.id, providerStatus: payment.status,
    amountCents, currency: payment.currency || 'BRL', providerCustomerId: payment.customer,
    providerSubscriptionId: payment.subscription, externalReference: payment.externalReference,
    currentPeriodStart: payment.paymentDate || payment.confirmedDate || payment.clientPaymentDate,
    currentPeriodEnd: payment.subscriptionCycleEnd || payment.dueDate,
    paidAt: payment.confirmedDate || payment.clientPaymentDate || null, dueDate: payment.dueDate || null,
  };
}

export class BillingService {
  constructor({ repository, enforcement = 'off', runtimeConfig, clientFactory, now = () => new Date() } = {}) {
    if (!repository) throw new Error('Repositório de cobrança obrigatório.');
    if (!['off', 'sandbox', 'production'].includes(enforcement)) throw new Error('BILLING_ENFORCEMENT inválido.');
    this.repository = repository;
    this.enforcement = enforcement;
    this.runtimeConfig = runtimeConfig;
    this.clientFactory = clientFactory;
    this.now = now;
  }

  config(environment = this.enforcement) {
    if (!validEnvironment(environment) || typeof this.runtimeConfig !== 'function') throw fail('Cobrança não está configurada.', 503);
    return this.runtimeConfig(environment);
  }

  client(environment = this.enforcement) {
    if (typeof this.clientFactory !== 'function') throw fail('Transporte de cobrança indisponível.', 503);
    return this.clientFactory(this.config(environment));
  }

  verifyWebhookToken(environment, token) {
    const expected = this.config(environment).webhookToken;
    const received = typeof token === 'string' ? token : '';
    const expectedBuffer = Buffer.from(String(expected));
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  async receiveWebhook({ environment, payload, raw }) {
    if (!validEnvironment(environment) || !payload || typeof payload !== 'object') throw fail('Evento de cobrança inválido.', 400);
    const providerEventId = payload.id;
    const eventType = payload.event;
    const providerPaymentId = payload.payment?.id ?? null;
    if (typeof providerEventId !== 'string' || typeof eventType !== 'string') throw fail('Evento de cobrança inválido.', 400);
    return this.repository.receiveInboxEvent({
      environment, providerEventId, eventType, providerPaymentId,
      payloadSha256: createHash('sha256').update(raw || JSON.stringify(payload)).digest('hex'),
    });
  }

  async overview({ companyId }) {
    const overview = await this.repository.getOverview({ companyId, environment: this.enforcement === 'off' ? 'sandbox' : this.enforcement });
    return {
      ...overview,
      access: billingAccessForCompany({ enforcement: this.enforcement, activation: overview.activation, plan: overview.plan, entitlement: overview.entitlement }),
    };
  }

  async checkout({ companyId, userId }) {
    if (this.enforcement === 'off') throw fail('Cobrança está desligada neste ambiente.');
    const overview = await this.repository.getOverview({ companyId, environment: this.enforcement });
    if (!enforcementIsValid(overview.activation, overview.plan)) throw fail('Cobrança não está liberada neste ambiente.');
    const order = await this.repository.prepareCheckout({ companyId, userId, environment: this.enforcement, now: this.now() });
    const claim = await this.repository.claimCheckout({ orderId: order.id });
    if (!claim.claimed) return claim.order ?? order;
    const customerId = await this.repository.customerForCompany({ companyId, environment: this.enforcement });
    const due = new Date(this.now());
    due.setUTCDate(due.getUTCDate() + 1);
    const checkout = await this.client().createSubscriptionCheckout({
      order: claim.order,
      ...(customerId ? { customerId } : {}),
      nextDueDate: due.toISOString().slice(0, 10),
    });
    return this.repository.saveCheckout({ orderId: claim.order.id, checkout });
  }

  async cancel({ companyId }) {
    if (this.enforcement === 'off') throw fail('Cobrança está desligada neste ambiente.');
    const subscription = await this.repository.cancellationTarget({ companyId, environment: this.enforcement });
    if (!subscription) throw fail('Não há assinatura ativa para cancelar.', 409);
    const endDate = new Date(subscription.currentPeriodEnd);
    if (Number.isNaN(endDate.getTime())) throw fail('Período da assinatura inválido.');
    await this.client().updateSubscriptionEndDate(subscription.providerSubscriptionId, endDate.toISOString().slice(0, 10));
    return this.repository.markCancelAtPeriodEnd({ companyId, environment: this.enforcement, subscriptionId: subscription.id });
  }

  async mutationAccess({ companyId, method, path }) {
    const overview = await this.overview({ companyId });
    const access = overview.access;
    if (access.accessState === 'read_only' && !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())
      && !(['POST'].includes(String(method).toUpperCase()) && ['/api/billing/checkout', '/api/billing/cancel', '/api/logout'].includes(path)))
      throw fail('Acesso de cobrança necessário.', 402);
    return access;
  }
}

export class BillingReconciliationWorker {
  constructor({ repository, clientForEnvironment }) {
    if (!repository || typeof clientForEnvironment !== 'function') throw new Error('Worker de cobrança inválido.');
    this.repository = repository;
    this.clientForEnvironment = clientForEnvironment;
  }

  async runOnce() {
    const claim = await this.repository.claimNextBillingJob();
    if (!claim.claimed) return { processed: 0 };
      const { job } = claim;
    try {
      const target = await this.repository.reconciliationTarget({ jobId: job.id });
      const client = this.clientForEnvironment(job.environment);
      let paymentId = target?.inbox?.providerPaymentId || null;
      if (!paymentId && target?.order) {
        const found = await client.findByExternalReference(target.order.externalReference);
        const candidates = Array.isArray(found?.data) ? found.data : [];
        const matching = candidates.filter((candidate) => candidate?.externalReference === target.order.externalReference);
        if (matching.length !== 1 || !matching[0]?.id) throw fail('Pedido ainda não possui pagamento confirmado.');
        paymentId = matching[0].id;
      }
      if (!paymentId) throw fail('Evento sem pagamento para reconciliação.');
      const payment = await client.getPayment(paymentId);
      const order = target.order || await this.repository.findOrderByExternalReference({ environment: job.environment, externalReference: payment.externalReference });
      const input = paymentInput(payment, order, job.environment);
      if (!input) throw fail('Pagamento reconsultado inválido.');
      const result = await this.repository.recordConfirmedPayment(input);
      if (result.reviewRequired) throw fail('Pagamento requer revisão.');
      await this.repository.completeBillingJob({ jobId: job.id, claimToken: claim.token });
      return { processed: 1 };
    } catch (error) {
      await this.repository.retryBillingJob({ jobId: job.id, claimToken: claim.token, lastError: error?.message || 'reconciliation_failed' });
      return { processed: 1 };
    }
  }
}

export function startBillingReconciliationWorker({ intervalMs = 5000, ...deps } = {}) {
  const worker = new BillingReconciliationWorker(deps);
  let stopped = false;
  const tick = async () => { if (!stopped) await worker.runOnce().catch(() => {}); };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { runOnce: () => worker.runOnce(), stop: () => { stopped = true; clearInterval(timer); } };
}
