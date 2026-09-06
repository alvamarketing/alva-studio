import { nextMonthlyPeriod, paymentConfirmed } from './asaas-client.mjs';

function safeError(error) { return String(error?.message || 'billing_reconciliation_failed').replace(/[\r\n]/g, ' ').replace(/\b(token|secret|authorization|api[_-]?key)\S*/gi, '$1=[redigido]').slice(0, 240); }
function deterministic(message, code = 'billing_divergence') { return Object.assign(new Error(message), { code, billingDisposition: 'review' }); }
function retryable(error) { return error?.code === 'billing_orphan' || error?.status >= 500 || error?.name === 'AbortError' || error?.billingDisposition === 'retry'; }
// Estados de estorno/chargeback da referência Asaas: todos exigem revisão,
// pois não devem retirar nem conceder entitlement automaticamente.
const REVIEW_STATUSES = new Set([
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);
const LIFECYCLE_STATUSES = new Set(['OVERDUE', 'PAST_DUE', 'EXPIRED']);

export async function processDueBillingEvents({ repository, clientFactory, maxPerRun = 50, leaseMs = 30_000 }) {
  let processed = 0;
  await repository.expireOpenOrders?.();
  while (processed < maxPerRun) {
    const claim = await repository.claimEvent({ leaseMs });
    if (!claim.claimed) break;
    try {
      const event = claim.event;
      if (!event.paymentId) {
        if (event.eventType === 'SUBSCRIPTION_DELETED' && event.subscriptionId) {
          await repository.markCancelByProviderSubscription({ environment: event.environment, subscriptionId: event.subscriptionId });
        }
        await repository.settleEvent({ id: event.id, claimToken: claim.token, status: 'processed' });
      } else {
        const provider = clientFactory(event.environment);
        let payment = await provider.getPayment(event.paymentId);
        if (payment?.id !== event.paymentId) throw deterministic('Cobrança divergente.');
        if (REVIEW_STATUSES.has(payment.status)) {
          await repository.reviewPaymentLifecycle({ event, payment, reason: String(payment.status).toLowerCase() });
          await repository.settleEvent({ id: event.id, claimToken: claim.token, status: 'review', error: safeError(deterministic('Pagamento exige revisão.')) });
        } else if (LIFECYCLE_STATUSES.has(payment.status)) {
          await repository.recordPaymentLifecycle({ event, payment, state: payment.status === 'EXPIRED' ? 'expired' : 'past_due' });
          await repository.settleEvent({ id: event.id, claimToken: claim.token, status: 'processed' });
        } else if (!paymentConfirmed(payment.status)) {
          await repository.settleEvent({ id: event.id, claimToken: claim.token, status: 'processed' });
        } else {
          if (!payment.subscription || typeof provider.getSubscription !== 'function') throw deterministic('Assinatura da cobrança inválida.');
          const subscription = await provider.getSubscription(payment.subscription);
          if (subscription?.id !== payment.subscription || (subscription.customer && payment.customer && subscription.customer !== payment.customer)
            || (subscription.externalReference && payment.externalReference && subscription.externalReference !== payment.externalReference))
            throw deterministic('Assinatura divergente.');
          payment = {
            ...payment,
            customer: payment.customer || subscription.customer,
            externalReference: payment.externalReference || subscription.externalReference,
          };
          const periodEnd = payment.subscription ? nextMonthlyPeriod(payment.dueDate) : null;
          await repository.reconcilePayment({ event, payment, periodEnd });
          await repository.settleEvent({ id: event.id, claimToken: claim.token, status: 'processed' });
        }
      }
    } catch (error) {
      const input = { id: claim.event.id, claimToken: claim.token, error: safeError(error) };
      if (retryable(error) && repository.retryEvent) await repository.retryEvent(input);
      else await repository.settleEvent({ ...input, status: 'review' });
    }
    processed += 1;
  }
  return { processed };
}

export function startBillingWorker({ intervalMs = 5000, ...dependencies }) {
  let stopped = false;
  const runOnce = () => processDueBillingEvents(dependencies);
  const timer = setInterval(() => { if (!stopped) runOnce().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return { runOnce, stop: () => { stopped = true; clearInterval(timer); } };
}
