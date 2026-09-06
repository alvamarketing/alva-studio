import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptBillingWebhook } from '../server/billing-webhook.mjs';

test('webhook autenticado só persiste inbox sanitizada e não chama provedor', async () => {
  const calls = [];
  const raw = Buffer.from(JSON.stringify({ id: 'evt_123', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_123' }, subscription: { id: 'sub_456' } }));
  const result = await acceptBillingWebhook({
    method: 'POST', headers: { 'asaas-access-token': 'segredo-de-webhook-com-32-caracteres', 'content-type': 'application/json' }, raw,
    secret: 'segredo-de-webhook-com-32-caracteres', environment: 'sandbox',
    repository: { inboxWebhook: async (input) => { calls.push(input); return { id: 'event-1' }; } },
  });
  assert.equal(result.status, 204);
  assert.deepEqual(calls[0], { environment: 'sandbox', raw: raw.toString('utf8'), provider: 'asaas', providerEventId: 'evt_123', eventType: 'PAYMENT_CONFIRMED', paymentId: 'pay_123', subscriptionId: 'sub_456' });
});

test('webhook rejeita token incorreto antes de persistir payload', async () => {
  await assert.rejects(() => acceptBillingWebhook({
    method: 'POST', headers: { 'asaas-access-token': 'errado', 'content-type': 'application/json' }, raw: Buffer.from('{}'),
    secret: 'segredo-de-webhook-com-32-caracteres', environment: 'sandbox', repository: { inboxWebhook: async () => assert.fail('não deve persistir') },
  }), (error) => error.status === 401);
});

test('webhook exige token com pelo menos 32 caracteres e event id do provedor', async () => {
  await assert.rejects(() => acceptBillingWebhook({
    method: 'POST', headers: { 'asaas-access-token': 'curto', 'content-type': 'application/json' }, raw: Buffer.from(JSON.stringify({ id: 'evt_123' })),
    secret: 'curto', environment: 'sandbox', repository: { inboxWebhook: async () => assert.fail('não deve persistir') },
  }), (error) => error.status === 503);
  await assert.rejects(() => acceptBillingWebhook({
    method: 'POST', headers: { 'asaas-access-token': 'segredo-de-webhook-com-32-caracteres', 'content-type': 'application/json' }, raw: Buffer.from(JSON.stringify({ event: 'PAYMENT_CONFIRMED' })),
    secret: 'segredo-de-webhook-com-32-caracteres', environment: 'sandbox', repository: { inboxWebhook: async () => assert.fail('não deve persistir') },
  }), (error) => error.status === 400);
});
