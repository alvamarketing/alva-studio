import { normalizeProjectSlug } from '../domain/access.mjs';

function fail(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100) throw fail('Nome do projeto inválido.', 400);
  return name;
}

function projectSlug(value) {
  const slug = normalizeProjectSlug(value);
  if (slug.length > 80) throw fail('Slug do projeto excede 80 caracteres.', 400);
  return slug;
}

function projectRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const AUTHORIZED_PROJECTS = `
  SELECT p.*
  FROM projects p
  JOIN company_memberships m
    ON m.company_id = p.company_id
   AND m.user_id = $3
   AND m.status = 'active'
  LEFT JOIN project_grants g
    ON g.company_id = p.company_id
   AND g.project_id = p.id
   AND g.membership_id = m.id
  WHERE p.company_id = $1
    AND p.id = $2
    AND p.status <> 'deleted'
    AND (m.role IN ('owner', 'admin') OR g.id IS NOT NULL)
`;

export class ProjectRepository {
  constructor(database) {
    this.database = database;
  }

  async create({ companyId, actorUserId, name, slug }) {
    const projectName = requiredName(name);
    const normalizedSlug = projectSlug(slug);
    const { rows } = await this.database.query(
      `INSERT INTO projects (company_id, name, slug, created_by)
       SELECT $1, $2, $3, membership.user_id
       FROM company_memberships membership
       WHERE membership.company_id = $1
         AND membership.user_id = $4
         AND membership.status = 'active'
         AND membership.role IN ('owner', 'admin')
       RETURNING *`,
      [companyId, projectName, normalizedSlug, actorUserId],
    );
    if (!rows.length) throw fail('Projeto não encontrado.', 404);
    return projectRecord(rows[0]);
  }

  async listForUser({ companyId, userId }) {
    const { rows } = await this.database.query(
      `SELECT p.*
       FROM projects p
       JOIN company_memberships m
         ON m.company_id = p.company_id
        AND m.user_id = $2
        AND m.status = 'active'
       LEFT JOIN project_grants g
         ON g.company_id = p.company_id
        AND g.project_id = p.id
        AND g.membership_id = m.id
       WHERE p.company_id = $1
         AND p.status = 'active'
         AND (m.role IN ('owner', 'admin') OR g.id IS NOT NULL)
       ORDER BY p.created_at, p.id`,
      [companyId, userId],
    );
    return rows.map(projectRecord);
  }

  async getAuthorized({ companyId, projectId, userId }) {
    const { rows } = await this.database.query(AUTHORIZED_PROJECTS, [companyId, projectId, userId]);
    if (!rows.length) throw fail('Projeto não encontrado.', 404);
    return projectRecord(rows[0]);
  }

  async update({ companyId, projectId, actorUserId, name, slug }) {
    const projectName = name === undefined ? null : requiredName(name);
    const normalizedSlug = slug === undefined ? null : projectSlug(slug);
    const { rows } = await this.database.query(
      `UPDATE projects p
       SET name = COALESCE($4, p.name),
           slug = COALESCE($5, p.slug),
           updated_at = now()
       FROM company_memberships actor
       WHERE p.company_id = $1
         AND p.id = $2
         AND p.status = 'active'
         AND actor.company_id = p.company_id
         AND actor.user_id = $3
         AND actor.status = 'active'
         AND actor.role IN ('owner', 'admin')
       RETURNING p.*`,
      [companyId, projectId, actorUserId, projectName, normalizedSlug],
    );
    if (!rows.length) throw fail('Projeto não encontrado.', 404);
    return projectRecord(rows[0]);
  }

  async archive({ companyId, projectId, actorUserId }) {
    const { rows } = await this.database.query(
      `UPDATE projects p
       SET status = 'archived', updated_at = now()
       FROM company_memberships actor
       WHERE p.company_id = $1
         AND p.id = $2
         AND p.status = 'active'
         AND actor.company_id = p.company_id
         AND actor.user_id = $3
         AND actor.status = 'active'
         AND actor.role IN ('owner', 'admin')
       RETURNING p.*`,
      [companyId, projectId, actorUserId],
    );
    if (!rows.length) throw fail('Projeto não encontrado.', 404);
    return projectRecord(rows[0]);
  }

  async grantAccess({ companyId, projectId, actorUserId, userId }) {
    const { rows } = await this.database.query(
      `INSERT INTO project_grants (company_id, membership_id, project_id)
       SELECT p.company_id, target.id, p.id
       FROM projects p
       JOIN company_memberships actor
         ON actor.company_id = p.company_id
        AND actor.user_id = $3
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
       JOIN company_memberships target
         ON target.company_id = p.company_id
        AND target.user_id = $4
        AND target.status = 'active'
       WHERE p.company_id = $1
         AND p.id = $2
         AND p.status = 'active'
       ON CONFLICT (membership_id, project_id) DO UPDATE
       SET company_id = EXCLUDED.company_id
       RETURNING id, company_id, membership_id, project_id`,
      [companyId, projectId, actorUserId, userId],
    );
    if (!rows.length) throw fail('Projeto não encontrado.', 404);
    return {
      id: rows[0].id,
      companyId: rows[0].company_id,
      membershipId: rows[0].membership_id,
      projectId: rows[0].project_id,
    };
  }
}
