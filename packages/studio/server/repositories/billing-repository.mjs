import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';

const ENVIRONMENTS = new Set(['sandbox', 'production']);
const LIMITS = Object.freeze({ projects: 5, members: 10, domains: 5 });
const ACTIVE = new Set(['active', 'cancel_at_period_end']);

function fail(message, status = 400, code) { return Object.assign(new Error(message), { status, statusCode: status, ...(code ? { code } : {}) }); }
function environment(value) { if (!ENVIRONMENTS.has(value)) throw fail('Ambiente de cobrança inválido.'); return value; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function limits(value) {
  const parsed = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(LIMITS).map((key) => [key, Number.isInteger(parsed[key]) && parsed[key] >= 0 ? parsed[key] : LIMITS[key]]));
}
function orderRecord(row) {
  if (!row) return null;
  return { id: row.id, companyId: row.company_id, environment: row.environment, planCode: row.plan_code, name: row.plan_name, amountCents: row.amount_cents, currency: row.currency, limits: limits(row.limits), status: row.status, externalReference: row.external_reference, checkoutId: row.checkout_id || null, checkoutUrl: row.checkout_url || null, subscriptionId: row.external_subscription_id || null, expiresAt: row.expires_at || null, cancelRequestedAt: row.cancel_requested_at || null, createdAt: row.created_at, updatedAt: row.updated_at };
}
function eventRecord(row) { return row && { id: row.id, environment: row.environment, provider: row.provider, providerEventId: row.provider_event_id, eventType: row.event_type, paymentId: row.provider_payment_id || null, subscriptionId: row.provider_subscription_id || null, status: row.status, attemptCount: row.attempt_count, availableAt: row.available_at, receivedAt: row.received_at }; }

export class BillingRepository {
  constructor(database) { if (!database?.query) throw new Error('Banco inválido para cobrança.'); this.database = database; }

  async seedInitialPlan({ environment: currentEnvironment, amountCents = 4900, status = 'active' }) {
    environment(currentEnvironment);
    if (!Number.isInteger(amountCents) || amountCents < 1 || !['draft', 'active'].includes(status)) throw fail('Plano inicial inválido.');
    const { rows } = await this.database.query(
      `INSERT INTO billing_plans (environment, code, name, status, amount_cents, limits)
       VALUES ($1, 'professional-v1', 'Alva Studio Profissional', $2, $3, $4::jsonb)
       ON CONFLICT (environment, code) DO UPDATE SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents, limits = EXCLUDED.limits, updated_at = now()
       RETURNING *`, [currentEnvironment, status, amountCents, JSON.stringify(LIMITS)],
    );
    return rows[0];
  }

  async createOrGetOrder({ companyId, environment: currentEnvironment, idempotencyKey }) {
    environment(currentEnvironment);
    const key = String(idempotencyKey || '');
    if (!companyId || !/^[A-Za-z0-9_-]{1,120}$/.test(key)) throw fail('Chave de idempotência inválida.');
    return withTransaction(this.database, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`billing:${companyId}:${currentEnvironment}`]);
      const existing = await client.query('SELECT * FROM payment_orders WHERE company_id = $1 AND environment = $2 AND idempotency_key = $3 FOR UPDATE', [companyId, currentEnvironment, key]);
      if (existing.rows[0]) return orderRecord(existing.rows[0]);
      const plan = await client.query(`SELECT * FROM billing_plans WHERE environment = $1 AND code = 'professional-v1' FOR UPDATE`, [currentEnvironment]);
      if (!plan.rows[0] || plan.rows[0].status !== 'active' || !plan.rows[0].amount_cents)
        throw fail('O plano ainda não está disponível para cobrança.', 409, 'billing_access_required');
      const subscription = await client.query(
        `SELECT id FROM subscriptions
          WHERE company_id = $1 AND environment = $2 AND status IN ('active', 'cancel_at_period_end')
            AND (current_period_end IS NULL OR current_period_end > now())
          FOR UPDATE`,
        [companyId, currentEnvironment],
      );
      if (subscription.rows[0]) throw fail('A empresa já possui uma assinatura no período vigente.', 409, 'billing_access_required');
      await client.query(
        `UPDATE payment_orders SET status = 'expired', updated_at = now()
          WHERE company_id = $1 AND environment = $2 AND status = 'pending' AND expires_at <= now()`,
        [companyId, currentEnvironment],
      );
      const open = await client.query(
        `SELECT * FROM payment_orders
          WHERE company_id = $1 AND environment = $2 AND plan_id = $3
            AND (status = 'submitting' OR (status IN ('creating', 'pending') AND created_at > now() - interval '65 minutes'))
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [companyId, currentEnvironment, plan.rows[0].id],
      );
      if (open.rows[0]) return orderRecord(open.rows[0]);
      const inserted = await client.query(
        `WITH value AS (SELECT gen_random_uuid() AS id)
         INSERT INTO payment_orders (id, company_id, environment, plan_id, plan_code, plan_name, amount_cents, currency, billing_interval, limits, idempotency_key, external_reference)
         SELECT value.id, $1, $2, plan.id, plan.code, plan.name, plan.amount_cents, plan.currency, plan.billing_interval, plan.limits, $3, value.id
         FROM value CROSS JOIN (SELECT * FROM billing_plans WHERE id = $4) plan RETURNING *`,
        [companyId, currentEnvironment, key, plan.rows[0].id],
      );
      return orderRecord(inserted.rows[0]);
    });
  }

  async order({ companyId, environment: currentEnvironment, orderId }) {
    environment(currentEnvironment);
    const { rows } = await this.database.query('SELECT * FROM payment_orders WHERE company_id = $1 AND environment = $2 AND id = $3', [companyId, currentEnvironment, orderId]);
    return orderRecord(rows[0]);
  }

  async claimCheckout({ companyId, environment: currentEnvironment, orderId }) {
    environment(currentEnvironment);
    const { rows } = await this.database.query(
      `UPDATE payment_orders SET status = 'submitting', updated_at = now()
       WHERE company_id = $1 AND environment = $2 AND id = $3 AND status = 'creating' RETURNING *`, [companyId, currentEnvironment, orderId],
    );
    if (rows[0]) return { claimed: true, order: orderRecord(rows[0]) };
    return { claimed: false, order: await this.order({ companyId, environment: currentEnvironment, orderId }) };
  }

  async saveCheckout({ companyId, environment: currentEnvironment, orderId, checkoutId, checkoutUrl }) {
    environment(currentEnvironment);
    const { rows } = await this.database.query(
      `UPDATE payment_orders SET status = 'pending', checkout_id = $4, checkout_url = $5, expires_at = now() + interval '60 minutes', updated_at = now()
       WHERE company_id = $1 AND environment = $2 AND id = $3 AND status = 'submitting' RETURNING *`, [companyId, currentEnvironment, orderId, checkoutId, checkoutUrl],
    );
    if (!rows[0]) throw fail('Pedido de cobrança não está disponível.', 409);
    return orderRecord(rows[0]);
  }

  async inboxWebhook({ environment: currentEnvironment, raw, provider = 'asaas', providerEventId, eventType, paymentId = null, subscriptionId = null }) {
    environment(currentEnvironment);
    if (!/^[a-z0-9_-]{2,20}$/i.test(provider) || !/^[A-Za-z0-9_-]{3,120}$/.test(String(providerEventId || ''))) throw fail('Evento do provedor inválido.');
    const digest = hash(raw);
    const { rows } = await this.database.query(
      `INSERT INTO billing_events (environment, provider, provider_event_id, payload_hash, event_type, provider_payment_id, provider_subscription_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment, provider, provider_event_id) DO UPDATE SET payload_hash = EXCLUDED.payload_hash
       RETURNING *`, [currentEnvironment, provider, providerEventId, digest, String(eventType || 'unknown').slice(0, 100), paymentId || null, subscriptionId || null],
    );
    return eventRecord(rows[0]);
  }

  async claimEvent({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `WITH candidate AS (
         SELECT id FROM billing_events WHERE available_at <= now() AND (status IN ('pending', 'retry') OR (status = 'processing' AND lease_expires_at <= now()))
         ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) UPDATE billing_events SET status = 'processing', claim_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond')
       WHERE id = (SELECT id FROM candidate) RETURNING *`, [token, leaseMs],
    );
    return rows[0] ? { claimed: true, token, event: eventRecord(rows[0]) } : { claimed: false };
  }

  async settleEvent({ id, claimToken, status, error = null }) {
    if (!['processed', 'retry', 'review', 'dead'].includes(status)) throw fail('Estado de evento inválido.');
    await this.database.query(
      `UPDATE billing_events SET status = $3, attempt_count = attempt_count + 1, last_error = $4, claim_token = NULL, lease_expires_at = NULL,
         processed_at = CASE WHEN $3 IN ('processed', 'review', 'dead') THEN now() ELSE NULL END WHERE id = $1 AND claim_token = $2`,
      [id, claimToken, status, error ? String(error).replace(/[\r\n]/g, ' ').slice(0, 240) : null],
    );
  }

  async retryEvent({ id, claimToken, error = null, maxAttempts = 8 }) {
    const { rows } = await this.database.query(
      `UPDATE billing_events
          SET attempt_count = attempt_count + 1,
              status = CASE WHEN attempt_count + 1 >= $3 THEN 'dead' ELSE 'retry' END,
              available_at = CASE WHEN attempt_count + 1 >= $3 THEN available_at ELSE now() + (LEAST(300, power(2, attempt_count + 1)::int) * interval '1 second') END,
              last_error = $4, claim_token = NULL, lease_expires_at = NULL,
              processed_at = CASE WHEN attempt_count + 1 >= $3 THEN now() ELSE NULL END
        WHERE id = $1 AND claim_token = $2 RETURNING *`,
      [id, claimToken, maxAttempts, error ? String(error).replace(/[\r\n]/g, ' ').slice(0, 240) : null],
    );
    return eventRecord(rows[0]);
  }

  async findOrderForPayment({ environment: currentEnvironment, payment }) {
    environment(currentEnvironment);
    const candidates = [
      ['external_subscription_id', payment.subscription], ['checkout_id', payment.checkoutSession], ['external_reference', payment.externalReference],
    ].filter(([, value]) => typeof value === 'string' && value);
    for (const [column, value] of candidates) {
      const { rows } = await this.database.query(`SELECT * FROM payment_orders WHERE environment = $1 AND ${column} = $2 LIMIT 1`, [currentEnvironment, value]);
      if (rows[0]) return orderRecord(rows[0]);
    }
    return null;
  }

  async reconcilePayment({ event, payment, periodEnd = null }) {
    return withTransaction(this.database, async (client) => {
      const found = await this.findOrderForPayment({ environment: event.environment, payment });
      if (!found) throw fail('Cobrança sem pedido associado.', 409, 'billing_orphan');
      const order = (await client.query('SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE', [found.id])).rows[0];
      const paymentId = String(payment.id || '');
      const cents = Math.round(Number(payment.value) * 100);
      const currency = payment.currency || 'BRL';
      const account = await client.query('SELECT external_customer_id FROM billing_accounts WHERE company_id = $1 AND environment = $2 FOR UPDATE', [order.company_id, event.environment]);
      const customer = String(payment.customer || '');
      const customerMismatch = account.rows[0]?.external_customer_id && customer !== account.rows[0].external_customer_id;
      if (!paymentId || !customer || cents !== order.amount_cents || currency !== order.currency || !payment.externalReference || payment.externalReference !== order.external_reference || customerMismatch) {
        await client.query(`INSERT INTO billing_review_events (environment, provider_payment_id, payment_order_id, reason) VALUES ($1, $2, $3, 'payment_divergence') ON CONFLICT DO NOTHING`, [event.environment, paymentId || null, order.id]);
        throw fail('Cobrança divergente.', 409, 'billing_divergence');
      }
      if (order.external_subscription_id && payment.subscription !== order.external_subscription_id) throw fail('Assinatura divergente.', 409, 'billing_divergence');
      if (!account.rows[0]) {
        await client.query(`INSERT INTO billing_accounts (company_id, environment, external_customer_id) VALUES ($1, $2, $3)`, [order.company_id, event.environment, customer]);
      }
      const duplicate = await client.query(`INSERT INTO payments (company_id, environment, payment_order_id, provider_payment_id, amount_cents, currency, provider_status, due_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (environment, provider, provider_payment_id) DO NOTHING RETURNING id`,
      [order.company_id, event.environment, order.id, paymentId, cents, currency, payment.status, payment.dueDate || null]);
      if (!duplicate.rows[0]) return { duplicate: true, order: orderRecord(order) };
      if (!payment.subscription || !periodEnd) throw fail('Assinatura sem período válido.', 409);
      await client.query(`UPDATE payment_orders SET status = 'paid', external_subscription_id = $2, updated_at = now() WHERE id = $1`, [order.id, payment.subscription]);
      await client.query(`INSERT INTO subscriptions (company_id, environment, plan_id, payment_order_id, external_subscription_id, status, current_period_end)
        VALUES ($1, $2, $3, $4, $5, 'active', $6)
        ON CONFLICT (company_id, environment) DO UPDATE SET external_subscription_id = EXCLUDED.external_subscription_id, status = 'active', current_period_end = GREATEST(subscriptions.current_period_end, EXCLUDED.current_period_end), updated_at = now()`,
      [order.company_id, event.environment, order.plan_id, order.id, payment.subscription, periodEnd]);
      await client.query(`INSERT INTO entitlements (company_id, environment, plan_id, status, limits, current_period_end, source_payment_id)
        VALUES ($1, $2, $3, 'active', $4::jsonb, $5, $6)
        ON CONFLICT (company_id, environment) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', limits = EXCLUDED.limits, current_period_end = GREATEST(entitlements.current_period_end, EXCLUDED.current_period_end), source_payment_id = EXCLUDED.source_payment_id, updated_at = now()`,
      [order.company_id, event.environment, order.plan_id, JSON.stringify(limits(order.limits)), periodEnd, duplicate.rows[0].id]);
      await client.query(
        `INSERT INTO audit_events (company_id, action, resource_type, resource_id, result, metadata)
         VALUES ($1, 'billing.payment.confirmed', 'payment_order', $2, 'success', $3::jsonb)`,
        [order.company_id, order.id, JSON.stringify({ environment: event.environment, providerPaymentId: paymentId, providerSubscriptionId: payment.subscription, amountCents: cents, currency })],
      );
      return { duplicate: false, order: orderRecord(order) };
    });
  }

  async reviewPaymentLifecycle({ event, payment, reason }) {
    const order = await this.findOrderForPayment({ environment: event.environment, payment });
    if (!order) throw fail('Cobrança sem pedido associado.', 409, 'billing_orphan');
    await this.database.query(
      `INSERT INTO billing_review_events (environment, provider_payment_id, payment_order_id, reason, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING`,
      [event.environment, payment.id, order.id, String(reason).slice(0, 100), JSON.stringify({ status: payment.status })],
    );
  }

  async recordPaymentLifecycle({ event, payment, state }) {
    const order = await this.findOrderForPayment({ environment: event.environment, payment });
    if (!order) throw fail('Cobrança sem pedido associado.', 409, 'billing_orphan');
    await withTransaction(this.database, async (client) => {
      await client.query(`UPDATE payment_orders SET status = CASE WHEN $2 = 'past_due' THEN 'failed' ELSE 'expired' END, updated_at = now() WHERE id = $1`, [order.id, state]);
      await client.query(`UPDATE entitlements SET status = 'review', updated_at = now()
        WHERE company_id = $1 AND environment = $2 AND current_period_end IS NOT NULL AND current_period_end <= now()`, [order.companyId, event.environment]);
      await client.query(`INSERT INTO audit_events (company_id, action, resource_type, resource_id, result, metadata)
        VALUES ($1, 'billing.payment.lifecycle', 'payment_order', $2, 'review', $3::jsonb)`,
      [order.companyId, order.id, JSON.stringify({ environment: event.environment, providerPaymentId: payment.id, state })]);
    });
  }

  async expireOpenOrders() {
    await this.database.query(
      `UPDATE payment_orders SET status = 'expired', updated_at = now()
        WHERE status IN ('creating', 'pending') AND (
          (expires_at IS NOT NULL AND expires_at <= now()) OR
          (expires_at IS NULL AND created_at <= now() - interval '65 minutes')
        )`,
    );
  }

  async cancelSubscription({ companyId, environment: currentEnvironment }) {
    environment(currentEnvironment);
    const { rows } = await this.database.query(`SELECT * FROM subscriptions WHERE company_id = $1 AND environment = $2 AND status IN ('active', 'cancel_at_period_end') FOR UPDATE`, [companyId, currentEnvironment]);
    return rows[0] || null;
  }

  async markCancelAtPeriodEnd({ companyId, environment: currentEnvironment, subscriptionId }) {
    environment(currentEnvironment);
    await withTransaction(this.database, async (client) => {
      await client.query(`UPDATE subscriptions SET status = 'cancel_at_period_end', cancel_at_period_end = true, updated_at = now() WHERE company_id = $1 AND environment = $2 AND external_subscription_id = $3`, [companyId, currentEnvironment, subscriptionId]);
      await client.query(`UPDATE entitlements SET status = 'cancel_at_period_end', updated_at = now() WHERE company_id = $1 AND environment = $2 AND status = 'active'`, [companyId, currentEnvironment]);
    });
  }

  async markCancelByProviderSubscription({ environment: currentEnvironment, subscriptionId }) {
    environment(currentEnvironment);
    await withTransaction(this.database, async (client) => {
      const subscription = await client.query(
        `SELECT id, company_id FROM subscriptions
          WHERE environment = $1 AND external_subscription_id = $2 FOR UPDATE`,
        [currentEnvironment, subscriptionId],
      );
      if (!subscription.rows[0]) return;
      const companyId = subscription.rows[0].company_id;
      await client.query(`UPDATE subscriptions SET status = 'cancel_at_period_end', cancel_at_period_end = true, updated_at = now() WHERE company_id = $1 AND environment = $2 AND external_subscription_id = $3`, [companyId, currentEnvironment, subscriptionId]);
      await client.query(`UPDATE entitlements SET status = 'cancel_at_period_end', updated_at = now() WHERE company_id = $1 AND environment = $2 AND status = 'active'`, [companyId, currentEnvironment]);
      await client.query(
        `INSERT INTO audit_events (company_id, action, resource_type, resource_id, result, metadata)
         VALUES ($1, 'billing.subscription.cancel_at_period_end', 'subscription', $2, 'success', $3::jsonb)`,
        [companyId, subscription.rows[0].id, JSON.stringify({ environment: currentEnvironment, providerSubscriptionId: subscriptionId, source: 'asaas_webhook' })],
      );
    });
  }

  async summary({ companyId, environment: currentEnvironment }) {
    environment(currentEnvironment);
    const [entitlement, order] = await Promise.all([
      this.database.query('SELECT * FROM entitlements WHERE company_id = $1 AND environment = $2', [companyId, currentEnvironment]),
      this.database.query('SELECT * FROM payment_orders WHERE company_id = $1 AND environment = $2 ORDER BY created_at DESC LIMIT 1', [companyId, currentEnvironment]),
    ]);
    const value = entitlement.rows[0];
    return { environment: currentEnvironment, entitlement: value ? { status: value.status, limits: limits(value.limits), currentPeriodEnd: value.current_period_end } : { status: 'pending', limits: LIMITS, currentPeriodEnd: null }, order: orderRecord(order.rows[0]) };
  }

  async requireAccess({ companyId, environment: currentEnvironment }) {
    const summary = await this.summary({ companyId, environment: currentEnvironment });
    if (!ACTIVE.has(summary.entitlement.status) || (summary.entitlement.currentPeriodEnd && new Date(summary.entitlement.currentPeriodEnd) <= new Date()))
      throw fail('Uma assinatura ativa é necessária para publicar em produção.', 403, 'billing_access_required');
    return summary.entitlement;
  }
}
