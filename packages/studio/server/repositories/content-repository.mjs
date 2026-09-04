import { withTransaction } from '../db/postgres.mjs';
import { hasCapability, normalizeRoute } from '../domain/access.mjs';

function fail(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredName(value, label) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100) throw fail(`${label} inválido.`, 400);
  return name;
}

function optionalTemplate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 80) throw fail('Template inválido.', 400);
  return value.trim();
}

function validRenderedHtml(value) {
  if (typeof value !== 'string') throw fail('HTML renderizado inválido.', 400);
  return value;
}

function json(value, label) {
  if (!value || typeof value !== 'object') throw fail(`${label} inválido.`, 400);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw fail(`${label} inválido.`, 400);
  }
}

function route(value) {
  try {
    return normalizeRoute(value);
  } catch (error) {
    throw fail(error.message, 400);
  }
}

function lockVersion(value) {
  if (!Number.isInteger(value) || value < 0) throw fail('Revisão inválida.', 400);
  return value;
}

function routeConflict(error) {
  if (error?.code === '23505') return fail('Esta rota já está em uso no projeto.', 409);
  return error;
}

function pageRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    name: row.name,
    route: row.route,
    template: row.template,
    editorState: row.editor_state,
    renderedHtml: row.rendered_html,
    lockVersion: row.lock_version,
    publishedVersionId: row.published_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    name: row.name,
    route: row.route,
    draftSchema: row.draft_schema,
    lockVersion: row.lock_version,
    publishedVersionId: row.published_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pageVersionRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    pageId: row.page_id,
    versionNumber: row.version_number,
    editorState: row.editor_state,
    renderedHtml: row.rendered_html,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function formVersionRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    formId: row.form_id,
    versionNumber: row.version_number,
    schema: row.schema,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function authorizedProject(client, { companyId, projectId, actorId, capability }) {
  const { rows } = await client.query(
    `SELECT p.id, membership.role
     FROM projects p
     JOIN company_memberships membership
       ON membership.company_id = p.company_id
      AND membership.user_id = $3
      AND membership.status = 'active'
     LEFT JOIN project_grants project_grant
       ON project_grant.company_id = p.company_id
      AND project_grant.project_id = p.id
      AND project_grant.membership_id = membership.id
     WHERE p.company_id = $1
       AND p.id = $2
       AND p.status = 'active'
       AND (membership.role IN ('owner', 'admin') OR project_grant.id IS NOT NULL)`,
    [companyId, projectId, actorId],
  );
  const project = rows[0];
  if (!project) throw fail('Projeto não encontrado.', 404);
  if (capability && !hasCapability(project.role, capability)) throw fail('Sem permissão para este conteúdo.', 403);
  return project;
}

async function scopedPage(client, { companyId, projectId, pageId, lock }) {
  const { rows } = await client.query(
    `SELECT p.*, route.path AS route
     FROM pages p
     JOIN project_routes route
       ON route.id = p.route_id
      AND route.company_id = p.company_id
      AND route.project_id = p.project_id
      AND route.deleted_at IS NULL
     WHERE p.company_id = $1
       AND p.project_id = $2
       AND p.id = $3
       AND p.deleted_at IS NULL
     ${lock ? 'FOR UPDATE' : ''}`,
    [companyId, projectId, pageId],
  );
  if (!rows.length) throw fail('Página não encontrada.', 404);
  return rows[0];
}

async function scopedForm(client, { companyId, projectId, formId, lock }) {
  const { rows } = await client.query(
    `SELECT f.*, route.path AS route
     FROM forms f
     JOIN project_routes route
       ON route.id = f.route_id
      AND route.company_id = f.company_id
      AND route.project_id = f.project_id
      AND route.deleted_at IS NULL
     WHERE f.company_id = $1
       AND f.project_id = $2
       AND f.id = $3
       AND f.deleted_at IS NULL
     ${lock ? 'FOR UPDATE' : ''}`,
    [companyId, projectId, formId],
  );
  if (!rows.length) throw fail('Formulário não encontrado.', 404);
  return rows[0];
}

async function updateRoute(client, { companyId, projectId, routeId, path }) {
  const { rowCount } = await client.query(
    `UPDATE project_routes
     SET path = $4
     WHERE company_id = $1
       AND project_id = $2
       AND id = $3
       AND deleted_at IS NULL`,
    [companyId, projectId, routeId, path],
  );
  if (!rowCount) throw fail('Rota não encontrada.', 404);
}

async function createRoute(client, { companyId, projectId, path, contentType }) {
  const { rows } = await client.query(
    `INSERT INTO project_routes (company_id, project_id, path, content_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [companyId, projectId, path, contentType],
  );
  return rows[0].id;
}

export class ContentRepository {
  constructor(database) {
    this.database = database;
  }

  async createPage({ companyId, projectId, actorId, name, route: routeValue, template, editorState = {}, renderedHtml = '' }) {
    const pageName = requiredName(name, 'Nome da página');
    const pageRoute = route(routeValue);
    const state = json(editorState, 'Estado do editor');
    const html = validRenderedHtml(renderedHtml);
    const pageTemplate = optionalTemplate(template);
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
        const routeId = await createRoute(client, { companyId, projectId, path: pageRoute, contentType: 'page' });
        const { rows } = await client.query(
          `INSERT INTO pages (company_id, project_id, route_id, name, template, editor_state, rendered_html, created_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
           RETURNING *`,
          [companyId, projectId, routeId, pageName, pageTemplate, JSON.stringify(state), html, actorId],
        );
        return pageRecord({ ...rows[0], route: pageRoute });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async createForm({ companyId, projectId, actorId, name, route: routeValue, draftSchema = {} }) {
    const formName = requiredName(name, 'Nome do formulário');
    const formRoute = route(routeValue);
    const schema = json(draftSchema, 'Rascunho do formulário');
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'form.write' });
        const routeId = await createRoute(client, { companyId, projectId, path: formRoute, contentType: 'form' });
        const { rows } = await client.query(
          `INSERT INTO forms (company_id, project_id, route_id, name, draft_schema, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           RETURNING *`,
          [companyId, projectId, routeId, formName, JSON.stringify(schema), actorId],
        );
        return formRecord({ ...rows[0], route: formRoute });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async listPages({ companyId, projectId, actorId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    const { rows } = await this.database.query(
      `SELECT p.*, route.path AS route
       FROM pages p
       JOIN project_routes route ON route.id = p.route_id AND route.deleted_at IS NULL
       WHERE p.company_id = $1 AND p.project_id = $2 AND p.deleted_at IS NULL
       ORDER BY p.created_at, p.id`,
      [companyId, projectId],
    );
    return rows.map(pageRecord);
  }

  async listForms({ companyId, projectId, actorId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    const { rows } = await this.database.query(
      `SELECT f.*, route.path AS route
       FROM forms f
       JOIN project_routes route ON route.id = f.route_id AND route.deleted_at IS NULL
       WHERE f.company_id = $1 AND f.project_id = $2 AND f.deleted_at IS NULL
       ORDER BY f.created_at, f.id`,
      [companyId, projectId],
    );
    return rows.map(formRecord);
  }

  async getPage({ companyId, projectId, actorId, pageId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    return pageRecord(await scopedPage(this.database, { companyId, projectId, pageId }));
  }

  async getForm({ companyId, projectId, actorId, formId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    return formRecord(await scopedForm(this.database, { companyId, projectId, formId }));
  }

  async updatePage({ companyId, projectId, actorId, pageId, lockVersion: expectedLockVersion, ...patch }) {
    const expected = lockVersion(expectedLockVersion);
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
        const current = await scopedPage(client, { companyId, projectId, pageId, lock: true });
        if (current.lock_version !== expected) throw fail('A página mudou em outra aba. Reabra antes de salvar.', 409);
        const next = {
          name: patch.name === undefined ? current.name : requiredName(patch.name, 'Nome da página'),
          route: patch.route === undefined ? current.route : route(patch.route),
          template: patch.template === undefined ? current.template : optionalTemplate(patch.template),
          editorState: patch.editorState === undefined ? current.editor_state : json(patch.editorState, 'Estado do editor'),
          renderedHtml: patch.renderedHtml === undefined ? current.rendered_html : validRenderedHtml(patch.renderedHtml),
        };
        const { rows } = await client.query(
          `UPDATE pages
           SET name = $4,
               template = $5,
               editor_state = $6::jsonb,
               rendered_html = $7,
               lock_version = lock_version + 1,
               updated_at = now()
           WHERE id = $1 AND project_id = $2 AND company_id = $3
             AND lock_version = $8 AND deleted_at IS NULL
           RETURNING *`,
          [pageId, projectId, companyId, next.name, next.template, JSON.stringify(next.editorState), next.renderedHtml, expected],
        );
        if (!rows.length) {
          await scopedPage(client, { companyId, projectId, pageId });
          throw fail('A página mudou em outra aba. Reabra antes de salvar.', 409);
        }
        if (next.route !== current.route) await updateRoute(client, { companyId, projectId, routeId: current.route_id, path: next.route });
        return pageRecord({ ...rows[0], route: next.route });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async updateForm({ companyId, projectId, actorId, formId, lockVersion: expectedLockVersion, ...patch }) {
    const expected = lockVersion(expectedLockVersion);
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'form.write' });
        const current = await scopedForm(client, { companyId, projectId, formId, lock: true });
        if (current.lock_version !== expected) throw fail('O formulário mudou em outra aba. Reabra antes de salvar.', 409);
        const next = {
          name: patch.name === undefined ? current.name : requiredName(patch.name, 'Nome do formulário'),
          route: patch.route === undefined ? current.route : route(patch.route),
          draftSchema: patch.draftSchema === undefined ? current.draft_schema : json(patch.draftSchema, 'Rascunho do formulário'),
        };
        const { rows } = await client.query(
          `UPDATE forms
           SET name = $4,
               draft_schema = $5::jsonb,
               lock_version = lock_version + 1,
               updated_at = now()
           WHERE id = $1 AND project_id = $2 AND company_id = $3
             AND lock_version = $6 AND deleted_at IS NULL
           RETURNING *`,
          [formId, projectId, companyId, next.name, JSON.stringify(next.draftSchema), expected],
        );
        if (!rows.length) {
          await scopedForm(client, { companyId, projectId, formId });
          throw fail('O formulário mudou em outra aba. Reabra antes de salvar.', 409);
        }
        if (next.route !== current.route) await updateRoute(client, { companyId, projectId, routeId: current.route_id, path: next.route });
        return formRecord({ ...rows[0], route: next.route });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async removePage({ companyId, projectId, actorId, pageId, lockVersion: expectedLockVersion }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
      const current = await scopedPage(client, { companyId, projectId, pageId, lock: true });
      if (expectedLockVersion !== undefined && current.lock_version !== lockVersion(expectedLockVersion))
        throw fail('A página mudou em outra aba. Reabra antes de excluir.', 409);
      await client.query('UPDATE pages SET deleted_at = now(), updated_at = now() WHERE id = $1', [pageId]);
      await client.query('UPDATE project_routes SET deleted_at = now() WHERE id = $1', [current.route_id]);
      return { ok: true };
    });
  }

  async removeForm({ companyId, projectId, actorId, formId, lockVersion: expectedLockVersion }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'form.write' });
      const current = await scopedForm(client, { companyId, projectId, formId, lock: true });
      if (expectedLockVersion !== undefined && current.lock_version !== lockVersion(expectedLockVersion))
        throw fail('O formulário mudou em outra aba. Reabra antes de excluir.', 409);
      await client.query('UPDATE forms SET deleted_at = now(), updated_at = now() WHERE id = $1', [formId]);
      await client.query('UPDATE project_routes SET deleted_at = now() WHERE id = $1', [current.route_id]);
      return { ok: true };
    });
  }

  async publishPage({ companyId, projectId, actorId, pageId }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'deployment.publish' });
      const page = await scopedPage(client, { companyId, projectId, pageId, lock: true });
      const number = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM page_versions WHERE page_id = $1',
        [pageId],
      );
      const { rows } = await client.query(
        `INSERT INTO page_versions (company_id, project_id, page_id, version_number, editor_state, rendered_html, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [companyId, projectId, pageId, number.rows[0].version_number, JSON.stringify(page.editor_state), page.rendered_html, actorId],
      );
      await client.query(
        `UPDATE pages
         SET published_version_id = $4, updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, pageId, rows[0].id],
      );
      return pageVersionRecord(rows[0]);
    });
  }

  async publishForm({ companyId, projectId, actorId, formId }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'deployment.publish' });
      const form = await scopedForm(client, { companyId, projectId, formId, lock: true });
      const number = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM form_versions WHERE form_id = $1',
        [formId],
      );
      const { rows } = await client.query(
        `INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *`,
        [companyId, projectId, formId, number.rows[0].version_number, JSON.stringify(form.draft_schema), actorId],
      );
      await client.query(
        `UPDATE forms
         SET published_version_id = $4, updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, formId, rows[0].id],
      );
      return formVersionRecord(rows[0]);
    });
  }

  async getPublicContent({ companyId, projectId, route: routeValue }) {
    const path = route(routeValue);
    const { rows } = await this.database.query(
      `SELECT route.content_type,
              page_version.id AS page_version_id,
              page_version.page_id,
              page_version.version_number AS page_version_number,
              page_version.editor_state,
              page_version.rendered_html,
              page_version.created_at AS page_published_at,
              form_version.id AS form_version_id,
              form_version.form_id,
              form_version.version_number AS form_version_number,
              form_version.schema,
              form_version.created_at AS form_published_at
       FROM project_routes route
       LEFT JOIN pages page
         ON page.route_id = route.id
        AND page.company_id = route.company_id
        AND page.project_id = route.project_id
        AND page.deleted_at IS NULL
       LEFT JOIN page_versions page_version ON page_version.id = page.published_version_id
       LEFT JOIN forms form
         ON form.route_id = route.id
        AND form.company_id = route.company_id
        AND form.project_id = route.project_id
        AND form.deleted_at IS NULL
       LEFT JOIN form_versions form_version ON form_version.id = form.published_version_id
       WHERE route.company_id = $1
         AND route.project_id = $2
         AND lower(route.path) = lower($3)
         AND route.deleted_at IS NULL`,
      [companyId, projectId, path],
    );
    const content = rows[0];
    if (!content || (content.content_type === 'page' && !content.page_version_id) || (content.content_type === 'form' && !content.form_version_id))
      throw fail('Conteúdo publicado não encontrado.', 404);
    if (content.content_type === 'page') {
      return {
        type: 'page',
        id: content.page_version_id,
        pageId: content.page_id,
        versionNumber: content.page_version_number,
        editorState: content.editor_state,
        renderedHtml: content.rendered_html,
        publishedAt: content.page_published_at,
      };
    }
    return {
      type: 'form',
      id: content.form_version_id,
      formId: content.form_id,
      versionNumber: content.form_version_number,
      schema: content.schema,
      publishedAt: content.form_published_at,
    };
  }
}
