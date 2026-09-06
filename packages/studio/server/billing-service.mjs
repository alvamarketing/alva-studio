import { asaasCheckoutBody, asaasCheckoutUrl } from './asaas-client.mjs';

function fail(message, status = 400, code) { return Object.assign(new Error(message), { status, statusCode: status, ...(code ? { code } : {}) }); }

export class BillingService {
  constructor({ repository, clientFactory, site, environment = 'sandbox', today = () => new Date().toISOString().slice(0, 10), audit = null } = {}) {
    if (!repository || typeof repository.createOrGetOrder !== 'function' || typeof clientFactory !== 'function') throw new Error('Dependências de cobrança inválidas.');
    this.repository = repository;
    this.clientFactory = clientFactory;
    this.site = site;
    this.environment = environment;
    this.today = today;
    this.audit = audit;
  }

  async checkout({ companyId, idempotencyKey, actorUserId = null }) {
    const order = await this.repository.createOrGetOrder({ companyId, environment: this.environment, idempotencyKey });
    if (order.checkoutUrl) return { ...order, pending: false };
    const claim = await this.repository.claimCheckout({ companyId, environment: this.environment, orderId: order.id });
    if (!claim.claimed) {
      if (!claim.order) throw fail('Pedido de cobrança não encontrado.', 404);
      return { ...claim.order, pending: claim.order.status === 'submitting' };
    }
    try {
      const response = await this.clientFactory(this.environment).createCheckout(asaasCheckoutBody(claim.order, this.site, this.today()));
      const checkoutId = String(response?.id || '');
      const checkoutUrl = asaasCheckoutUrl({ id: checkoutId }, this.environment);
      const saved = await this.repository.saveCheckout({ companyId, environment: this.environment, orderId: claim.order.id, checkoutId, checkoutUrl });
      await this.audit?.record?.({ companyId, actorUserId, action: 'billing.checkout.created', resourceType: 'payment_order', resourceId: saved.id, result: 'success', metadata: { environment: this.environment, checkoutId } });
      return { ...saved, pending: false };
    } catch (error) {
      await this.audit?.record?.({ companyId, actorUserId, action: 'billing.checkout.submitting', resourceType: 'payment_order', resourceId: claim.order.id, result: 'pending', metadata: { environment: this.environment } }).catch(() => {});
      throw error;
    }
  }

  async cancel({ companyId, actorUserId = null }) {
    const subscription = await this.repository.cancelSubscription({ companyId, environment: this.environment });
    if (!subscription) return { cancelled: true, alreadyCancelled: true };
    await this.clientFactory(this.environment).cancelSubscription(subscription.external_subscription_id);
    await this.repository.markCancelAtPeriodEnd({ companyId, environment: this.environment, subscriptionId: subscription.external_subscription_id });
    await this.audit?.record?.({ companyId, actorUserId, action: 'billing.subscription.cancel_requested', resourceType: 'subscription', resourceId: subscription.id, result: 'success', metadata: { environment: this.environment } });
    return { cancelled: true, currentPeriodEnd: subscription.current_period_end || null };
  }
}
