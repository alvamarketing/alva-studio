import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';
import { isConfirmingPaymentStatus } from '../billing-policy.mjs';

const BILLING_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
const MAX_BILLING_ATTEMPTS = BILLING_BACKOFF_MS.length;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function orderRecord(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, planCode: row.plan_code, planName: row.plan_name,
    amountCents: row.amount_cents, currency: row.currency, interval: row.interval, limits: row.limits,
    environment: row.environment, externalReference: row.external_reference, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
  };
}

function publicOrder(row) {
  if (!row) return null;
  const { id, company_id, requested_by_user_id, plan_id, external_reference, provider_checkout_id, checkout_url, ...safe } = row;
  return {
    planCode: safe.plan_code, planName: safe.plan_name, amountCents: safe.amount_cents, currency: safe.currency,
    interval: safe.interval, limits: safe.limits, environment: safe.environment, status: safe.status,
    createdAt: safe.created_at, updatedAt: safe.updated_at, expiresAt: safe.expires_at,
  };
}

function subscriptionRecord(row) {
  if (!row) return null;
  return {
    status: row.status, planCode: row.plan_code, planName: row.plan_name, amountCents: row.amount_cents,
    currency: row.currency, interval: row.interval, limits: row.limits, environment: row.environment,
    currentPeriodStart: row.current_period_start, currentPeriodEnd: row.current_period_end,
    graceUntil: row.grace_until, cancelAtPeriodEnd: row.cancel_at_period_end, canceledAt: row.canceled_at,
  };
}

async function activePlan(client) {
  const { rows } = await client.query("SELECT * FROM plans WHERE code = 'studio-essential-v1' AND status = 'active' AND retired_at IS NULL");
  if (!rows[0]) throw fail('Plano de cobrança indisponível.', 409);
  return rows[0];
}

async function enqueue(client, { environment, targetType, orderId = null, inboxEventId = null, subscriptionId = null }) {
  const { rows } = await client.query(
    `INSERT INTO billing_reconciliation_jobs (environment, target_type, order_id, inbox_event_id, subscription_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
    [environment, targetType, orderId, inboxEventId, subscriptionId],
  );
  if (rows[0]) return rows[0];
  const existing = await client.query(
    `SELECT * FROM billing_reconciliation_jobs
      WHERE environment = $1 AND target_type = $2
        AND order_id IS NOT DISTINCT FROM $3 AND inbox_event_id IS NOT DISTINCT FROM $4 AND subscription_id IS NOT DISTINCT FROM $5
        AND (target_type = 'inbox_event' OR status IN ('pending', 'processing'))
      ORDER BY created_at DESC LIMIT 1`,
    [environment, targetType, orderId, inboxEventId, subscriptionId],
  );
  return existing.rows[0];
}

async function markOrderReview(client, orderId) {
  await client.query(
    "UPDATE billing_reconciliation_jobs SET status = 'review_required', updated_at = now() WHERE order_id = $1 AND status IN ('pending', 'processing')",
    [orderId],
  );
}

export class BillingRepository {
  constructor(database) { this.database = database; }

  async getOverview({ companyId, environment }) {
    const [plan, activation, subscription, entitlement, lastOrder] = await Promise.all([
      this.database.query("SELECT code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status FROM plans WHERE code = 'studio-essential-v1'"),
      this.database.query('SELECT environment, enforcement_enabled, plan_code, approved_price_cents, approved_by_user_id, approved_at, checklist_completed_at, grace_days, updated_at FROM billing_activation WHERE environment = $1', [environment]),
      this.database.query('SELECT * FROM subscriptions WHERE company_id = $1 AND environment = $2 ORDER BY created_at DESC LIMIT 1', [companyId, environment]),
      this.database.query('SELECT access_state, plan_code, limits, effective_until, updated_at FROM entitlements WHERE company_id = $1 AND environment = $2', [companyId, environment]),
      this.database.query('SELECT * FROM payment_orders WHERE company_id = $1 AND environment = $2 ORDER BY created_at DESC LIMIT 1', [companyId, environment]),
    ]);
    return {
      plan: plan.rows[0] ? { code: plan.rows[0].code, name: plan.rows[0].name, currency: plan.rows[0].currency, priceCents: plan.rows[0].price_cents, interval: plan.rows[0].interval, limits: { projects: plan.rows[0].project_limit, members: plan.rows[0].member_limit, publishedDomains: plan.rows[0].published_domain_limit }, status: plan.rows[0].status } : null,
      activation: activation.rows[0] ? { environment: activation.rows[0].environment, enforcementEnabled: activation.rows[0].enforcement_enabled, planCode: activation.rows[0].plan_code, approvedPriceCents: activation.rows[0].approved_price_cents, approvedByUserId: activation.rows[0].approved_by_user_id, approvedAt: activation.rows[0].approved_at, checklistCompletedAt: activation.rows[0].checklist_completed_at, graceDays: activation.rows[0].grace_days, updatedAt: activation.rows[0].updated_at } : null,
      subscription: subscriptionRecord(subscription.rows[0]),
      entitlement: entitlement.rows[0] ? { accessState: entitlement.rows[0].access_state, planCode: entitlement.rows[0].plan_code, limits: entitlement.rows[0].limits, effectiveUntil: entitlement.rows[0].effective_until, updatedAt: entitlement.rows[0].updated_at } : null,
      lastOrder: publicOrder(lastOrder.rows[0]),
    };
  }

  async prepareCheckout({ companyId, userId, environment, now = new Date() }) {
    if (!['sandbox', 'production'].includes(environment)) throw fail('Ambiente de cobrança inválido.');
    return withTransaction(this.database, async (client) => {
      const company = await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
      if (!company.rows[0]) throw fail('Empresa não encontrada.', 404);
      const subscription = await client.query(
        "SELECT * FROM subscriptions WHERE company_id = $1 AND environment = $2 AND status IN ('pending_checkout', 'active', 'past_due', 'cancel_at_period_end') FOR UPDATE",
        [companyId, environment],
      );
      if (subscription.rows[0]) throw fail('A empresa já possui uma assinatura em andamento.', 409);
      const open = await client.query(
        "SELECT * FROM payment_orders WHERE company_id = $1 AND environment = $2 AND status IN ('creating', 'submitting', 'pending') FOR UPDATE",
        [companyId, environment],
      );
      if (open.rows[0]) {
        if (open.rows[0].status === 'submitting') await enqueue(client, { environment, targetType: 'order', orderId: open.rows[0].id });
        return orderRecord(open.rows[0]);
      }
      const plan = await activePlan(client);
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO payment_orders
          (id, company_id, requested_by_user_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, environment, external_reference, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $13)
         RETURNING *`,
        [id, companyId, userId, plan.id, plan.code, plan.name, plan.price_cents, plan.currency, plan.interval,
          JSON.stringify({ projects: plan.project_limit, members: plan.member_limit, publishedDomains: plan.published_domain_limit }), environment,
          `alva-studio:${environment}:${id}`, now],
      );
      await enqueue(client, { environment, targetType: 'order', orderId: id });
      return orderRecord(rows[0]);
    });
  }

  async claimCheckout({ orderId }) {
    const { rows } = await this.database.query(
      "UPDATE payment_orders SET status = 'submitting', updated_at = now() WHERE id = $1 AND status = 'creating' RETURNING *",
      [orderId],
    );
    if (!rows[0]) return { claimed: false, order: null };
    await this.enqueueReconciliation({ environment: rows[0].environment, targetType: 'order', orderId: rows[0].id });
    return { claimed: true, order: orderRecord(rows[0]) };
  }

  async saveCheckout({ orderId, checkout }) {
    if (!checkout?.id || !checkout?.url) throw fail('Checkout inválido.');
    return withTransaction(this.database, async (client) => {
      const { rows } = await client.query(
        `UPDATE payment_orders SET status = 'pending', provider_checkout_id = $2, checkout_url = $3, updated_at = now()
          WHERE id = $1 AND status = 'submitting' RETURNING *`, [orderId, checkout.id, checkout.url],
      );
      if (!rows[0]) throw fail('Pedido de cobrança não está em envio.', 409);
      await enqueue(client, { environment: rows[0].environment, targetType: 'order', orderId });
      return orderRecord(rows[0]);
    });
  }

  async receiveInboxEvent({ environment, providerEventId, eventType, providerPaymentId = null, payloadSha256 }) {
    if (!['sandbox', 'production'].includes(environment) || !providerEventId || !eventType || !/^[0-9a-f]{64}$/.test(payloadSha256 ?? '')) throw fail('Evento de cobrança inválido.');
    return withTransaction(this.database, async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_webhook_inbox (environment, provider_event_id, event_type, provider_payment_id, payload_sha256)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (environment, provider_event_id) DO NOTHING RETURNING *`,
        [environment, providerEventId, eventType, providerPaymentId, payloadSha256],
      );
      const inbox = inserted.rows[0] ?? (await client.query('SELECT * FROM billing_webhook_inbox WHERE environment = $1 AND provider_event_id = $2', [environment, providerEventId])).rows[0];
      const divergent = !inserted.rows[0] && (
        inbox.event_type !== eventType
        || inbox.provider_payment_id !== providerPaymentId
        || inbox.payload_sha256 !== payloadSha256
      );
      const job = await enqueue(client, { environment, targetType: 'inbox_event', inboxEventId: inbox.id });
      if (divergent) {
        await client.query("UPDATE billing_webhook_inbox SET status = 'review_required', error_code = 'divergent_redelivery' WHERE id = $1", [inbox.id]);
        await client.query("UPDATE billing_reconciliation_jobs SET status = 'review_required', last_error = 'divergent_redelivery', claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1", [job.id]);
      }
      return { id: inbox.id, environment: inbox.environment, providerEventId: inbox.provider_event_id, eventType: inbox.event_type, providerPaymentId: inbox.provider_payment_id, status: inbox.status };
    });
  }

  async enqueueReconciliation(input) {
    return withTransaction(this.database, (client) => enqueue(client, input).then((job) => ({ id: job.id, environment: job.environment, targetType: job.target_type, status: job.status })));
  }

  async customerForCompany({ companyId, environment }) {
    const { rows } = await this.database.query('SELECT provider_customer_id FROM billing_accounts WHERE company_id = $1 AND environment = $2', [companyId, environment]);
    return rows[0]?.provider_customer_id ?? null;
  }

  async cancellationTarget({ companyId, environment }) {
    const { rows } = await this.database.query(
      "SELECT id, provider_subscription_id, current_period_end FROM subscriptions WHERE company_id = $1 AND environment = $2 AND status IN ('active', 'cancel_at_period_end') ORDER BY created_at DESC LIMIT 1",
      [companyId, environment],
    );
    const row = rows[0];
    return row ? { id: row.id, providerSubscriptionId: row.provider_subscription_id, currentPeriodEnd: row.current_period_end } : null;
  }

  async markCancelAtPeriodEnd({ companyId, environment, subscriptionId }) {
    const { rows } = await this.database.query(
      "UPDATE subscriptions SET status = 'cancel_at_period_end', cancel_at_period_end = true, updated_at = now() WHERE id = $1 AND company_id = $2 AND environment = $3 AND status IN ('active', 'cancel_at_period_end') RETURNING *",
      [subscriptionId, companyId, environment],
    );
    if (!rows[0]) throw fail('Assinatura não pode ser cancelada.', 409);
    return subscriptionRecord(rows[0]);
  }

  async findOrderByExternalReference({ environment, externalReference }) {
    const { rows } = await this.database.query('SELECT * FROM payment_orders WHERE environment = $1 AND external_reference = $2', [environment, externalReference]);
    return orderRecord(rows[0]);
  }

  async reconciliationTarget({ jobId }) {
    const { rows } = await this.database.query('SELECT * FROM billing_reconciliation_jobs WHERE id = $1', [jobId]);
    const job = rows[0];
    if (!job) return null;
    const [order, inbox] = await Promise.all([
      job.order_id ? this.database.query('SELECT * FROM payment_orders WHERE id = $1 AND environment = $2', [job.order_id, job.environment]) : null,
      job.inbox_event_id ? this.database.query('SELECT provider_payment_id FROM billing_webhook_inbox WHERE id = $1 AND environment = $2', [job.inbox_event_id, job.environment]) : null,
    ]);
    return {
      order: orderRecord(order?.rows[0]),
      inbox: inbox?.rows[0] ? { providerPaymentId: inbox.rows[0].provider_payment_id } : null,
    };
  }

  async completeBillingJob({ jobId, claimToken }) {
    const { rows } = await this.database.query(
      "UPDATE billing_reconciliation_jobs SET status = 'completed', claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'processing' RETURNING *",
      [jobId, claimToken],
    );
    return rows[0] ?? null;
  }

  async claimNextBillingJob({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `UPDATE billing_reconciliation_jobs SET status = 'processing', attempt_count = attempt_count + 1, claim_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'), updated_at = now()
       WHERE id = (SELECT id FROM billing_reconciliation_jobs WHERE ((status = 'pending' AND next_attempt_at <= now()) OR (status = 'processing' AND lease_expires_at <= now())) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *`, [token, leaseMs],
    );
    return rows[0] ? { claimed: true, token, job: rows[0] } : { claimed: false, job: null };
  }

  async retryBillingJob({ jobId, claimToken, lastError, now = new Date() }) {
    return withTransaction(this.database, async (client) => {
      const current = await client.query("SELECT * FROM billing_reconciliation_jobs WHERE id = $1 AND claim_token = $2 AND status = 'processing' FOR UPDATE", [jobId, claimToken]);
      const job = current.rows[0];
      if (!job) return null;
      if (job.attempt_count >= MAX_BILLING_ATTEMPTS) {
        const { rows } = await client.query("UPDATE billing_reconciliation_jobs SET status = 'dead_letter', last_error = $3, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 RETURNING *", [jobId, claimToken, String(lastError ?? 'retry_exhausted').slice(0, 500)]);
        return rows[0] ? { id: rows[0].id, status: rows[0].status, attemptCount: rows[0].attempt_count } : null;
      }
      const nextAttemptAt = new Date(new Date(now).getTime() + BILLING_BACKOFF_MS[job.attempt_count - 1]);
      const { rows } = await client.query("UPDATE billing_reconciliation_jobs SET status = 'pending', next_attempt_at = $3, last_error = $4, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 RETURNING *", [jobId, claimToken, nextAttemptAt, String(lastError ?? 'retry').slice(0, 500)]);
      return rows[0] ? { id: rows[0].id, status: rows[0].status, attemptCount: rows[0].attempt_count, nextAttemptAt: rows[0].next_attempt_at } : null;
    });
  }

  async recordConfirmedPayment(input) {
    return withTransaction(this.database, async (client) => {
      const orderResult = await client.query('SELECT * FROM payment_orders WHERE id = $1 AND environment = $2 FOR UPDATE', [input.orderId, input.environment]);
      const order = orderResult.rows[0];
      if (!order) return { reviewRequired: true };
      const duplicate = await client.query('SELECT id FROM payments WHERE environment = $1 AND provider_payment_id = $2', [input.environment, input.providerPaymentId]);
      if (duplicate.rows[0]) return { duplicate: true };
      if (!['submitting', 'pending', 'paid'].includes(order.status)) return { reviewRequired: true };
      if (!isConfirmingPaymentStatus(input.providerStatus) || order.amount_cents !== input.amountCents || order.currency !== input.currency) {
        await markOrderReview(client, order.id);
        return { reviewRequired: true };
      }
      const subscriptionResult = await client.query('SELECT * FROM subscriptions WHERE company_id = $1 AND environment = $2 FOR UPDATE', [order.company_id, input.environment]);
      let subscription = subscriptionResult.rows[0];
      const accountResult = await client.query('SELECT * FROM billing_accounts WHERE company_id = $1 AND environment = $2 FOR UPDATE', [order.company_id, input.environment]);
      const account = accountResult.rows[0];
      if (subscription) {
        if (['canceled', 'suspended'].includes(subscription.status)) {
          await markOrderReview(client, order.id);
          return { reviewRequired: true };
        }
        if (!account || account.provider_customer_id !== input.providerCustomerId || subscription.provider_subscription_id !== input.providerSubscriptionId) {
          await markOrderReview(client, order.id);
          return { reviewRequired: true };
        }
      } else {
        if (!['submitting', 'pending'].includes(order.status) || order.external_reference !== input.externalReference || !String(input.providerCustomerId ?? '').trim() || !String(input.providerSubscriptionId ?? '').trim()) {
          await markOrderReview(client, order.id);
          return { reviewRequired: true };
        }
        if (account && account.provider_customer_id !== input.providerCustomerId) {
          await markOrderReview(client, order.id);
          return { reviewRequired: true };
        }
        if (!account) await client.query("INSERT INTO billing_accounts (company_id, environment, provider_customer_id) VALUES ($1, $2, $3)", [order.company_id, input.environment, input.providerCustomerId]);
        const created = await client.query(
          `INSERT INTO subscriptions (company_id, plan_id, plan_code, plan_name, amount_cents, currency, interval, limits, provider_subscription_id, environment, status, current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12) RETURNING *`,
          [order.company_id, order.plan_id, order.plan_code, order.plan_name, order.amount_cents, order.currency, order.interval, JSON.stringify(order.limits), input.providerSubscriptionId, input.environment, input.currentPeriodStart, input.currentPeriodEnd],
        );
        subscription = created.rows[0];
      }
      const periodEnd = new Date(input.currentPeriodEnd);
      if (Number.isNaN(periodEnd.getTime())) { await markOrderReview(client, order.id); return { reviewRequired: true }; }
      if (subscription) {
        const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
        if (!currentEnd || periodEnd > currentEnd || !subscription.last_payment_id) {
          const updated = await client.query('UPDATE subscriptions SET status = $2, current_period_start = $3, current_period_end = $4, last_payment_id = $5, updated_at = now() WHERE id = $1 RETURNING *', [subscription.id, 'active', input.currentPeriodStart, input.currentPeriodEnd, input.providerPaymentId]);
          subscription = updated.rows[0];
        }
      }
      await client.query(
        `INSERT INTO payments (company_id, subscription_id, order_id, provider_payment_id, provider_status, amount_cents, currency, paid_at, due_date, environment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [order.company_id, subscription.id, order.id, input.providerPaymentId, input.providerStatus, input.amountCents, input.currency, input.paidAt, input.dueDate, input.environment],
      );
      await client.query(
        `INSERT INTO entitlements (company_id, environment, subscription_id, access_state, plan_code, limits, effective_until)
         VALUES ($1, $2, $3, 'active', $4, $5::jsonb, $6)
         ON CONFLICT (company_id, environment) DO UPDATE SET subscription_id = EXCLUDED.subscription_id, access_state = EXCLUDED.access_state, plan_code = EXCLUDED.plan_code, limits = EXCLUDED.limits, effective_until = GREATEST(entitlements.effective_until, EXCLUDED.effective_until), updated_at = now()`,
        [order.company_id, input.environment, subscription.id, subscription.plan_code, JSON.stringify(subscription.limits), subscription.current_period_end],
      );
      await client.query("UPDATE payment_orders SET status = 'paid', updated_at = now() WHERE id = $1", [order.id]);
      await client.query("UPDATE billing_reconciliation_jobs SET status = 'completed', claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE order_id = $1 AND status IN ('pending', 'processing')", [order.id]);
      return { duplicate: false, subscription: subscriptionRecord(subscription) };
    });
  }

  async markReviewRequired({ jobId, reason }) {
    const { rows } = await this.database.query(
      "UPDATE billing_reconciliation_jobs SET status = 'review_required', last_error = $2, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 RETURNING *",
      [jobId, String(reason ?? 'review_required').slice(0, 500)],
    );
    return rows[0] ? { id: rows[0].id, status: rows[0].status } : null;
  }
}
