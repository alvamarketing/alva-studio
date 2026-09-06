import { createHash, randomUUID } from 'node:crypto';
import { SecretVault } from './publication-repository.mjs';

const EVENTS = new Set(['lead', 'initiate_checkout', 'purchase', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click']);
const ENVIRONMENTS = new Set(['preview', 'production']);
const ATTRIBUTION_KEYS = new Set(['fbc', 'fbp', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'tblci']);
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 14_400_000, 43_200_000];

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function bindingScope({ companyId, projectId, environment }) { return `tracking-binding:${companyId}:${projectId}:${environment}:nvs`; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function contact(answers = {}) {
  const entries = Object.entries(answers && typeof answers === 'object' ? answers : {});
  const email = entries.find(([key, value]) => /e-?mail/i.test(key) && typeof value === 'string')?.[1];
  const phone = entries.find(([key, value]) => /(telefone|phone|celular|whatsapp)/i.test(key) && typeof value === 'string')?.[1];
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedPhone = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  return Object.fromEntries([
    ...(normalizedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ? [['email_sha256', hash(normalizedEmail)]] : []),
    ...(normalizedPhone.length >= 8 && normalizedPhone.length <= 15 ? [['phone_sha256', hash(normalizedPhone)]] : []),
  ]);
}
function attribution(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('Identificadores de atribuição inválidos.');
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => ATTRIBUTION_KEYS.has(key) && typeof value === 'string' && value.length > 0 && value.length <= 512 ? [[key, value]] : []));
}
function record(row) {
  return row && { id: row.id, companyId: row.company_id, projectId: row.project_id, environment: row.environment, propertyId: row.property_id, trackingEventId: row.tracking_event_id, eventName: row.event_name, status: row.status, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, lastError: row.last_error || null, deliveredAt: row.delivered_at, createdAt: row.created_at };
}
function statusRecord(row) {
  const delivery = record(row);
  if (!delivery) return delivery;
  delete delivery.propertyId;
  delete delivery.trackingEventId;
  return delivery;
}
export function commercialRetryDelay(attempt) { return BACKOFF_MS[Math.min(Math.max(1, attempt), BACKOFF_MS.length) - 1]; }
export const MAX_COMMERCIAL_ATTEMPTS = BACKOFF_MS.length;

export class NvsCommercialOutboxRepository {
  constructor(database, { vault = new SecretVault({ masterKey: process.env.TRACKING_MASTER_KEY }) } = {}) { this.database = database; this.vault = vault; }
  async enqueue(client, { companyId, projectId, environment, trackingEventId, eventName, consentState = 'pending', answers = {}, attribution: rawAttribution = {}, params = {}, at = new Date() }) {
    if (!ENVIRONMENTS.has(environment) || !EVENTS.has(eventName) || !['pending', 'denied', 'granted'].includes(consentState)) throw fail('Evento comercial inválido.');
    const binding = await client.query(
      `SELECT encrypted_remote_reference FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'nvs' AND status = 'ready'`,
      [companyId, projectId, environment],
    );
    if (!binding.rows[0]?.encrypted_remote_reference) return null;
    const propertyId = this.vault.decrypt(binding.rows[0].encrypted_remote_reference, bindingScope({ companyId, projectId, environment }));
    if (!/^[a-z0-9][a-z0-9_]{0,99}$/.test(propertyId)) throw fail('Propriedade NVS inválida.', 503);
    const cleanAttribution = attribution(rawAttribution);
    const payload = { property_id: propertyId, tracking_event_id: trackingEventId, event_name: eventName, event_time: Math.floor(at.getTime() / 1000), consent_state: consentState, user: consentState === 'granted' ? contact(answers) : {}, ...(Object.keys(cleanAttribution).length ? { attribution: cleanAttribution } : {}), params };
    const inserted = await client.query(
      `INSERT INTO nvs_commercial_outbox (company_id, project_id, environment, property_id, tracking_event_id, event_name, destination, payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'nvs', $7::jsonb)
       ON CONFLICT (company_id, project_id, property_id, tracking_event_id, event_name, destination) DO NOTHING RETURNING *`,
      [companyId, projectId, environment, propertyId, trackingEventId, eventName, JSON.stringify(payload)],
    );
    if (inserted.rows[0]) return record(inserted.rows[0]);
    const existing = await client.query(
      `SELECT * FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2 AND property_id = $3 AND tracking_event_id = $4 AND event_name = $5 AND destination = 'nvs'`,
      [companyId, projectId, propertyId, trackingEventId, eventName],
    );
    return record(existing.rows[0]);
  }
  async claimNextDue({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `WITH candidate AS (SELECT id FROM nvs_commercial_outbox WHERE ((status IN ('queued', 'retry') AND next_attempt_at <= now()) OR (status = 'running' AND lease_expires_at <= now())) ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE nvs_commercial_outbox SET status = 'running', claim_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'), updated_at = now() WHERE id = (SELECT id FROM candidate) RETURNING *`, [token, leaseMs],
    );
    return rows[0] ? { claimed: true, token, delivery: { ...record(rows[0]), payload: rows[0].payload } } : { claimed: false };
  }
  async markDelivered({ id, claimToken }) { const { rows } = await this.database.query(`UPDATE nvs_commercial_outbox SET status = 'delivered', attempt_count = attempt_count + 1, claim_token = NULL, lease_expires_at = NULL, last_error = NULL, delivered_at = now(), updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken]); return record(rows[0]); }
  async markRetry({ id, claimToken, attemptCount, nextAttemptAt, lastError }) { const { rows } = await this.database.query(`UPDATE nvs_commercial_outbox SET status = 'retry', attempt_count = $3, next_attempt_at = $4, last_error = $5, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken, attemptCount, nextAttemptAt, String(lastError || 'delivery_failed').replace(/[\r\n]/g, ' ').slice(0, 240)]); return record(rows[0]); }
  async markDead({ id, claimToken, attemptCount, lastError }) { const { rows } = await this.database.query(`UPDATE nvs_commercial_outbox SET status = 'dead', attempt_count = $3, last_error = $4, claim_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running' RETURNING *`, [id, claimToken, attemptCount, String(lastError || 'delivery_failed').replace(/[\r\n]/g, ' ').slice(0, 240)]); return record(rows[0]); }
  async status({ companyId, projectId }) { const { rows } = await this.database.query(`SELECT * FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2 ORDER BY created_at DESC`, [companyId, projectId]); return rows.map(statusRecord); }
}
