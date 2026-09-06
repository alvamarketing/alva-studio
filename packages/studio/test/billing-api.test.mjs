import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { createApp } from '../server/index.mjs';
import { SessionService } from '../server/session-service.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

function raw(base, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

test('rotas billing respeitam owner e webhook público limita 64 KB', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const sessions = new SessionService(database);
  const context = await sessions.setup({ name: 'Tai', email: 'tai@billing.test', password: 'senha-segura-123' });
  const headers = new Map();
  await sessions.issue({ setHeader: (name, value) => headers.set(name, value) }, context, true);
  const cookie = headers.get('Set-Cookie').split(';')[0];
  const webhookSecret = 'segredo-de-webhook-com-24-caracteres';
  const app = createApp({ database, publicOrigin: 'https://studio.billing.test', billingOptions: { apiKey: 'fake', webhookSecret, clientFactory: () => ({ createCheckout: async () => ({ id: 'checkout_123' }), getPayment: async () => null, cancelSubscription: async () => ({}) }) } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;

  const billing = await raw(base, '/api/billing', { headers: { Host: 'studio.billing.test', Origin: 'https://studio.billing.test', Cookie: cookie } });
  assert.equal(billing.status, 200);
  assert.equal(JSON.parse(billing.text).environment, 'sandbox');

  const checkout = await raw(base, '/api/billing/checkout', { method: 'POST', headers: { Host: 'studio.billing.test', Origin: 'https://studio.billing.test', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'checkout-001' }) });
  assert.equal(checkout.status, 200);
  assert.equal(JSON.parse(checkout.text).checkoutUrl, 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_123');

  const webhook = await raw(base, '/api/billing/webhook/asaas', { method: 'POST', headers: { Host: 'studio.billing.test', 'Content-Type': 'application/json', 'asaas-access-token': webhookSecret }, body: JSON.stringify({ id: 'evt_123', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_123' } }) });
  assert.equal(webhook.status, 204);

  const oversized = await raw(base, '/api/billing/webhook/asaas', { method: 'POST', headers: { Host: 'studio.billing.test', 'Content-Type': 'application/json', 'asaas-access-token': webhookSecret }, body: Buffer.alloc(64 * 1024 + 1, 32) });
  assert.equal(oversized.status, 413);
});
