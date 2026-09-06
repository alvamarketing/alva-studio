import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';

const ALLOWED_SCOPES = new Set(['read', 'drafts']);

function fail(message, status = 400, code) {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function keyRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function scopesFor(value) {
  const scopes = [...new Set(Array.isArray(value) ? value : [])];
  if (!scopes.length || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) throw fail('Escopos MCP inválidos.');
  if (scopes.includes('drafts') && !scopes.includes('read')) scopes.push('read');
  return scopes.sort();
}

function activeProjectSql() {
  return `
    JOIN projects project ON project.company_id = key.company_id AND project.id = key.project_id AND project.status = 'active'
    JOIN company_memberships membership ON membership.company_id = key.company_id
      AND membership.user_id = key.created_by AND membership.status = 'active'
    JOIN users actor ON actor.id = key.created_by AND actor.status = 'active'
    LEFT JOIN project_grants grant_access ON grant_access.company_id = key.company_id
      AND grant_access.project_id = key.project_id AND grant_access.membership_id = membership.id
  `;
}

export class McpKeyRepository {
  constructor(database, { now = () => new Date() } = {}) {
    this.database = database;
    this.now = now;
  }

  async create({ companyId, projectId, actorUserId, name, scopes, expiresInDays = 90, client: suppliedClient = null }) {
    const label = String(name ?? '').trim();
    if (!label || label.length > 100) throw fail('Nome da chave MCP inválido.');
    const permissions = scopesFor(scopes);
    const days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw fail('Validade MCP inválida.');
    const token = `alva_${randomBytes(32).toString('base64url')}`;
    const tokenHash = hash(token);
    const prefix = token.slice(0, 17);
    const expiresAt = new Date(this.now().getTime() + days * 24 * 60 * 60 * 1000);
    const create = async (client) => {
      const authorized = await client.query(
        `SELECT project.id
         FROM projects project
         JOIN company_memberships membership ON membership.company_id = project.company_id
           AND membership.user_id = $3 AND membership.status = 'active' AND membership.role IN ('owner', 'admin')
         WHERE project.company_id = $1 AND project.id = $2 AND project.status = 'active'
         FOR UPDATE OF project`,
        [companyId, projectId, actorUserId],
      );
      if (!authorized.rowCount) throw fail('Projeto não encontrado.', 404);
      const existing = await client.query(
        `SELECT id FROM agent_keys WHERE company_id = $1 AND project_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
        [companyId, projectId],
      );
      if (existing.rowCount >= 20) throw fail('Limite de 20 chaves MCP ativas por projeto atingido.', 409);
      const inserted = await client.query(
        `INSERT INTO agent_keys (company_id, project_id, created_by, name, prefix, token_hash, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
         RETURNING *`,
        [companyId, projectId, actorUserId, label, prefix, tokenHash, permissions, expiresAt],
      );
      return inserted.rows[0];
    };
    const row = suppliedClient ? await create(suppliedClient) : await withTransaction(this.database, create);
    return { key: keyRecord(row), token };
  }

  async createWithAudit({ audit, companyId, projectId, actorUserId, name, scopes, expiresInDays = 90 }) {
    if (!audit || typeof audit.record !== 'function') throw new Error('Auditoria MCP obrigatória.');
    return withTransaction(this.database, async (client) => {
      const created = await this.create({ companyId, projectId, actorUserId, name, scopes, expiresInDays, client });
      await audit.record({
        companyId,
        projectId,
        actorUserId,
        action: 'mcp.key.create',
        resourceType: 'agent_key',
        resourceId: created.key.id,
        result: 'success',
        metadata: { scopes: created.key.scopes, expiresAt: created.key.expiresAt },
        client,
      });
      return created;
    });
  }

  async list({ companyId, projectId, actorUserId }) {
    const { rows } = await this.database.query(
      `SELECT key.* FROM agent_keys key
       JOIN company_memberships membership ON membership.company_id = key.company_id
         AND membership.user_id = $3 AND membership.status = 'active' AND membership.role IN ('owner', 'admin')
       WHERE key.company_id = $1 AND key.project_id = $2 ORDER BY key.created_at DESC`,
      [companyId, projectId, actorUserId],
    );
    return rows.map(keyRecord);
  }

  async revoke({ companyId, projectId, actorUserId, keyId, client: suppliedClient = null }) {
    const revoke = async (client) => {
      const { rows } = await client.query(
      `UPDATE agent_keys key SET revoked_at = coalesce(key.revoked_at, now())
       FROM company_memberships membership
       WHERE key.id = $4 AND key.company_id = $1 AND key.project_id = $2
         AND membership.company_id = key.company_id AND membership.user_id = $3
         AND membership.status = 'active' AND membership.role IN ('owner', 'admin')
       RETURNING key.*`,
      [companyId, projectId, actorUserId, keyId],
      );
      if (!rows.length) throw fail('Chave MCP não encontrada.', 404);
      return keyRecord(rows[0]);
    };
    return suppliedClient ? revoke(suppliedClient) : revoke(this.database);
  }

  async revokeWithAudit({ audit, companyId, projectId, actorUserId, keyId }) {
    if (!audit || typeof audit.record !== 'function') throw new Error('Auditoria MCP obrigatória.');
    return withTransaction(this.database, async (client) => {
      const revoked = await this.revoke({ companyId, projectId, actorUserId, keyId, client });
      await audit.record({
        companyId,
        projectId,
        actorUserId,
        action: 'mcp.key.revoke',
        resourceType: 'agent_key',
        resourceId: revoked.id,
        result: 'success',
        metadata: {},
        client,
      });
      return revoked;
    });
  }

  async authenticate(token) {
    if (typeof token !== 'string' || !/^alva_[A-Za-z0-9_-]{43}$/.test(token)) throw fail('Chave MCP inválida.', 401);
    const tokenHash = hash(token);
    const { rows } = await this.database.query(
      `SELECT key.*, membership.id AS membership_id, membership.role
       FROM agent_keys key
       ${activeProjectSql()}
       WHERE key.token_hash = $1 AND key.revoked_at IS NULL AND key.expires_at > now()
         AND (membership.role IN ('owner', 'admin') OR grant_access.id IS NOT NULL)`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) throw fail('Chave MCP inválida ou expirada.', 401);
    const left = Buffer.from(row.token_hash, 'hex');
    const right = Buffer.from(tokenHash, 'hex');
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw fail('Chave MCP inválida.', 401);
    await this.database.query('UPDATE agent_keys SET last_used_at = now() WHERE id = $1', [row.id]);
    return { ...keyRecord(row), actorUserId: row.created_by, membershipId: row.membership_id, role: row.role };
  }

  async consumeRateLimit({ keyId, limit = 60, now = this.now() }) {
    const window = new Date(now); window.setUTCSeconds(0, 0);
    const { rows } = await this.database.query(
      `INSERT INTO agent_key_rate_limits (key_id, window_started_at, calls)
       VALUES ($1, $2, 1)
       ON CONFLICT (key_id, window_started_at) DO UPDATE
         SET calls = agent_key_rate_limits.calls + 1
         WHERE agent_key_rate_limits.calls < $3
       RETURNING calls`,
      [keyId, window, limit],
    );
    if (!rows.length) throw fail('Limite de chamadas MCP atingido. Tente novamente em instantes.', 429);
    return rows[0].calls;
  }

  async createOperation({ keyId, companyId, projectId, operation, idempotencyKey, request, client: suppliedClient = null }) {
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw fail('Chave de idempotência MCP inválida.');
    const requestHash = hash(stable(request));
    const claim = async (client) => {
      const inserted = await client.query(
        `INSERT INTO agent_key_operations (key_id, company_id, project_id, operation, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key_id, project_id, operation, idempotency_key) DO NOTHING
         RETURNING *`,
        [keyId, companyId, projectId, operation, idempotencyKey, requestHash],
      );
      if (inserted.rowCount) return { ...inserted.rows[0], existing: false };
      const existing = await client.query(
        `SELECT * FROM agent_key_operations WHERE key_id = $1 AND project_id = $2 AND operation = $3 AND idempotency_key = $4`,
        [keyId, projectId, operation, idempotencyKey],
      );
      if (!existing.rowCount) throw fail('Não foi possível recuperar a operação idempotente.', 409);
      if (existing.rows[0].request_hash !== requestHash) throw fail('Chave de idempotência reutilizada com outro pedido.', 409);
      return { ...existing.rows[0], existing: true };
    };
    return suppliedClient ? claim(suppliedClient) : withTransaction(this.database, claim);
  }

  async completeOperation({ id, resourceType, resourceId, client = this.database }) {
    await client.query(
      `UPDATE agent_key_operations SET resource_type = $2, resource_id = $3 WHERE id = $1`,
      [id, resourceType, resourceId],
    );
  }

}
