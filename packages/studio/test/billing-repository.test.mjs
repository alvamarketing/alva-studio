import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postgresFixture } from './postgres-fixture.mjs';
import { BillingRepository } from '../server/repositories/billing-repository.mjs';

async function databaseFor(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  await database.query("UPDATE plans SET status = 'active' WHERE code = 'studio-essential-v1'");
  return database;
}

async function row(database, text, values = []) { return (await database.query(text, values)).rows[0]; }

async function seedCompany(database, slug) {
  const user = await row(database, "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id", [`${slug}@alva.test`]);
  const company = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [slug, slug]);
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [company.id, user.id]);
  return { company, user };
}

async function confirmed(repo, order, { environment = 'sandbox', paymentId = 'payment-1', customerId = 'customer-1', subscriptionId = 'subscription-1', periodEnd = '2026-10-01T00:00:00Z', externalReference = order.externalReference } = {}) {
  return repo.recordConfirmedPayment({
    environment, orderId: order.id, providerPaymentId: paymentId, providerStatus: 'RECEIVED', amountCents: 9900, currency: 'BRL',
    providerCustomerId: customerId, providerSubscriptionId: subscriptionId, externalReference,
    currentPeriodStart: '2026-09-01T00:00:00Z', currentPeriodEnd: periodEnd, paidAt: '2026-09-05T12:00:00Z', dueDate: '2026-09-05',
  });
}

test('overview não atravessa empresa nem expõe identificadores ou URL de checkout', async (t) => {
  const database = await databaseFor(t);
  try {
    const first = await seedCompany(database, 'billing-overview-a');
    const second = await seedCompany(database, 'billing-overview-b');
    const repo = new BillingRepository(database);
    const order = await repo.prepareCheckout({ companyId: first.company.id, userId: first.user.id, environment: 'sandbox', now: new Date('2026-09-05T12:00:00Z') });
    await repo.claimCheckout({ orderId: order.id });
    await repo.saveCheckout({ orderId: order.id, checkout: { id: 'checkout-private', url: 'https://checkout.example.test/private' } });
    const own = await repo.getOverview({ companyId: first.company.id, environment: 'sandbox' });
    const other = await repo.getOverview({ companyId: second.company.id, environment: 'sandbox' });
    assert.equal(own.lastOrder.status, 'pending');
    assert.equal(JSON.stringify(own).includes('checkout-private'), false);
    assert.equal(JSON.stringify(own).includes('checkout.example.test'), false);
    assert.equal(other.lastOrder, null);
  } finally { await database.close(); }
});

test('overview preserva o aprovador da ativação de produção para validar enforcement', async (t) => {
  const database = await databaseFor(t);
  try {
    const seed = await seedCompany(database, 'billing-production-activation');
    await database.query(
      `INSERT INTO billing_activation (environment, enforcement_enabled, plan_code, approved_price_cents, approved_by_user_id, approved_at, checklist_completed_at, grace_days)
       VALUES ('production', true, 'studio-essential-v1', 9900, $1, now(), now(), 7)`, [seed.user.id],
    );
    const overview = await new BillingRepository(database).getOverview({ companyId: seed.company.id, environment: 'production' });
    assert.equal(overview.activation.approvedByUserId, seed.user.id);
  } finally { await database.close(); }
});

test('checkout é serializado por empresa e pedido submitting é reapresentado pela fila', async (t) => {
  const database = await databaseFor(t);
  try {
    const seed = await seedCompany(database, 'billing-concurrent');
    const repo = new BillingRepository(database);
    const [first, second] = await Promise.all([
      repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox', now: new Date('2026-09-05T12:00:00Z') }),
      repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox', now: new Date('2026-09-05T12:00:00Z') }),
    ]);
    assert.equal(first.id, second.id);
    assert.equal((await database.query("SELECT * FROM payment_orders WHERE company_id = $1", [seed.company.id])).rowCount, 1);
    assert.equal((await repo.claimCheckout({ orderId: first.id })).claimed, true);
    assert.equal((await repo.claimCheckout({ orderId: first.id })).claimed, false);
    const replay = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox', now: new Date('2026-09-05T12:01:00Z') });
    assert.equal(replay.id, first.id);
    assert.equal((await database.query("SELECT * FROM billing_reconciliation_jobs WHERE order_id = $1", [first.id])).rowCount, 1);
    await database.query("UPDATE payment_orders SET status = 'cancelled' WHERE id = $1", [first.id]);
    const next = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox', now: new Date('2026-09-06T12:00:00Z') });
    assert.notEqual(next.id, first.id);
    assert.notEqual(next.externalReference, first.externalReference);
  } finally { await database.close(); }
});

test('jobs são deduplicados atomicamente e retomam lease vencido com backoff e dead-letter', async (t) => {
  const database = await databaseFor(t);
  try {
    const seed = await seedCompany(database, 'billing-jobs');
    const repo = new BillingRepository(database);
    const order = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox' });
    await database.query("UPDATE billing_reconciliation_jobs SET status = 'completed' WHERE order_id = $1", [order.id]);
    const enqueued = await Promise.all(Array.from({ length: 8 }, () => repo.enqueueReconciliation({ environment: 'sandbox', targetType: 'order', orderId: order.id })));
    assert.equal(new Set(enqueued.map((job) => job.id)).size, 1);
    const first = await repo.claimNextBillingJob({ leaseMs: 60_000 });
    assert.equal(first.claimed, true);
    assert.equal(first.job.attempt_count, 1);
    const retry = await repo.retryBillingJob({ jobId: first.job.id, claimToken: first.token, lastError: 'temporário', now: new Date('2026-09-05T12:00:00Z') });
    assert.equal(retry.status, 'pending');
    assert.equal(retry.attemptCount, 1);
    await database.query("UPDATE billing_reconciliation_jobs SET status = 'processing', lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 second' WHERE id = $1", [first.job.id]);
    const reclaimed = await repo.claimNextBillingJob({ leaseMs: 60_000 });
    assert.equal(reclaimed.claimed, true);
    assert.equal(reclaimed.job.attempt_count, 2);
    await database.query("UPDATE billing_reconciliation_jobs SET attempt_count = 6 WHERE id = $1", [reclaimed.job.id]);
    const dead = await repo.retryBillingJob({ jobId: reclaimed.job.id, claimToken: reclaimed.token, lastError: 'esgotado', now: new Date('2026-09-05T12:00:00Z') });
    assert.equal(dead.status, 'dead_letter');
  } finally { await database.close(); }
});

test('reentrega de inbox mantém o único job mesmo depois de concluído, sem bloquear outro tipo', async (t) => {
  const database = await databaseFor(t);
  try {
    const repo = new BillingRepository(database);
    const inbox = await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-finished', eventType: 'PAYMENT_RECEIVED', payloadSha256: 'c'.repeat(64) });
    await database.query("UPDATE billing_reconciliation_jobs SET status = 'completed' WHERE target_type = 'inbox_event' AND inbox_event_id = $1", [inbox.id]);
    await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-finished', eventType: 'PAYMENT_RECEIVED', payloadSha256: 'c'.repeat(64) });
    assert.equal((await database.query("SELECT * FROM billing_reconciliation_jobs WHERE target_type = 'inbox_event' AND inbox_event_id = $1", [inbox.id])).rowCount, 1);
    await repo.enqueueReconciliation({ environment: 'sandbox', targetType: 'orphaned_event', inboxEventId: inbox.id });
    assert.equal((await database.query("SELECT * FROM billing_reconciliation_jobs WHERE inbox_event_id = $1", [inbox.id])).rowCount, 2);
  } finally { await database.close(); }
});

test('reentrega divergente do mesmo evento é retida para revisão sem reaproveitar a fila', async (t) => {
  const database = await databaseFor(t);
  try {
    const repo = new BillingRepository(database);
    const inbox = await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-divergent', eventType: 'PAYMENT_RECEIVED', providerPaymentId: 'payment-1', payloadSha256: 'a'.repeat(64) });
    const replay = await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-divergent', eventType: 'PAYMENT_CONFIRMED', providerPaymentId: 'payment-2', payloadSha256: 'b'.repeat(64) });
    assert.equal(replay.id, inbox.id);
    assert.equal((await row(database, 'SELECT status FROM billing_webhook_inbox WHERE id = $1', [inbox.id])).status, 'review_required');
    assert.equal((await row(database, "SELECT status FROM billing_reconciliation_jobs WHERE target_type = 'inbox_event' AND inbox_event_id = $1", [inbox.id])).status, 'review_required');
  } finally { await database.close(); }
});

test('inbox deduplica e confirmação só vincula contrato com referência, ambiente e renovação coerentes', async (t) => {
  const database = await databaseFor(t);
  try {
    const seed = await seedCompany(database, 'billing-confirm');
    const repo = new BillingRepository(database);
    const order = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'sandbox', now: new Date('2026-09-05T12:00:00Z') });
    await repo.claimCheckout({ orderId: order.id });
    const inbox = await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-1', eventType: 'PAYMENT_RECEIVED', providerPaymentId: 'payment-1', payloadSha256: 'a'.repeat(64) });
    assert.equal((await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-1', eventType: 'PAYMENT_RECEIVED', providerPaymentId: 'payment-1', payloadSha256: 'a'.repeat(64) })).id, inbox.id);
    const mismatch = await confirmed(repo, order, { externalReference: 'alva-studio:sandbox:00000000-0000-4000-8000-000000000099' });
    assert.equal(mismatch.reviewRequired, true);
    assert.equal((await database.query('SELECT * FROM payments')).rowCount, 0);
    const first = await confirmed(repo, order);
    assert.equal(first.duplicate, false);
    assert.equal((await row(database, "SELECT last_payment_id FROM subscriptions WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id])).last_payment_id, 'payment-1');
    assert.equal((await confirmed(repo, order)).duplicate, true);
    const rejectedOrder = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'production' });
    await database.query("UPDATE payment_orders SET status = 'cancelled' WHERE id = $1", [rejectedOrder.id]);
    assert.equal((await confirmed(repo, rejectedOrder, { environment: 'production', paymentId: 'payment-cancelled', customerId: 'customer-cancelled', subscriptionId: 'subscription-cancelled' })).reviewRequired, true);
    assert.equal((await database.query("SELECT * FROM payments WHERE provider_payment_id = 'payment-cancelled'")).rowCount, 0);
    await database.query("UPDATE payment_orders SET status = 'expired' WHERE id = $1", [rejectedOrder.id]);
    assert.equal((await confirmed(repo, rejectedOrder, { environment: 'production', paymentId: 'payment-expired', customerId: 'customer-expired', subscriptionId: 'subscription-expired' })).reviewRequired, true);
    await database.query("UPDATE payment_orders SET status = 'review_required' WHERE id = $1", [rejectedOrder.id]);
    assert.equal((await confirmed(repo, rejectedOrder, { environment: 'production', paymentId: 'payment-review', customerId: 'customer-review', subscriptionId: 'subscription-review' })).reviewRequired, true);
    assert.equal((await database.query("SELECT * FROM payments WHERE provider_payment_id IN ('payment-expired', 'payment-review')")).rowCount, 0);
    const emptyIdentifiers = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'production' });
    await repo.claimCheckout({ orderId: emptyIdentifiers.id });
    assert.equal((await confirmed(repo, emptyIdentifiers, { environment: 'production', paymentId: 'payment-empty', customerId: ' ', subscriptionId: '' })).reviewRequired, true);
    assert.equal((await database.query("SELECT * FROM payments WHERE provider_payment_id = 'payment-empty'")).rowCount, 0);
    const renewalMismatch = await confirmed(repo, order, { paymentId: 'payment-2', customerId: 'customer-other', periodEnd: '2026-11-01T00:00:00Z' });
    assert.equal(renewalMismatch.reviewRequired, true);
    assert.equal((await database.query('SELECT * FROM payments')).rowCount, 1);
    const renewal = await confirmed(repo, order, { paymentId: 'payment-3', periodEnd: '2026-11-01T00:00:00Z', externalReference: 'não-é-referência-de-renovação' });
    assert.equal(renewal.duplicate, false);
    const subscription = await row(database, "SELECT current_period_end FROM subscriptions WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id]);
    assert.equal(new Date(subscription.current_period_end).toISOString(), '2026-11-01T00:00:00.000Z');
    await database.query("UPDATE subscriptions SET status = 'canceled', canceled_at = now() WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id]);
    const lateAfterCancel = await confirmed(repo, order, { paymentId: 'payment-late-cancel', periodEnd: '2026-12-01T00:00:00Z' });
    assert.equal(lateAfterCancel.reviewRequired, true);
    await database.query("UPDATE subscriptions SET status = 'suspended' WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id]);
    const lateAfterSuspension = await confirmed(repo, order, { paymentId: 'payment-late-suspended', periodEnd: '2026-12-01T00:00:00Z' });
    assert.equal(lateAfterSuspension.reviewRequired, true);
    assert.equal((await row(database, "SELECT status FROM subscriptions WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id])).status, 'suspended');
    const prodOrder = await repo.prepareCheckout({ companyId: seed.company.id, userId: seed.user.id, environment: 'production', now: new Date('2026-09-05T12:00:00Z') });
    await repo.claimCheckout({ orderId: prodOrder.id });
    await confirmed(repo, prodOrder, { environment: 'production', paymentId: 'payment-prod', customerId: 'customer-prod', subscriptionId: 'subscription-prod' });
    assert.equal((await database.query("SELECT * FROM entitlements WHERE company_id = $1 AND environment = 'sandbox'", [seed.company.id])).rowCount, 1);
    assert.equal((await database.query("SELECT * FROM entitlements WHERE company_id = $1 AND environment = 'production'", [seed.company.id])).rowCount, 1);
    const orphanInbox = await repo.receiveInboxEvent({ environment: 'sandbox', providerEventId: 'event-orphan', eventType: 'PAYMENT_RECEIVED', payloadSha256: 'b'.repeat(64) });
    const orphan = await repo.enqueueReconciliation({ environment: 'sandbox', targetType: 'orphaned_event', inboxEventId: orphanInbox.id });
    await repo.markReviewRequired({ jobId: orphan.id, reason: 'orphaned_event' });
    assert.equal((await database.query("SELECT * FROM payments WHERE provider_payment_id = 'orphaned' ")).rowCount, 0);
  } finally { await database.close(); }
});
