import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';
import { hasCapability, normalizeProjectSlug } from '../domain/access.mjs';

const INVITABLE_ROLES = new Set(['admin', 'editor', 'analyst']);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function fail(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizedEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('E-mail inválido.', 400);
  return email;
}

function requiredName(value, field) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100) throw fail(`${field} inválido.`, 400);
  return name;
}

function invitationRole(value) {
  if (!INVITABLE_ROLES.has(value)) throw fail('Papel de convite não permitido.', 403);
  return value;
}

function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

function equalHashes(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function companyRecord(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function invitationRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  };
}

function membershipRecord(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
  };
}

async function activeMembership(client, { companyId, userId }) {
  const { rows } = await client.query(
    `SELECT id, role
     FROM company_memberships
     WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
    [companyId, userId],
  );
  return rows[0] ?? null;
}

export class CompanyRepository {
  constructor(database) {
    this.database = database;
  }

  async create({ ownerUserId, name, slug }) {
    const companyName = requiredName(name, 'Nome da empresa');
    const companySlug = normalizeProjectSlug(slug);
    if (companySlug.length > 80) throw fail('Slug da empresa excede 80 caracteres.', 400);

    return withTransaction(this.database, async (client) => {
      const company = await client.query(
        `INSERT INTO companies (name, slug)
         VALUES ($1, $2)
         RETURNING *`,
        [companyName, companySlug],
      );
      const companyRow = company.rows[0];
      const membership = await client.query(
        `INSERT INTO company_memberships (company_id, user_id, role, status, joined_at)
         SELECT $1, u.id, 'owner', 'active', now()
         FROM users u
         WHERE u.id = $2 AND u.status = 'active'
         RETURNING id`,
        [companyRow.id, ownerUserId],
      );
      if (!membership.rowCount) throw fail('Usuário proprietário não encontrado.', 404);
      return companyRecord(companyRow);
    });
  }

  async members({ companyId, actorUserId }) {
    const { rows } = await this.database.query(
      `SELECT listed.id, listed.user_id, listed.role, listed.status, listed.invited_at, listed.joined_at,
              u.email, u.display_name
       FROM company_memberships listed
       JOIN users u ON u.id = listed.user_id
       JOIN company_memberships actor
         ON actor.company_id = listed.company_id
        AND actor.user_id = $2
        AND actor.status = 'active'
       WHERE listed.company_id = $1
         AND actor.role IN ('owner', 'admin')
       ORDER BY lower(u.email), listed.id`,
      [companyId, actorUserId],
    );
    if (!rows.length) {
      const membership = await activeMembership(this.database, { companyId, userId: actorUserId });
      if (!membership) throw fail('Empresa não encontrada.', 404);
      throw fail('Sem permissão para ver membros.', 403);
    }
    return rows.map(membershipRecord);
  }

  async invite({ companyId, actorUserId, email, role }) {
    const invitedEmail = normalizedEmail(email);
    const invitedRole = invitationRole(role);
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = hashSecret(secret);
    const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS);

    const invitation = await withTransaction(this.database, async (client) => {
      const actor = await activeMembership(client, { companyId, userId: actorUserId });
      if (!actor) throw fail('Empresa não encontrada.', 404);
      if (!hasCapability(actor.role, 'member.manage')) throw fail('Sem permissão para convidar membros.', 403);

      const existing = await client.query(
        `SELECT membership.status
         FROM company_memberships membership
         JOIN users u ON u.id = membership.user_id
         WHERE membership.company_id = $1 AND lower(u.email) = $2`,
        [companyId, invitedEmail],
      );
      if (existing.rows.some((membership) => membership.status === 'active')) {
        throw fail('Este e-mail já participa da empresa.', 409);
      }

      const { rows } = await client.query(
        `INSERT INTO invitations (company_id, email, role, token_hash, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [companyId, invitedEmail, invitedRole, tokenHash, expiresAt, actorUserId],
      );
      return invitationRecord(rows[0]);
    });

    return { invitation, secret };
  }

  async acceptInvitation({ secret, userId }) {
    if (typeof secret !== 'string' || !secret) throw fail('Convite inválido.', 404);
    const secretHash = hashSecret(secret);

    return withTransaction(this.database, async (client) => {
      const invitationIdentity = await client.query(
        `SELECT company_id, email
         FROM invitations
         WHERE token_hash = $1`,
        [secretHash],
      );
      const identity = invitationIdentity.rows[0];
      if (!identity) throw fail('Convite inválido.', 404);
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [identity.company_id, identity.email],
      );
      const invitationResult = await client.query(
        `SELECT id, company_id, email, role, token_hash, expires_at, accepted_at
         FROM invitations
         WHERE token_hash = $1
         FOR UPDATE`,
        [secretHash],
      );
      const invitation = invitationResult.rows[0];
      if (
        !invitation ||
        !equalHashes(invitation.token_hash, secretHash) ||
        invitation.accepted_at ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        throw fail('Convite inválido.', 404);
      }

      const userResult = await client.query(
        `SELECT id, email
         FROM users
         WHERE id = $1 AND status = 'active'
         FOR UPDATE`,
        [userId],
      );
      const user = userResult.rows[0];
      if (!user || user.email.toLowerCase() !== invitation.email) throw fail('Convite inválido.', 404);

      const membership = await client.query(
        `INSERT INTO company_memberships (company_id, user_id, role, status, invited_at, joined_at)
         VALUES ($1, $2, $3, 'active', now(), now())
         ON CONFLICT (company_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             status = 'active',
             joined_at = now(),
             updated_at = now()
         WHERE company_memberships.status <> 'active'
         RETURNING id, user_id, role, status, invited_at, joined_at`,
        [invitation.company_id, user.id, invitation.role],
      );
      if (!membership.rowCount) throw fail('Convite inválido.', 404);
      await client.query(
        `UPDATE invitations
         SET accepted_at = now(), updated_at = now()
         WHERE company_id = $1 AND email = $2 AND accepted_at IS NULL`,
        [invitation.company_id, invitation.email],
      );
      return {
        id: membership.rows[0].id,
        userId: membership.rows[0].user_id,
        companyId: invitation.company_id,
        role: membership.rows[0].role,
        status: membership.rows[0].status,
      };
    });
  }
}
