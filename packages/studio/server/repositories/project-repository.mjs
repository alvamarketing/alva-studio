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

  async overview({ companyId, projectId, userId }) {
    const project = await this.getAuthorized({ companyId, projectId, userId });
    const [counts, content, domain, integrationRows] = await Promise.all([
      this.database.query(
        `SELECT
           (SELECT count(*)::int FROM pages page
            WHERE page.company_id = $1 AND page.project_id = $2 AND page.deleted_at IS NULL) AS pages,
           (SELECT count(*)::int FROM forms form
            WHERE form.company_id = $1 AND form.project_id = $2 AND form.deleted_at IS NULL) AS forms,
           (SELECT count(*)::int FROM pages page
            WHERE page.company_id = $1 AND page.project_id = $2
              AND page.deleted_at IS NULL AND page.published_version_id IS NOT NULL) AS "publishedPages",
           (SELECT count(*)::int FROM forms form
            WHERE form.company_id = $1 AND form.project_id = $2
              AND form.deleted_at IS NULL AND form.published_version_id IS NOT NULL) AS "publishedForms",
           (SELECT count(*)::int FROM form_submissions submission
            JOIN forms form ON form.id = submission.form_id
            WHERE submission.company_id = $1 AND submission.project_id = $2 AND form.deleted_at IS NULL) AS submissions`,
        [companyId, projectId],
      ),
      this.database.query(
        `SELECT * FROM (
           SELECT page.id, 'page' AS kind, page.name, route.path AS route,
                  (page.published_version_id IS NOT NULL) AS published, page.updated_at,
                  0::int AS submission_count
           FROM pages page
           JOIN project_routes route
             ON route.id = page.route_id
            AND route.company_id = page.company_id
            AND route.project_id = page.project_id
            AND route.deleted_at IS NULL
           WHERE page.company_id = $1 AND page.project_id = $2 AND page.deleted_at IS NULL
           UNION ALL
           SELECT form.id, 'form' AS kind, form.name, route.path AS route,
                  (form.published_version_id IS NOT NULL) AS published, form.updated_at,
                  (SELECT count(*)::int FROM form_submissions submission WHERE submission.form_id = form.id) AS submission_count
           FROM forms form
           JOIN project_routes route
             ON route.id = form.route_id
            AND route.company_id = form.company_id
            AND route.project_id = form.project_id
            AND route.deleted_at IS NULL
           WHERE form.company_id = $1 AND form.project_id = $2 AND form.deleted_at IS NULL
         ) content
         ORDER BY updated_at DESC, kind, id`,
        [companyId, projectId],
      ),
      this.database.query(
        `SELECT domain, verification_status
         FROM project_domains
         WHERE company_id = $1 AND project_id = $2
           AND environment = 'production' AND is_canonical AND verification_status = 'verified'
         ORDER BY updated_at DESC, id DESC LIMIT 1`,
        [companyId, projectId],
      ),
      this.database.query(
        `SELECT provider
         FROM project_integrations
         WHERE company_id = $1 AND project_id = $2
           AND environment = 'production' AND provider IN ('vercel', 'analytics', 'agents')`,
        [companyId, projectId],
      ),
    ]);
    const configured = new Set(integrationRows.rows.map((row) => row.provider));
    return {
      project,
      counts: counts.rows[0],
      content: content.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        route: row.route,
        published: row.published,
        updatedAt: row.updated_at,
        submissionCount: row.submission_count,
      })),
      domain: domain.rows[0]
        ? { domain: domain.rows[0].domain, verificationStatus: domain.rows[0].verification_status }
        : null,
      integrations: {
        vercel: configured.has('vercel') ? 'configured' : 'pending',
        analytics: configured.has('analytics') ? 'configured' : 'pending',
        agents: configured.has('agents') ? 'configured' : 'pending',
      },
    };
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
