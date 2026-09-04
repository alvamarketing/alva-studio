import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { withTransaction } from './db/postgres.mjs';
import { hasCapability, normalizeProjectSlug } from './domain/access.mjs';

const scrypt = promisify(scryptCallback);
const TOKEN_BYTES = 32;
const DEFAULT_TTL = 12 * 60 * 60 * 1000;
const HEX = /^[a-f0-9]+$/i;
const DUMMY_SCRYPT = Object.freeze({
  salt: '00112233445566778899aabbccddeeff',
  hash: '0'.repeat(128),
});

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function email(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw fail('Informe um e-mail válido.');
  return normalized;
}

function displayName(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 100) throw fail('Informe um nome com até 100 caracteres.');
  return normalized;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256)
    throw fail('Use uma senha entre 12 e 256 caracteres.');
  return value;
}

function hashToken(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicUser(row) {
  return { id: row.user_id, email: row.email, displayName: row.display_name };
}

function hashShape(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('scrypt-v1$')) {
    const [, salt, hash] = value.split('$');
    if (salt && hash && HEX.test(salt) && HEX.test(hash)) return { salt, hash, legacy: false };
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed?.salt === 'string' && typeof parsed?.hash === 'string' && HEX.test(parsed.salt) && HEX.test(parsed.hash))
      return { salt: parsed.salt, hash: parsed.hash, legacy: true };
  } catch {
    // A non-legacy stored hash is deliberately treated as an invalid credential.
  }
  return null;
}

async function newHash(value) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password(value), salt, 64)).toString('hex');
  return `scrypt-v1$${salt}$${derived}`;
}

async function verifyPassword(value, stored) {
  if (typeof value !== 'string' || value.length > 256) return { valid: false, legacy: false };
  const shape = hashShape(stored) ?? { ...DUMMY_SCRYPT, legacy: false, dummy: true };
  const expected = Buffer.from(shape.hash, 'hex');
  const actual = await scrypt(value, shape.salt, expected.length);
  return {
    valid: !shape.dummy && actual.length === expected.length && timingSafeEqual(actual, expected),
    legacy: shape.legacy,
  };
}

export class SessionService {
  constructor(database, { now = Date.now, sessionTTL = DEFAULT_TTL } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório para sessões persistentes.');
    this.database = database;
    this.now = now;
    this.sessionTTL = sessionTTL;
  }

  token(req) {
    return req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('alva_session='))
      ?.slice('alva_session='.length) ?? '';
  }

  async setupRequired() {
    const { rows } = await this.database.query('SELECT EXISTS (SELECT 1 FROM users) AS configured');
    return !rows[0].configured;
  }

  async setup(input) {
    const userName = displayName(input.name);
    const userEmail = email(input.email);
    const companyName = String(input.companyName ?? userName).trim() || userName;
    const companySlug = normalizeProjectSlug(input.companySlug ?? companyName).slice(0, 80);
    const passwordHash = await newHash(input.password);
    return withTransaction(this.database, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [184941, 1]);
      const present = await client.query('SELECT 1 FROM users LIMIT 1 FOR UPDATE');
      if (present.rowCount) throw fail('A conta inicial já foi configurada.', 409);
      const user = (await client.query(
        'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
        [userEmail, passwordHash, userName],
      )).rows[0];
      const company = (await client.query(
        'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [companyName, companySlug],
      )).rows[0];
      const membership = (await client.query(
        `INSERT INTO company_memberships (company_id, user_id, role, status, joined_at)
         VALUES ($1, $2, 'owner', 'active', now()) RETURNING id`, [company.id, user.id],
      )).rows[0];
      const project = (await client.query(
        `INSERT INTO projects (company_id, name, slug, created_by)
         VALUES ($1, 'Projeto principal', 'principal', $2) RETURNING id`, [company.id, user.id],
      )).rows[0];
      return { user: { id: user.id, email: user.email, displayName: user.display_name }, companyId: company.id, membershipId: membership.id, projectId: project.id };
    });
  }

  async login(input) {
    const userEmail = email(input.email);
    const supplied = typeof input.password === 'string' ? input.password : '';
    const { rows } = await this.database.query(
      'SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = $1 AND status = \'active\'', [userEmail],
    );
    const user = rows[0];
    const verification = await verifyPassword(supplied, user?.password_hash);
    if (!user || !verification.valid) throw fail('E-mail ou senha incorretos.', 401);
    if (verification.legacy) {
      await this.database.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, await newHash(supplied)]);
    }
    const context = await this.firstContext(user.id);
    if (!context) throw fail('Não há uma empresa ativa para este usuário.', 403);
    return { user: { id: user.id, email: user.email, displayName: user.display_name }, ...context };
  }

  async firstContext(userId, companyId = null) {
    const { rows } = await this.database.query(
      `SELECT membership.id AS membership_id, membership.company_id, membership.role
       FROM company_memberships membership
       JOIN companies company ON company.id = membership.company_id AND company.status = 'active'
       WHERE membership.user_id = $1 AND membership.status = 'active'
         AND ($2::uuid IS NULL OR membership.company_id = $2)
       ORDER BY lower(company.name), membership.id LIMIT 1`,
      [userId, companyId],
    );
    const membership = rows[0];
    if (!membership) return null;
    const projectId = await this.firstProjectId({ companyId: membership.company_id, membershipId: membership.membership_id, role: membership.role });
    return { companyId: membership.company_id, membershipId: membership.membership_id, role: membership.role, projectId };
  }

  async firstProjectId({ companyId, membershipId, role }) {
    const { rows } = await this.database.query(
      `SELECT project.id
       FROM projects project
       LEFT JOIN project_grants project_grant ON project_grant.company_id = project.company_id
         AND project_grant.project_id = project.id AND project_grant.membership_id = $2
       WHERE project.company_id = $1 AND project.status = 'active'
         AND ($3 IN ('owner', 'admin') OR project_grant.id IS NOT NULL)
       ORDER BY project.created_at, project.id LIMIT 1`,
      [companyId, membershipId, role],
    );
    return rows[0]?.id ?? null;
  }

  async issue(res, context, secure = false) {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expires = new Date(this.now() + this.sessionTTL);
    await this.database.query(
      `INSERT INTO sessions (user_id, company_id, membership_id, current_project_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [context.user.id, context.companyId, context.membershipId, context.projectId, hashToken(token), expires],
    );
    res.setHeader(
      'Set-Cookie',
      `alva_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionTTL / 1000)}${secure ? '; Secure' : ''}`,
    );
  }

  async record(req) {
    const token = this.token(req);
    if (!token) return null;
    const { rows } = await this.database.query(
      `SELECT s.id AS session_id, s.user_id, s.company_id, s.membership_id,
              s.current_project_id, membership.role, u.email, u.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN companies c ON c.id = s.company_id AND c.status = 'active'
       JOIN company_memberships membership ON membership.id = s.membership_id
         AND membership.company_id = s.company_id AND membership.user_id = s.user_id
         AND membership.status = 'active'
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
      [hashToken(token), new Date(this.now())],
    );
    return rows[0] ?? null;
  }

  async require(req) {
    const record = await this.record(req);
    if (!record) throw fail('Entre na sua conta para continuar.', 401);
    const currentProjectId = record.current_project_id && await this.authorizedProjectId({
      companyId: record.company_id, membershipId: record.membership_id, role: record.role, projectId: record.current_project_id,
    });
    return {
      sessionId: record.session_id,
      user: publicUser(record),
      companyId: record.company_id,
      membershipId: record.membership_id,
      role: record.role,
      currentProjectId,
    };
  }

  async authorizedProjectId({ companyId, membershipId, role, projectId }) {
    const { rows } = await this.database.query(
      `SELECT project.id
       FROM projects project
       LEFT JOIN project_grants project_grant ON project_grant.company_id = project.company_id
         AND project_grant.project_id = project.id AND project_grant.membership_id = $2
       WHERE project.company_id = $1 AND project.id = $4 AND project.status = 'active'
         AND ($3 IN ('owner', 'admin') OR project_grant.id IS NOT NULL)`,
      [companyId, membershipId, role, projectId],
    );
    return rows[0]?.id ?? null;
  }

  async authorize(context, capability, projectId = null) {
    if (projectId) {
      const allowed = await this.authorizedProjectId({ ...context, projectId });
      if (!allowed) throw fail('Projeto não encontrado.', 404);
    }
    if (capability && !hasCapability(context.role, capability)) throw fail('Sem permissão para esta ação.', 403);
    return projectId || null;
  }

  async companiesFor(userId) {
    const { rows } = await this.database.query(
      `SELECT company.id, company.name, company.slug, membership.role
       FROM company_memberships membership
       JOIN companies company ON company.id = membership.company_id
       WHERE membership.user_id = $1 AND membership.status = 'active' AND company.status = 'active'
       ORDER BY lower(company.name), company.id`, [userId],
    );
    return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, role: row.role }));
  }

  async state(req) {
    const setupRequired = await this.setupRequired();
    const context = await this.require(req).catch((error) => {
      if (error.status === 401) return null;
      throw error;
    });
    if (!context) return { setupRequired, authenticated: false, user: null, owner: null, companies: [], currentCompanyId: null, currentProjectId: null };
    return this.stateFor(context);
  }

  async stateFor(context) {
    return {
      setupRequired: false,
      authenticated: true,
      user: context.user,
      owner: { name: context.user.displayName, email: context.user.email },
      companies: await this.companiesFor(context.user.id),
      currentCompanyId: context.companyId,
      currentProjectId: context.projectId ?? context.currentProjectId ?? null,
    };
  }

  async changeContext(req, input) {
    const context = await this.require(req);
    const companyId = input?.companyId;
    if (typeof companyId !== 'string' || !companyId) throw fail('Escolha uma empresa.');
    const next = await this.firstContext(context.user.id, companyId);
    if (!next) throw fail('Empresa não encontrada.', 404);
    let projectId = next.projectId;
    if (input.projectId !== undefined && input.projectId !== null) {
      if (typeof input.projectId !== 'string' || !input.projectId) throw fail('Projeto inválido.');
      projectId = await this.authorizedProjectId({ ...next, projectId: input.projectId });
      if (!projectId) throw fail('Projeto não encontrado.', 404);
    }
    await this.database.query(
      `UPDATE sessions SET company_id = $2, membership_id = $3, current_project_id = $4
       WHERE id = $1 AND revoked_at IS NULL`, [context.sessionId, next.companyId, next.membershipId, projectId],
    );
    return this.state(req);
  }

  async logout(req, res, secure = false) {
    const token = this.token(req);
    if (token) await this.database.query('UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1', [hashToken(token)]);
    res.setHeader('Set-Cookie', `alva_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
  }

  async account(req, input, res, secure = false) {
    const context = await this.require(req);
    const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    const user = (await this.database.query('SELECT password_hash FROM users WHERE id = $1', [context.user.id])).rows[0];
    if (!(await verifyPassword(currentPassword, user?.password_hash)).valid) throw fail('Senha atual incorreta.', 401);
    const nextName = input.name === undefined ? context.user.displayName : displayName(input.name);
    const nextEmail = input.email === undefined ? context.user.email : email(input.email);
    const nextPassword = input.newPassword === undefined ? null : await newHash(input.newPassword);
    try {
      await withTransaction(this.database, async (client) => {
        await client.query(
          `UPDATE users SET display_name = $2, email = $3, password_hash = COALESCE($4, password_hash), updated_at = now()
           WHERE id = $1`, [context.user.id, nextName, nextEmail, nextPassword],
        );
        if (nextPassword)
          await client.query('UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1', [context.user.id]);
      });
    } catch (error) {
      if (error.code === '23505') throw fail('Este e-mail já está em uso.', 409);
      throw error;
    }
    const nextContext = {
      ...context,
      user: { id: context.user.id, email: nextEmail, displayName: nextName },
      projectId: context.currentProjectId,
    };
    if (nextPassword) await this.issue(res, nextContext, secure);
    return this.stateFor(nextContext);
  }

  async clearCurrentProject(projectId) {
    await this.database.query('UPDATE sessions SET current_project_id = NULL WHERE current_project_id = $1 AND revoked_at IS NULL', [projectId]);
  }
}
