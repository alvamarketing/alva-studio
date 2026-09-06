import assert from 'node:assert/strict';
import test from 'node:test';

import { processDueBillingEvents } from '../server/billing-worker.mjs';

test('worker reconcilia cobrança reconsultada e só então marca inbox processada', async () => {
  const calls = [];
  const repository = {
    claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: 'event-1', environment: 'sandbox', eventType: 'PAYMENT_CONFIRMED', paymentId: 'pay_123' } }),
    reconcilePayment: async (input) => { calls.push(['reconcile', input]); return { duplicate: false }; },
    settleEvent: async (input) => calls.push(['settle', input]),
  };
  const client = { getPayment: async (id) => ({ id, status: 'CONFIRMED', value: 49, currency: 'BRL', customer: 'cus_123', subscription: 'sub_123', externalReference: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269', dueDate: '2026-09-30' }), getSubscription: async () => ({ id: 'sub_123', customer: 'cus_123', externalReference: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269' }) };

  const result = await processDueBillingEvents({ repository, clientFactory: () => client, maxPerRun: 1 });

  assert.deepEqual(result, { processed: 1 });
  assert.equal(calls[0][0], 'reconcile');
  assert.equal(calls[0][1].periodEnd, '2026-10-30T12:00:00.000Z');
  assert.deepEqual(calls[1], ['settle', { id: 'event-1', claimToken: 'claim-1', status: 'processed' }]);
});

test('worker não concede acesso para status pendente', async () => {
  const calls = [];
  const repository = {
    claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: 'event-1', environment: 'sandbox', eventType: 'PAYMENT_CREATED', paymentId: 'pay_123' } }),
    settleEvent: async (input) => calls.push(input),
  };
  const client = { getPayment: async () => ({ id: 'pay_123', status: 'PENDING', value: 49, currency: 'BRL' }) };
  await processDueBillingEvents({ repository, clientFactory: () => client, maxPerRun: 1 });
  assert.deepEqual(calls, [{ id: 'event-1', claimToken: 'claim-1', status: 'processed' }]);
});

test('worker preserva o período pago quando recebe cancelamento da assinatura', async () => {
  const calls = [];
  const repository = {
    claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: 'event-1', environment: 'sandbox', eventType: 'SUBSCRIPTION_DELETED', subscriptionId: 'sub_123' } }),
    markCancelByProviderSubscription: async (input) => calls.push(['cancel', input]),
    settleEvent: async (input) => calls.push(['settle', input]),
  };

  await processDueBillingEvents({ repository, clientFactory: () => { throw new Error('não deve consultar pagamento'); }, maxPerRun: 1 });

  assert.deepEqual(calls, [
    ['cancel', { environment: 'sandbox', subscriptionId: 'sub_123' }],
    ['settle', { id: 'event-1', claimToken: 'claim-1', status: 'processed' }],
  ]);
});

test('worker reage a órfão transitório com retry e não com review', async () => {
  const calls = [];
  const repository = {
    claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: 'event-1', environment: 'sandbox', eventType: 'PAYMENT_CONFIRMED', paymentId: 'pay_123' } }),
    reconcilePayment: async () => { const error = new Error('Cobrança sem pedido associado.'); error.code = 'billing_orphan'; throw error; },
    retryEvent: async (input) => calls.push(input),
  };
  const client = { getPayment: async () => ({ id: 'pay_123', status: 'CONFIRMED', value: 49, currency: 'BRL', customer: 'cus_123', subscription: 'sub_123', externalReference: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269', dueDate: '2026-09-30' }), getSubscription: async () => ({ id: 'sub_123', customer: 'cus_123', externalReference: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269' }) };
  await processDueBillingEvents({ repository, clientFactory: () => client, maxPerRun: 1 });
  assert.equal(calls[0].id, 'event-1');
  assert.match(calls[0].error, /pedido associado/i);
});

test('reembolso abre review e vencido atualiza lifecycle sem conceder acesso', async () => {
  const calls = [];
  const events = [
    { id: 'refund', environment: 'sandbox', eventType: 'PAYMENT_REFUNDED', paymentId: 'pay_refund' },
    { id: 'overdue', environment: 'sandbox', eventType: 'PAYMENT_OVERDUE', paymentId: 'pay_overdue' },
  ];
  const repository = {
    claimEvent: async () => events.length ? { claimed: true, token: `claim-${events[0].id}`, event: events.shift() } : { claimed: false },
    reviewPaymentLifecycle: async (input) => calls.push(['review', input]),
    recordPaymentLifecycle: async (input) => calls.push(['lifecycle', input]),
    settleEvent: async (input) => calls.push(['settle', input]),
  };
  const client = { getPayment: async (id) => ({ id, status: id === 'pay_refund' ? 'REFUNDED' : 'OVERDUE' }) };
  await processDueBillingEvents({ repository, clientFactory: () => client, maxPerRun: 2 });
  assert.equal(calls[0][0], 'review');
  assert.equal(calls[2][0], 'lifecycle');
  assert.equal(calls.some(([name]) => name === 'reconcile'), false);
});

for (const status of ['REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL']) {
  test(`status ${status} abre review sem entitlement automático`, async () => {
    const calls = [];
    const repository = {
      claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: `event-${status}`, environment: 'sandbox', eventType: 'PAYMENT_UPDATED', paymentId: 'pay_123' } }),
      reviewPaymentLifecycle: async (input) => calls.push(['review', input]),
      reconcilePayment: async () => assert.fail('não deve conceder'),
      settleEvent: async (input) => calls.push(['settle', input]),
    };
    await processDueBillingEvents({ repository, clientFactory: () => ({ getPayment: async () => ({ id: 'pay_123', status }) }), maxPerRun: 1 });
    assert.equal(calls[0][0], 'review');
    assert.equal(calls[0][1].reason, status.toLowerCase());
    assert.equal(calls[1][1].status, 'review');
  });
}

test('reconsulta da assinatura divergente nunca reconcilia entitlement', async () => {
  const calls = [];
  const repository = {
    claimEvent: async () => ({ claimed: true, token: 'claim-1', event: { id: 'event-1', environment: 'sandbox', eventType: 'PAYMENT_CONFIRMED', paymentId: 'pay_123' } }),
    reconcilePayment: async () => assert.fail('não deve conceder'),
    settleEvent: async (input) => calls.push(input),
  };
  const client = {
    getPayment: async () => ({ id: 'pay_123', status: 'CONFIRMED', value: 49, currency: 'BRL', customer: 'cus_123', subscription: 'sub_123', externalReference: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269', dueDate: '2026-09-30' }),
    getSubscription: async () => ({ id: 'sub_other', customer: 'cus_123' }),
  };
  await processDueBillingEvents({ repository, clientFactory: () => client, maxPerRun: 1 });
  assert.equal(calls[0].status, 'review');
});
