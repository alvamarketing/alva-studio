import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function keyFrom(value) {
  if (typeof value !== 'string' || !value.trim()) throw fail('A chave mestra VERCEL_MASTER_KEY é obrigatória no servidor.', 500);
  return createHash('sha256').update(value).digest();
}

export class SecretVault {
  constructor({ masterKey = process.env.VERCEL_MASTER_KEY } = {}) { this.key = keyFrom(masterKey); }

  encrypt(value) {
    if (typeof value !== 'string' || !value) throw fail('Token Vercel inválido.', 400);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return JSON.stringify({
      iv: iv.toString('hex'),
      data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      keyVersion: 1,
    });
  }

  decrypt(value) {
    try {
      const secret = typeof value === 'string' ? JSON.parse(value) : value;
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(secret.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(secret.tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(secret.data, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      throw fail('Não foi possível ler a conexão Vercel. Salve-a novamente.', 500);
    }
  }
}

function cleanTeamId(value) {
  const teamId = String(value ?? '').trim();
  if (teamId && !/^team_[a-zA-Z0-9]+$/.test(teamId)) throw fail('Informe um Team ID válido, iniciado por team_.');
  return teamId;
}

function cleanProjectId(value) {
  const projectId = String(value ?? '').trim();
  if (!projectId || projectId.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw fail('Informe o projeto da Vercel.');
  return projectId;
}

function cleanToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)) throw fail('Token Vercel inválido.');
  return value;
}

function publicConfiguration(configuration = {}) {
  return {
    provider: 'vercel',
    environment: 'production',
    connectionStatus: configuration.connectionStatus === 'configured' ? 'configured' : 'pending',
    teamId: configuration.teamId || '',
    vercelProjectId: configuration.vercelProjectId || '',
  };
}

export class ProjectIntegrationRepository {
  constructor(database, { vault = null, provider = 'vercel', environment = 'production' } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para integrações.');
    this.database = database;
    this.vault = vault;
    this.provider = provider;
    this.environment = environment;
  }

  async queryIntegration({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT configuration
         FROM project_integrations
        WHERE company_id = $1 AND project_id = $2 AND provider = $3 AND environment = $4`,
      [companyId, projectId, this.provider, this.environment],
    );
    return rows[0]?.configuration || null;
  }

  async publicSettings(scope) {
    return publicConfiguration(await this.queryIntegration(scope) || {});
  }

  async save({ companyId, projectId, teamId = '', vercelProjectId, token }) {
    const cleanProject = cleanProjectId(vercelProjectId);
    const cleanTeam = cleanTeamId(teamId);
    const clean = cleanToken(token);
    const secretName = 'access_token';
    const encrypted = (this.vault || new SecretVault()).encrypt(clean);
    const run = async (client) => {
      await client.query(
        `INSERT INTO company_secrets (company_id, provider, secret_name, encrypted_value, key_version, rotated_at)
         VALUES ($1, $2, $3, $4, 1, now())
         ON CONFLICT (company_id, provider, secret_name, key_version)
         DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, rotated_at = now()`,
        [companyId, this.provider, secretName, encrypted],
      );
      const configuration = { connectionStatus: 'configured', teamId: cleanTeam, vercelProjectId: cleanProject, secretName };
      await client.query(
        `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (project_id, provider, environment)
         DO UPDATE SET company_id = EXCLUDED.company_id, configuration = EXCLUDED.configuration, updated_at = now()`,
        [companyId, projectId, this.provider, this.environment, JSON.stringify(configuration)],
      );
      return publicConfiguration(configuration);
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }

  async credentials({ companyId, projectId }) {
    const configuration = await this.queryIntegration({ companyId, projectId });
    if (!configuration || configuration.connectionStatus !== 'configured') return null;
    const { rows } = await this.database.query(
      `SELECT encrypted_value
         FROM company_secrets
        WHERE company_id = $1 AND provider = $2 AND secret_name = $3
        ORDER BY key_version DESC LIMIT 1`,
      [companyId, this.provider, configuration.secretName || 'access_token'],
    );
    if (!rows[0]) return null;
    return {
      token: (this.vault || new SecretVault()).decrypt(rows[0].encrypted_value),
      teamId: configuration.teamId || '',
      vercelProjectId: configuration.vercelProjectId,
    };
  }

  async disconnect({ companyId, projectId }) {
    await this.database.query(
      `DELETE FROM project_integrations
        WHERE company_id = $1 AND project_id = $2 AND provider = $3 AND environment = $4`,
      [companyId, projectId, this.provider, this.environment],
    );
    return publicConfiguration({});
  }
}

const TERMINAL_STATES = new Set(['READY', 'ERROR', 'CANCELED', 'BLOCKED']);

function runRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    environment: row.environment,
    snapshotHash: row.snapshot_hash,
    idempotencyKey: row.idempotency_key,
    expectedRevision: row.expected_revision,
    status: row.status,
    externalDeploymentId: row.external_deployment_id || null,
    externalProjectId: row.external_project_id || null,
    url: row.external_url || row.url || null,
    error: row.error || null,
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}

function deploymentInput({ environment, snapshotHash, expectedRevision }) {
  if (!['preview', 'production'].includes(environment)) throw fail('Ambiente de publicação inválido.', 400);
  if (!/^[a-f0-9]{64}$/i.test(snapshotHash)) throw fail('Snapshot inválido.', 400);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw fail('Revisão inválida.', 400);
}

export class DeploymentRepository {
  constructor(database) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para publicações.');
    this.database = database;
  }

  async find({ companyId, projectId, runId, environment, idempotencyKey }) {
    const conditions = runId ? 'id = $3' : 'environment = $3 AND idempotency_key = $4';
    const params = runId ? [companyId, projectId, runId] : [projectId, environment, idempotencyKey];
    const { rows } = await this.database.query(
      `SELECT * FROM deployment_runs WHERE ${runId ? 'company_id = $1 AND project_id = $2 AND id = $3' : 'project_id = $1 AND environment = $2 AND idempotency_key = $3'} LIMIT 1`,
      params,
    );
    return runRecord(rows[0]);
  }

  async latest({ companyId, projectId, environment }) {
    const { rows } = await this.database.query(
      `SELECT * FROM deployment_runs WHERE company_id = $1 AND project_id = $2
         AND ($3::text IS NULL OR environment = $3) ORDER BY created_at DESC, id DESC LIMIT 1`,
      [companyId, projectId, environment || null],
    );
    return runRecord(rows[0]);
  }

  async latestReady({ companyId, projectId, environment }) {
    const { rows } = await this.database.query(
      `SELECT * FROM deployment_runs WHERE company_id = $1 AND project_id = $2 AND environment = $3
         AND status = 'READY' ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`,
      [companyId, projectId, environment],
    );
    return runRecord(rows[0]);
  }

  async createOrGet({ companyId, projectId, environment, snapshotHash, expectedRevision, requestedBy, idempotencyKey }) {
    deploymentInput({ environment, snapshotHash, expectedRevision });
    const key = String(idempotencyKey || `${environment}:${snapshotHash}`);
    if (key.length > 120) throw fail('Chave de idempotência inválida.', 400);
    const existing = await this.find({ projectId, environment, idempotencyKey: key });
    if (existing) {
      if (existing.snapshotHash.toLowerCase() !== snapshotHash.toLowerCase()) throw fail('A chave de idempotência já pertence a outro conteúdo.', 409);
      return existing;
    }
    const { rows } = await this.database.query(
      `INSERT INTO deployment_runs
         (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, environment, idempotency_key) DO NOTHING
       RETURNING *`,
      [companyId, projectId, environment, snapshotHash, key, expectedRevision, requestedBy || null],
    );
    if (rows[0]) return runRecord(rows[0]);
    const concurrent = await this.find({ projectId, environment, idempotencyKey: key });
    if (!concurrent) throw fail('Não foi possível criar a execução de publicação.', 503);
    if (concurrent.snapshotHash.toLowerCase() !== snapshotHash.toLowerCase()) throw fail('A chave de idempotência já pertence a outro conteúdo.', 409);
    return concurrent;
  }

  async claim({ companyId, projectId, runId, leaseMs = 60_000 }) {
    const { randomUUID } = await import('node:crypto');
    const token = randomUUID();
    const { rows } = await this.database.query(
      `UPDATE deployment_runs
          SET claim_token = $4, lease_expires_at = now() + ($5::int * interval '1 millisecond'), status = 'INITIALIZING', started_at = COALESCE(started_at, now())
        WHERE company_id = $1 AND project_id = $2 AND id = $3
          AND external_deployment_id IS NULL
          AND status NOT IN ('ERROR', 'CANCELED', 'BLOCKED', 'READY')
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())
        RETURNING *`,
      [companyId, projectId, runId, token, leaseMs],
    );
    if (rows[0]) return { claimed: true, run: runRecord(rows[0]) };
    const current = await this.find({ companyId, projectId, runId });
    return { claimed: false, run: current };
  }

  async updateExternal({ companyId, projectId, runId, externalDeploymentId, externalProjectId, url, status }) {
    const nextStatus = String(status || 'QUEUED').toUpperCase();
    if (!['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(nextStatus)) throw fail('Estado externo inválido.', 400);
    const { rows } = await this.database.query(
      `UPDATE deployment_runs
          SET external_deployment_id = COALESCE($4, external_deployment_id),
              external_project_id = COALESCE($5, external_project_id),
              external_url = COALESCE($6, external_url),
              claim_token = NULL, lease_expires_at = NULL,
              status = $7,
              started_at = COALESCE(started_at, now()),
              completed_at = CASE WHEN $7 = ANY($8::text[]) THEN COALESCE(completed_at, now()) ELSE completed_at END
        WHERE company_id = $1 AND project_id = $2 AND id = $3
        RETURNING *`,
      [companyId, projectId, runId, externalDeploymentId || null, externalProjectId || null, url || null, nextStatus, [...TERMINAL_STATES]],
    );
    if (!rows.length) throw fail('Execução não encontrada.', 404);
    const result = runRecord(rows[0]);
    if (url) result.url = url;
    return result;
  }

  async updateStatus({ companyId, projectId, runId, status, url, error }) {
    const nextStatus = String(status || '').toUpperCase();
    if (!['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'BLOCKED'].includes(nextStatus)) throw fail('Estado inválido.', 400);
    const { rows } = await this.database.query(
      `UPDATE deployment_runs
          SET status = $4, external_url = COALESCE($5, external_url),
              error = COALESCE($6, error), claim_token = NULL, lease_expires_at = NULL,
              completed_at = CASE WHEN $4 = ANY($7::text[]) THEN COALESCE(completed_at, now()) ELSE completed_at END
        WHERE company_id = $1 AND project_id = $2 AND id = $3 RETURNING *`,
      [companyId, projectId, runId, nextStatus, url || null, error || null, [...TERMINAL_STATES]],
    );
    if (!rows.length) throw fail('Execução não encontrada.', 404);
    const result = runRecord(rows[0]);
    if (url !== undefined) result.url = url;
    if (error !== undefined) result.error = error;
    return result;
  }
}

export class ProjectDomainRepository {
  constructor(database) { this.database = database; }
  async save({ companyId, projectId, environment = 'production', domain, verificationStatus = 'pending' }) {
    const value = String(domain || '').trim().toLowerCase();
    if (!value || value.length > 253) throw fail('Domínio inválido.', 400);
    const run = async (client) => {
      const existing = await client.query(
        `SELECT * FROM project_domains WHERE lower(domain) = lower($1) FOR UPDATE`, [value],
      );
      if (existing.rows[0] && (existing.rows[0].company_id !== companyId || existing.rows[0].project_id !== projectId || existing.rows[0].environment !== environment))
        throw fail('Este domínio já está conectado a outro projeto.', 409);
      await client.query(
        `UPDATE project_domains SET is_canonical = false, updated_at = now()
          WHERE company_id = $1 AND project_id = $2 AND environment = $3`, [companyId, projectId, environment],
      );
      const result = existing.rows[0]
        ? await client.query(
          `UPDATE project_domains SET is_canonical = true, verification_status = $5, updated_at = now()
            WHERE id = $4 RETURNING id, company_id, project_id, environment, domain, is_canonical, verification_status, updated_at`,
          [companyId, projectId, environment, existing.rows[0].id, verificationStatus],
        )
        : await client.query(
          `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status, updated_at)
           VALUES ($1, $2, $3, $4, true, $5, now())
           RETURNING id, company_id, project_id, environment, domain, is_canonical, verification_status, updated_at`,
          [companyId, projectId, environment, value, verificationStatus],
        );
      return result.rows[0];
    };
    let row;
    try {
      row = this.database.transaction ? await this.database.transaction(run) : await run(this.database);
    } catch (error) {
      if (error?.code === '23505') throw fail('Este domínio já está conectado a outro projeto.', 409);
      throw error;
    }
    return row ? { id: row.id, companyId: row.company_id, projectId: row.project_id, environment: row.environment, domain: row.domain, isCanonical: row.is_canonical, verificationStatus: row.verification_status, updatedAt: row.updated_at } : null;
  }
}

export class AuditRepository {
  constructor(database) { this.database = database; }
  async record({ companyId, projectId, actorUserId, action, resourceType, resourceId, revision, result, metadata = {} }) {
    await this.database.query(
      `INSERT INTO audit_events (company_id, project_id, actor_user_id, action, resource_type, resource_id, revision, result, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [companyId, projectId || null, actorUserId || null, action, resourceType, resourceId || null, revision ?? null, result, JSON.stringify(metadata)],
    );
  }
}
