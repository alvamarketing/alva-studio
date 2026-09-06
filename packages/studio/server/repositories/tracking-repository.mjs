import { randomUUID } from 'node:crypto';
import { SecretVault } from './publication-repository.mjs';

const ENGINES = new Set(['umami', 'nvs']);
const ENVIRONMENTS = new Set(['preview', 'production']);
const PROVIDERS = new Set(['meta', 'tiktok', 'google', 'linkedin', 'taboola']);
const PROVIDER_FIELDS = {
  meta: new Set(['access_token', 'pixel_id']), tiktok: new Set(['access_token', 'pixel_code']),
  google: new Set(['operating_account_id', 'conversion_action_id', 'oauth_access_token']),
  linkedin: new Set(['conversion_urn', 'access_token', 'linkedin_version']), taboola: new Set(),
};
const REQUIRED_PROVIDER_FIELDS = {
  meta: ['access_token', 'pixel_id'], tiktok: ['access_token', 'pixel_code'],
  google: ['operating_account_id', 'conversion_action_id', 'oauth_access_token'],
  linkedin: ['conversion_urn', 'access_token'], taboola: [],
};
const CREDENTIAL = /^[A-Za-z0-9._~+\/=:-]{1,4096}$/;
const PROVIDER_VALUE_RULES = {
  meta: { pixel_id: /^\d{1,20}$/, access_token: CREDENTIAL },
  tiktok: { pixel_code: /^[A-Za-z0-9_-]{1,255}$/, access_token: CREDENTIAL },
  google: { operating_account_id: /^\d{1,20}$/, conversion_action_id: /^\d{1,20}$/, oauth_access_token: CREDENTIAL },
  linkedin: { conversion_urn: /^urn:lla:llaPartnerConversion:\d{1,20}$/, access_token: CREDENTIAL, linkedin_version: /^\d{6}$/ },
  taboola: {},
};

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function environment(value) { if (!ENVIRONMENTS.has(value)) throw fail('Ambiente de rastreamento inválido.'); return value; }
function engine(value) { if (!ENGINES.has(value)) throw fail('Motor de rastreamento inválido.'); return value; }
function safeError(value) {
  return String(value?.message || value || 'Falha no provisionamento.')
    .replace(/https?:\/\/\S+/gi, '[url-redigida]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redigido]')
    .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redigido]')
    .replace(/[\r\n]/g, ' ').slice(0, 240);
}
function bindingScope({ companyId, projectId, environment: targetEnvironment, engine: targetEngine }) { return `tracking-binding:${companyId}:${projectId}:${targetEnvironment}:${targetEngine}`; }
function destinationScope({ companyId, projectId, environment: targetEnvironment, provider }) { return `tracking-destination:${companyId}:${projectId}:${targetEnvironment}:${provider}`; }
function publicBinding(row) {
  return { id: row.id, environment: row.environment, engine: row.engine, status: row.status, attemptCount: row.provision_attempt_count, error: row.last_error || null, updatedAt: row.updated_at };
}
function jobRecord(row, vault) {
  return {
    id: row.id, companyId: row.company_id, projectId: row.project_id, bindingId: row.binding_id,
    environment: row.environment, engine: row.engine, remoteReference: row.encrypted_remote_reference ? vault.decrypt(row.encrypted_remote_reference, bindingScope({ companyId: row.company_id, projectId: row.project_id, environment: row.environment, engine: row.engine })) : null,
    projectName: row.project_name, projectSlug: row.project_slug, attemptCount: row.attempt_count,
  };
}

export class TrackingRepository {
  constructor(database, { vault = null, masterKey } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório para provisionamento de rastreamento.');
    this.database = database;
    this.vault = vault || new SecretVault({ masterKey: masterKey || process.env.TRACKING_MASTER_KEY });
  }

  async resolveUmamiPublicToken({ publicToken }) {
    const { rows } = await this.database.query(
      `SELECT website.company_id, website.project_id, website.environment, binding.id AS binding_id, binding.encrypted_remote_reference, website.cutover_at
         FROM analytics_websites website
         JOIN tracking_bindings binding ON binding.company_id = website.company_id AND binding.project_id = website.project_id
          AND binding.environment = website.environment AND binding.engine = 'umami' AND binding.status = 'ready'
        WHERE website.tracker_public_id = $1`,
      [publicToken],
    );
    if (!rows.length) return null;
    const row = rows[0];
    const remoteWebsiteId = row.encrypted_remote_reference && this.vault.decrypt(row.encrypted_remote_reference, bindingScope({ companyId: row.company_id, projectId: row.project_id, environment: row.environment, engine: 'umami' }));
    if (!remoteWebsiteId) return null;
    return { companyId: row.company_id, projectId: row.project_id, environment: row.environment, remoteWebsiteId, cutoverAt: row.cutover_at };
  }

  async remoteWebsiteFor({ companyId, projectId, environment: targetEnvironment = 'production' }) {
    const target = environment(targetEnvironment);
    const { rows } = await this.database.query(
      `SELECT binding.encrypted_remote_reference
         FROM tracking_bindings binding
        WHERE binding.company_id = $1 AND binding.project_id = $2
          AND binding.environment = $3 AND binding.engine = 'umami' AND binding.status = 'ready'`,
      [companyId, projectId, target],
    );
    if (!rows[0]?.encrypted_remote_reference) return null;
    const value = this.vault.decrypt(rows[0].encrypted_remote_reference, bindingScope({ companyId, projectId, environment: target, engine: 'umami' }));
    return /^[0-9a-f-]{36}$/i.test(String(value)) ? value : null;
  }

  async confirmUmamiCutover({ companyId, projectId, environment: targetEnvironment }) {
    const { rows } = await this.database.query(
      `UPDATE analytics_websites SET cutover_at = now()
        WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND cutover_at IS NULL
        RETURNING cutover_at`,
      [companyId, projectId, environment(targetEnvironment)],
    );
    return rows[0]?.cutover_at || null;
  }

  async status({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT id, environment, engine, status, provision_attempt_count, last_error, updated_at
         FROM tracking_bindings WHERE company_id = $1 AND project_id = $2
         ORDER BY environment, engine`, [companyId, projectId],
    );
    if (rows.length !== 4) throw fail('Projeto de rastreamento não encontrado.', 404);
    return { bindings: rows.map(publicBinding) };
  }

  async ensureJobs({ companyId, projectId }) {
    const run = async (client) => {
      const { rows } = await client.query(
      `SELECT id FROM tracking_bindings WHERE company_id = $1 AND project_id = $2`, [companyId, projectId],
      );
      if (rows.length !== 4) throw fail('Projeto de rastreamento não encontrado.', 404);
      for (const { id } of rows) await client.query(
      `INSERT INTO tracking_provision_jobs (company_id, project_id, binding_id)
       VALUES ($1, $2, $3) ON CONFLICT (binding_id) DO NOTHING`, [companyId, projectId, id],
      );
    };
    if (this.database.transaction) await this.database.transaction(run); else await run(this.database);
    return this.status({ companyId, projectId });
  }

  async claimNextDue({ leaseMs = 30_000 } = {}) {
    const token = randomUUID();
    const { rows } = await this.database.query(
      `WITH candidate AS (
         SELECT job.id FROM tracking_provision_jobs job
          WHERE ((job.status IN ('queued', 'retry') AND job.next_attempt_at <= now())
              OR (job.status = 'running' AND job.lease_expires_at <= now()))
          ORDER BY job.next_attempt_at, job.created_at
          FOR UPDATE SKIP LOCKED LIMIT 1
       ), claimed AS (
         UPDATE tracking_provision_jobs job SET status = 'running', claim_token = $1,
           lease_expires_at = now() + ($2::int * interval '1 millisecond'), updated_at = now()
          WHERE job.id = (SELECT id FROM candidate)
          RETURNING job.*
       )
       SELECT claimed.*, binding.environment, binding.engine, binding.encrypted_remote_reference,
              project.name AS project_name, project.slug AS project_slug
         FROM claimed JOIN tracking_bindings binding ON binding.id = claimed.binding_id
         JOIN projects project ON project.company_id = claimed.company_id AND project.id = claimed.project_id`, [token, leaseMs],
    );
    if (!rows[0]) return { claimed: false, job: null };
    await this.database.query(
      `UPDATE tracking_bindings SET status = 'provisioning', updated_at = now()
        WHERE company_id = $1 AND project_id = $2 AND id = $3`, [rows[0].company_id, rows[0].project_id, rows[0].binding_id],
    );
    return { claimed: true, token, job: jobRecord(rows[0], this.vault) };
  }

  async markReady({ jobId, bindingId, claimToken, remoteReference }) {
    const run = async (client) => {
      const job = await client.query(
        `UPDATE tracking_provision_jobs SET status = 'succeeded', attempt_count = attempt_count + 1, claim_token = NULL, lease_expires_at = NULL,
           last_error = NULL, updated_at = now() WHERE id = $1 AND binding_id = $2 AND claim_token = $3 RETURNING company_id, project_id`,
        [jobId, bindingId, claimToken],
      );
      if (!job.rows[0]) return null;
      const current = await client.query(`SELECT environment, engine FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND id = $3`, [job.rows[0].company_id, job.rows[0].project_id, bindingId]);
      const binding = await client.query(
        `UPDATE tracking_bindings SET status = 'ready', encrypted_remote_reference = COALESCE($4, encrypted_remote_reference),
           provision_attempt_count = provision_attempt_count + 1, last_error = NULL, completed_at = COALESCE(completed_at, now()), updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 RETURNING *`,
        [job.rows[0].company_id, job.rows[0].project_id, bindingId, remoteReference ? this.vault.encrypt(remoteReference, bindingScope({ companyId: job.rows[0].company_id, projectId: job.rows[0].project_id, environment: current.rows[0].environment, engine: current.rows[0].engine })) : null],
      );
      return binding.rows[0] ? publicBinding(binding.rows[0]) : null;
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }

  async markRetry({ jobId, bindingId, claimToken, attemptCount, nextAttemptAt, lastError }) {
    return this.#markFailure({ jobId, bindingId, claimToken, attemptCount, nextAttemptAt, lastError, dead: false });
  }
  async markDead({ jobId, bindingId, claimToken, attemptCount, lastError }) {
    return this.#markFailure({ jobId, bindingId, claimToken, attemptCount, lastError, dead: true });
  }
  async #markFailure({ jobId, bindingId, claimToken, attemptCount, nextAttemptAt, lastError, dead }) {
    const run = async (client) => {
      const job = await client.query(
        `UPDATE tracking_provision_jobs SET status = $4, attempt_count = $5, next_attempt_at = COALESCE($6, next_attempt_at),
           last_error = $7, claim_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND binding_id = $2 AND claim_token = $3 RETURNING company_id, project_id`,
        [jobId, bindingId, claimToken, dead ? 'dead' : 'retry', attemptCount, nextAttemptAt || null, safeError(lastError)],
      );
      if (!job.rows[0]) return null;
      const binding = await client.query(
        `UPDATE tracking_bindings SET status = $4, provision_attempt_count = $5, last_error = $6,
           dead_lettered_at = CASE WHEN $4::varchar = 'dead' THEN now() ELSE dead_lettered_at END, updated_at = now()
          WHERE company_id = $1 AND project_id = $2 AND id = $3 RETURNING *`,
        [job.rows[0].company_id, job.rows[0].project_id, bindingId, dead ? 'dead' : 'pending', attemptCount, safeError(lastError)],
      );
      return binding.rows[0] ? publicBinding(binding.rows[0]) : null;
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }

  async retry({ companyId, projectId, environment: rawEnvironment, engine: rawEngine }) {
    const targetEnvironment = environment(rawEnvironment); const targetEngine = engine(rawEngine);
    const run = async (client) => {
      const binding = await client.query(
        `UPDATE tracking_bindings SET status = 'pending', provision_attempt_count = 0, last_error = NULL, updated_at = now()
          WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = $4 RETURNING *`,
        [companyId, projectId, targetEnvironment, targetEngine],
      );
      if (!binding.rows[0]) throw fail('Binding de rastreamento não encontrado.', 404);
      const job = await client.query(
        `INSERT INTO tracking_provision_jobs (company_id, project_id, binding_id, status, attempt_count, next_attempt_at)
         VALUES ($1, $2, $3, 'queued', 0, now())
         ON CONFLICT (binding_id) DO UPDATE SET status = 'queued', attempt_count = 0, next_attempt_at = now(),
           claim_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = now()
         WHERE tracking_provision_jobs.lease_expires_at IS NULL OR tracking_provision_jobs.lease_expires_at <= now()
         RETURNING id`,
        [companyId, projectId, binding.rows[0].id],
      );
      if (!job.rows[0]) throw fail('O provisionamento está em execução.', 409);
      return publicBinding(binding.rows[0]);
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }

  async saveDestination({ companyId, projectId, environment: rawEnvironment, provider, configuration }) {
    const targetEnvironment = environment(rawEnvironment);
    if (!PROVIDERS.has(provider)) throw fail('Destino de rastreamento inválido.');
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw fail('Configuração do destino inválida.');
    if (Object.keys(configuration).some((key) => !PROVIDER_FIELDS[provider].has(key) || typeof configuration[key] !== 'string' || !PROVIDER_VALUE_RULES[provider][key]?.test(configuration[key])) || REQUIRED_PROVIDER_FIELDS[provider].some((key) => !configuration[key])) throw fail('Configuração do destino inválida.');
    const plain = JSON.stringify(configuration);
    if (plain.length > 12_000) throw fail('Configuração do destino excede o limite.');
    await this.database.transaction(async (client) => {
      const binding = await client.query(
        `SELECT id FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'nvs' FOR UPDATE`,
        [companyId, projectId, targetEnvironment],
      );
      if (!binding.rows[0]) throw fail('Binding de rastreamento não encontrado.', 404);
      await client.query(
        `INSERT INTO tracking_destinations (company_id, project_id, environment, provider, binding_id, encrypted_configuration)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (company_id, project_id, environment, provider)
         DO UPDATE SET binding_id = EXCLUDED.binding_id, encrypted_configuration = EXCLUDED.encrypted_configuration, updated_at = now()`,
        [companyId, projectId, targetEnvironment, provider, binding.rows[0].id, this.vault.encrypt(plain, destinationScope({ companyId, projectId, environment: targetEnvironment, provider }))],
      );
      await client.query(`UPDATE tracking_bindings SET status = 'pending', last_error = NULL, updated_at = now() WHERE id = $1`, [binding.rows[0].id]);
      const job = await client.query(
        `INSERT INTO tracking_provision_jobs (company_id, project_id, binding_id) VALUES ($1, $2, $3)
         ON CONFLICT (binding_id) DO UPDATE SET status = 'queued', next_attempt_at = now(), claim_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE tracking_provision_jobs.lease_expires_at IS NULL OR tracking_provision_jobs.lease_expires_at <= now()
         RETURNING id`,
        [companyId, projectId, binding.rows[0].id],
      );
      if (!job.rows[0]) throw fail('O provisionamento está em execução.', 409);
    });
    return { provider, environment: targetEnvironment, configured: true };
  }

  async destinationsFor({ companyId, projectId, environment: rawEnvironment }) {
    const targetEnvironment = environment(rawEnvironment);
    const { rows } = await this.database.query(
      `SELECT provider FROM tracking_destinations WHERE company_id = $1 AND project_id = $2 AND environment = $3 ORDER BY provider`,
      [companyId, projectId, targetEnvironment],
    );
    return rows.map((row) => ({ provider: row.provider, environment: targetEnvironment, configured: true }));
  }

  async nvsDestinations({ companyId, projectId, environment: rawEnvironment }) {
    const targetEnvironment = environment(rawEnvironment);
    const { rows } = await this.database.query(
      `SELECT provider, encrypted_configuration FROM tracking_destinations
        WHERE company_id = $1 AND project_id = $2 AND environment = $3`, [companyId, projectId, targetEnvironment],
    );
    return Object.fromEntries(rows.map((row) => [row.provider, JSON.parse(this.vault.decrypt(row.encrypted_configuration, destinationScope({ companyId, projectId, environment: targetEnvironment, provider: row.provider })))]));
  }

  async assertReady({ companyId, projectId, environment: rawEnvironment, engines: requestedEngines = ENGINES }) {
    const targetEnvironment = environment(rawEnvironment);
    const expected = [...new Set(requestedEngines)].sort();
    if (expected.length === 0 || expected.some((item) => !ENGINES.has(item))) throw fail('Motores de rastreamento inválidos.');
    const { rows } = await this.database.query(
      `SELECT engine, status FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = $3`,
      [companyId, projectId, targetEnvironment],
    );
    const available = rows.filter((row) => expected.includes(row.engine));
    if (available.length !== expected.length || new Set(available.map((row) => row.engine)).size !== expected.length || available.some((row) => row.status !== 'ready')) throw fail('Rastreamento do ambiente ainda não está pronto.', 409);
    return true;
  }
}
