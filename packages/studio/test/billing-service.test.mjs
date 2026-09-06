import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingService, BillingReconciliationWorker } from '../server/billing-service.mjs';

const activation = { environment: 'sandbox', enforcementEnabled: true, planCode: 'studio-essential-v1', approvedPriceCents: 9900 };
const plan = { code: 'studio-essential-v1', status: 'active', priceCents: 9900 };
const order = {
  id: '00000000-0000-4000-8000-000000000001', environment: 'sandbox', amountCents: 9900, planName: 'Alva Studio Essencial',
  externalReference: 'alva-studio:sandbox:00000000-0000-4000-8000-000000000001',
};

function checkoutRepository() {
  return {
    getOverview: async () => ({ activation, plan, entitlement: null }),
    prepareCheckout: async () => order,
    claimCheckout: async () => ({ claimed: true, order }),
    saveCheckout: async (input) => ({ ...order, checkout: input.checkout }),
    customerForCompany: async () => null,
  };
}

test('service de checkout usa configuração e transporte injetados, sem egress implícito', async () => {
  const calls = [];
  const service = new BillingService({
    repository: checkoutRepository(), enforcement: 'sandbox',
    runtimeConfig: (environment) => ({ environment, apiKey: 'test-key', siteOrigin: 'https://studio.alva.test' }),
    clientFactory: (config) => ({
      createSubscriptionCheckout: async (input) => { calls.push({ config, input }); return { id: 'checkout-1', url: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1' }; },
    }),
    now: () => new Date('2026-09-05T12:00:00Z'),
  });
  const checkout = await service.checkout({ companyId: 'company-1', userId: 'user-1' });
  assert.equal(checkout.checkout.id, 'checkout-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.environment, 'sandbox');
  assert.equal(calls[0].input.order.externalReference, order.externalReference);
});

test('enforcement desligado não tenta checkout nem exige credenciais', async () => {
  let called = false;
  const service = new BillingService({ repository: checkoutRepository(), enforcement: 'off', runtimeConfig: () => { called = true; } });
  await assert.rejects(() => service.checkout({ companyId: 'company-1', userId: 'user-1' }), /desligada/i);
  assert.equal(called, false);
});

test('cancelamento agenda fim do período pelo transporte injetado e não apaga assinatura', async () => {
  const calls = [];
  const repository = {
    cancellationTarget: async () => ({ id: 'subscription-local', providerSubscriptionId: 'subscription-1', currentPeriodEnd: '2026-10-01T00:00:00Z' }),
    markCancelAtPeriodEnd: async (input) => { calls.push(input); return { status: 'cancel_at_period_end' }; },
  };
  const service = new BillingService({
    repository, enforcement: 'sandbox', runtimeConfig: () => ({ environment: 'sandbox', apiKey: 'key', siteOrigin: 'https://studio.alva.test' }),
    clientFactory: () => ({ updateSubscriptionEndDate: async (id, endDate) => calls.push({ id, endDate }) }),
  });
  assert.deepEqual(await service.cancel({ companyId: 'company-1' }), { status: 'cancel_at_period_end' });
  assert.deepEqual(calls, [
    { id: 'subscription-1', endDate: '2026-10-01' },
    { companyId: 'company-1', environment: 'sandbox', subscriptionId: 'subscription-local' },
  ]);
});

test('worker reconcilia pagamento reconsultado pelo transporte injetado e nunca pelo webhook', async () => {
  const calls = [];
  const repository = {
    claimNextBillingJob: async () => ({ claimed: true, token: 'claim-1', job: { id: 'job-1', environment: 'sandbox', target_type: 'inbox_event' } }),
    reconciliationTarget: async () => ({ inbox: { providerPaymentId: 'payment-1' } }),
    findOrderByExternalReference: async () => order,
    recordConfirmedPayment: async (input) => { calls.push(input); return { duplicate: false }; },
    completeBillingJob: async (input) => { calls.push(input); },
  };
  const worker = new BillingReconciliationWorker({
    repository,
    clientForEnvironment: () => ({ getPayment: async () => ({
      id: 'payment-1', status: 'RECEIVED', value: '99.00', externalReference: order.externalReference,
      customer: 'customer-1', subscription: 'subscription-1', confirmedDate: '2026-09-05T12:00:00Z', dueDate: '2026-09-05',
    }) }),
  });
  assert.deepEqual(await worker.runOnce(), { processed: 1 });
  assert.equal(calls[0].providerPaymentId, 'payment-1');
  assert.equal(calls[0].amountCents, 9900);
  assert.equal(calls[1].jobId, 'job-1');
});

test('worker reconcilia pedido submitting pela referência imutável antes de criar outro checkout', async () => {
  const calls = [];
  const repository = {
    claimNextBillingJob: async () => ({ claimed: true, token: 'claim-order', job: { id: 'job-order', environment: 'sandbox', target_type: 'order' } }),
    reconciliationTarget: async () => ({ order }),
    recordConfirmedPayment: async (input) => { calls.push(input); return { duplicate: false }; },
    completeBillingJob: async () => {},
  };
  const worker = new BillingReconciliationWorker({
    repository,
    clientForEnvironment: () => ({
      findByExternalReference: async (reference) => ({ data: [{ id: 'payment-order-1', externalReference: reference }] }),
      getPayment: async () => ({
        id: 'payment-order-1', status: 'CONFIRMED', value: '99.00', externalReference: order.externalReference,
        customer: 'customer-1', subscription: 'subscription-1', confirmedDate: '2026-09-05T12:00:00Z', dueDate: '2026-10-05',
      }),
    }),
  });
  assert.deepEqual(await worker.runOnce(), { processed: 1 });
  assert.equal(calls[0].orderId, order.id);
  assert.equal(calls[0].providerPaymentId, 'payment-order-1');
});
