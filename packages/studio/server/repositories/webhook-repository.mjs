import { randomUUID } from 'node:crypto';

function deliveryRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    formId: row.form_id,
    submissionId: row.submission_id,
    url: row.url,
    event: row.event,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WebhookDeliveryRepository {
  constructor(database) { this.database = database; }

  // client permite participar da mesma transação que gravou a submissão, para que a entrega
  // nunca fique "órfã" (submissão persistida sem fila, ou vice-versa).
  async enqueue(client, { companyId, projectId, formId, submissionId, url, event }) {
    const { rows } = await client.query(
      `INSERT INTO webhook_deliveries (company_id, project_id, form_id, submission_id, url, event)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (company_id, project_id, submission_id) DO NOTHING
       RETURNING *`,
      [companyId, projectId, formId, submissionId, url, JSON.stringify(event)],
    );
    if (rows[0]) return deliveryRecord(rows[0]);
    const existing = await client.query(
      `SELECT * FROM webhook_deliveries WHERE company_id = $1 AND project_id = $2 AND submission_id = $3`,
      [companyId, projectId, submissionId],
    );
    return existing.rows[0] ? deliveryRecord(existing.rows[0]) : null;
  }

  async claimNextDue({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `UPDATE webhook_deliveries
          SET claim_token = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond')
        WHERE id = (
          SELECT id FROM webhook_deliveries
           WHERE status = 'pending' AND next_attempt_at <= now()
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
           ORDER BY next_attempt_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`,
      [token, leaseMs],
    );
    return rows[0] ? { claimed: true, token, delivery: deliveryRecord(rows[0]) } : { claimed: false, delivery: null };
  }

  async recordAttempt({ deliveryId, companyId, projectId, attemptNumber, outcome, detail }) {
    await this.database.query(
      `INSERT INTO webhook_delivery_attempts (delivery_id, company_id, project_id, attempt_number, outcome, detail)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (delivery_id, attempt_number) DO NOTHING`,
      [deliveryId, companyId, projectId, attemptNumber, outcome, detail || null],
    );
  }

  async markDelivered({ id, claimToken }) {
    const { rows } = await this.database.query(
      `UPDATE webhook_deliveries
          SET status = 'delivered', claim_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1 AND claim_token = $2 AND status <> 'delivered'
        RETURNING *`,
      [id, claimToken],
    );
    return rows[0] ? deliveryRecord(rows[0]) : null;
  }

  async markRetry({ id, claimToken, attemptCount, nextAttemptAt, lastError }) {
    const { rows } = await this.database.query(
      `UPDATE webhook_deliveries
          SET status = 'pending', attempt_count = $3, next_attempt_at = $4, last_error = $5,
              claim_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1 AND claim_token = $2 AND status <> 'delivered'
        RETURNING *`,
      [id, claimToken, attemptCount, nextAttemptAt, lastError || null],
    );
    return rows[0] ? deliveryRecord(rows[0]) : null;
  }

  async markDead({ id, claimToken, attemptCount, lastError }) {
    const { rows } = await this.database.query(
      `UPDATE webhook_deliveries
          SET status = 'dead', attempt_count = $3, last_error = $4,
              claim_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1 AND claim_token = $2 AND status <> 'delivered'
        RETURNING *`,
      [id, claimToken, attemptCount, lastError || null],
    );
    return rows[0] ? deliveryRecord(rows[0]) : null;
  }
}
