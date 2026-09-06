import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postgresFixture } from './postgres-fixture.mjs';

async function databaseFor(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}

async function row(database, text, values = []) {
  return (await database.query(text, values)).rows[0];
}

async function company(database, slug) {
  const user = await row(database, "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id", [`${slug}@alva.test`]);
  const item = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [slug, slug]);
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [item.id, user.id]);
  const project = await row(database, 'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [item.id, slug, `${slug}-project`, user.id]);
  return { user, company: item, project };
}

test('migração de cobrança cria o contrato financeiro isolado e é repetível', async (t) => {
  const database = await databaseFor(t);
  try {
    const { migrate } = await import('../server/db/postgres.mjs');
    await migrate(database);
    const tables = await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)", [[
      'plans', 'billing_activation', 'billing_accounts', 'payment_orders', 'subscriptions', 'payments', 'billing_webhook_inbox', 'billing_reconciliation_jobs', 'entitlements',
    ]]);
    assert.equal(tables.rowCount, 9);
    assert.deepEqual((await database.query("SELECT code, status, currency, price_cents, project_limit, member_limit, published_domain_limit FROM plans")).rows, [
      { code: 'studio-essential-v1', status: 'draft', currency: 'BRL', price_cents: 9900, project_limit: 5, member_limit: 10, published_domain_limit: 5 },
    ]);
  } finally { await database.close(); }
});

test('contrato de cobrança recusa preço, moeda, intervalo e escopo de empresa inválidos', async (t) => {
  const database = await databaseFor(t);
  try {
    const first = await company(database, 'billing-schema-a');
    const second = await company(database, 'billing-schema-b');
    const plan = await row(database, "INSERT INTO plans (code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status) VALUES ('test-plan', 'Teste', 'BRL', 1, 'monthly', 1, 1, 1, 'draft') RETURNING id");
    await assert.rejects(() => database.query("INSERT INTO plans (code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status) VALUES ('zero', 'Zero', 'BRL', 0, 'monthly', 1, 1, 1, 'draft')"), /check/i);
    await assert.rejects(() => database.query("INSERT INTO plans (code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status) VALUES ('usd', 'USD', 'USD', 1, 'monthly', 1, 1, 1, 'draft')"), /check/i);
    await assert.rejects(() => database.query("INSERT INTO plans (code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status) VALUES ('year', 'Year', 'BRL', 1, 'yearly', 1, 1, 1, 'draft')"), /check/i);
    await assert.rejects(() => database.query(
      "INSERT INTO payment_orders (id, company_id, requested_by_user_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, environment, external_reference) VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, $3, 'test-plan', 'Teste', 1, 'BRL', 'monthly', '{}', 'sandbox', 'alva-studio:sandbox:00000000-0000-4000-8000-000000000001')",
      [first.company.id, second.user.id, plan.id],
    ), /foreign key/i);
  } finally { await database.close(); }
});

test('pedidos, contas, eventos e assinaturas se isolam por ambiente e protegem seus invariantes', async (t) => {
  const database = await databaseFor(t);
  try {
    const seed = await company(database, 'billing-schema-isolated');
    const plan = await row(database, "SELECT id FROM plans WHERE code = 'studio-essential-v1'");
    const makeOrder = async (environment, suffix) => row(database,
      `INSERT INTO payment_orders (id, company_id, requested_by_user_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, environment, external_reference)
       VALUES ($1, $2, $3, $4, 'studio-essential-v1', 'Alva Studio Essencial', 9900, 'BRL', 'monthly', '{"projects":5,"members":10,"publishedDomains":5}', $5, $6) RETURNING id, external_reference`,
      [suffix, seed.company.id, seed.user.id, plan.id, environment, `alva-studio:${environment}:${suffix}`]);
    const sandbox = await makeOrder('sandbox', '00000000-0000-4000-8000-000000000001');
    const production = await makeOrder('production', '00000000-0000-4000-8000-000000000002');
    assert.notEqual(sandbox.id, production.id);
    await database.query("UPDATE payment_orders SET status = 'cancelled' WHERE id = $1", [sandbox.id]);
    await assert.rejects(() => database.query("UPDATE payment_orders SET external_reference = 'alva-studio:sandbox:changed' WHERE id = $1", [sandbox.id]), /imutável|immutable/i);
    await assert.rejects(() => makeOrder('production', '00000000-0000-4000-8000-000000000002'), /duplicate/i);
    await database.query("INSERT INTO billing_accounts (company_id, environment, provider_customer_id) VALUES ($1, 'sandbox', 'customer-1'), ($1, 'production', 'customer-1')", [seed.company.id]);
    await database.query("INSERT INTO billing_webhook_inbox (environment, provider_event_id, event_type, payload_sha256) VALUES ('sandbox', 'event-1', 'PAYMENT_RECEIVED', repeat('a', 64)), ('production', 'event-1', 'PAYMENT_RECEIVED', repeat('b', 64))");
    await assert.rejects(() => database.query("INSERT INTO billing_webhook_inbox (environment, provider_event_id, event_type, payload_sha256) VALUES ('sandbox', 'event-1', 'PAYMENT_RECEIVED', repeat('c', 64))"), /duplicate/i);
    const subscription = await row(database, "INSERT INTO subscriptions (company_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, environment, status) VALUES ($1, $2, 'studio-essential-v1', 'Alva Studio Essencial', 9900, 'BRL', 'monthly', '{}', 'sandbox', 'past_due') RETURNING id", [seed.company.id, plan.id]);
    await database.query("UPDATE subscriptions SET grace_until = now() + interval '7 days' WHERE id = $1", [subscription.id]);
    await assert.rejects(() => database.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [subscription.id]), /grace/i);
    await assert.rejects(() => database.query(
      "INSERT INTO payments (company_id, subscription_id, order_id, provider_payment_id, provider_status, amount_cents, currency, environment) VALUES ($1, $2, $3, 'payment-cross-environment', 'RECEIVED', 9900, 'BRL', 'production')",
      [seed.company.id, subscription.id, sandbox.id],
    ), /foreign key/i);
    const sandboxInbox = await row(database, "SELECT id FROM billing_webhook_inbox WHERE environment = 'sandbox'");
    await assert.rejects(() => database.query(
      "INSERT INTO billing_reconciliation_jobs (environment, target_type, order_id) VALUES ('sandbox', 'order', $1)", [production.id],
    ), /foreign key/i);
    await assert.rejects(() => database.query(
      "INSERT INTO billing_reconciliation_jobs (environment, target_type, inbox_event_id) VALUES ('sandbox', 'order', $1)", [sandboxInbox.id],
    ), /check/i);
    await assert.rejects(() => database.query(
      "INSERT INTO billing_reconciliation_jobs (environment, target_type) VALUES ('sandbox', 'subscription')",
    ), /check/i);
    await assert.rejects(() => database.query("INSERT INTO subscriptions (company_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, environment, status) VALUES ($1, $2, 'studio-essential-v1', 'Alva Studio Essencial', 9900, 'BRL', 'monthly', '{}', 'sandbox', 'active')", [seed.company.id, plan.id]), /duplicate/i);
  } finally { await database.close(); }
});
