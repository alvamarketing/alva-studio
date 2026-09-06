import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { BillingRepository } from '../server/repositories/billing-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function harness(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  return { database, billing: new BillingRepository(database) };
}

test('cria pedido sandbox com contrato do plano congelado', async (t) => {
  const { database, billing } = await harness(t);
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Empresa Billing', 'empresa-billing') RETURNING id")).rows[0];
  await billing.seedInitialPlan({ environment: 'sandbox', amountCents: 4900, status: 'active' });

  const order = await billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'checkout-001' });

  assert.equal(order.environment, 'sandbox');
  assert.equal(order.status, 'creating');
  assert.equal(order.amountCents, 4900);
  assert.equal(order.currency, 'BRL');
  assert.deepEqual(order.limits, { projects: 5, members: 10, domains: 5 });
  assert.equal((await billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'checkout-001' })).id, order.id);
});

test('inbox deduplica pelo event id do provedor, não pelo hash do payload', async (t) => {
  const { billing } = await harness(t);
  const first = await billing.inboxWebhook({ environment: 'sandbox', provider: 'asaas', providerEventId: 'evt_123', raw: '{"id":"evt_123","status":"a"}', eventType: 'PAYMENT_CONFIRMED' });
  const second = await billing.inboxWebhook({ environment: 'sandbox', provider: 'asaas', providerEventId: 'evt_123', raw: '{"id":"evt_123","status":"b"}', eventType: 'PAYMENT_CONFIRMED' });
  assert.equal(second.id, first.id);
});

test('idempotency keys diferentes reutilizam checkout aberto e recusam assinatura vigente', async (t) => {
  const { database, billing } = await harness(t);
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Empresa Aberta', 'empresa-aberta') RETURNING id")).rows[0];
  await billing.seedInitialPlan({ environment: 'sandbox' });
  const first = await billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'checkout-a' });
  await billing.claimCheckout({ companyId: company.id, environment: 'sandbox', orderId: first.id });
  const retry = await billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'checkout-b' });
  assert.equal(retry.id, first.id);
  await database.query(`INSERT INTO subscriptions (company_id, environment, plan_id, payment_order_id, external_subscription_id, status, current_period_end)
    VALUES ($1, 'sandbox', $2, $3, 'sub_123', 'active', now() + interval '1 day')`, [company.id, (await database.query("SELECT id FROM billing_plans WHERE environment = 'sandbox'")).rows[0].id, first.id]);
  await assert.rejects(() => billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'checkout-c' }), (error) => error.code === 'billing_access_required');
});

test('primeira confirmação exige customer e vincula a conta; confirmação posterior divergente vai para review', async (t) => {
  const { database, billing } = await harness(t);
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Empresa Customer', 'empresa-customer') RETURNING id")).rows[0];
  await billing.seedInitialPlan({ environment: 'sandbox' });
  const order = await billing.createOrGetOrder({ companyId: company.id, environment: 'sandbox', idempotencyKey: 'customer-a' });
  const event = { environment: 'sandbox' };
  const valid = { id: 'pay_123', status: 'CONFIRMED', value: 49, currency: 'BRL', customer: 'cus_123', subscription: 'sub_123', externalReference: order.externalReference, dueDate: '2026-09-30' };
  await billing.reconcilePayment({ event, payment: valid, periodEnd: '2026-10-30T12:00:00.000Z' });
  assert.equal((await database.query('SELECT external_customer_id FROM billing_accounts WHERE company_id = $1', [company.id])).rows[0].external_customer_id, 'cus_123');
  await assert.rejects(() => billing.reconcilePayment({
    event,
    payment: { ...valid, id: 'pay_456', customer: 'cus_456', dueDate: '2026-10-30' },
    periodEnd: '2026-11-30T12:00:00.000Z',
  }), (error) => error.code === 'billing_divergence');
  assert.equal((await database.query('SELECT count(*)::int AS count FROM entitlements WHERE company_id = $1', [company.id])).rows[0].count, 1);
});

test('fila só reivindica eventos disponíveis e mata retry no máximo configurado', async (t) => {
  const { database, billing } = await harness(t);
  const event = await billing.inboxWebhook({ environment: 'sandbox', provider: 'asaas', providerEventId: 'evt_retry', raw: '{"id":"evt_retry"}', eventType: 'PAYMENT_CONFIRMED' });
  await database.query(`UPDATE billing_events SET available_at = now() + interval '1 day' WHERE id = $1`, [event.id]);
  assert.equal((await billing.claimEvent()).claimed, false);
  await database.query(`UPDATE billing_events SET available_at = now() WHERE id = $1`, [event.id]);
  const claim = await billing.claimEvent();
  const retried = await billing.retryEvent({ id: event.id, claimToken: claim.token, error: 'temporary', maxAttempts: 1 });
  assert.equal(retried.status, 'dead');
});
