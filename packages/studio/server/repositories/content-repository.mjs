import { withTransaction } from '../db/postgres.mjs';
import { hasCapability, normalizeProjectSlug, normalizeRoute } from '../domain/access.mjs';
import { randomUUID } from 'node:crypto';
import { validateFormAnswers } from '../form-answer-validation.mjs';
import { normalizeFormInput } from '../form-store.mjs';
import { allowedPublicationOrigin } from '../publication-cors.mjs';
import { extractVslReferences } from '../publication-snapshot.mjs';
import { renderPublishedVslReferences, resolvePublishedVslReferences } from '../vsl-reference.mjs';
import { WebhookDeliveryRepository } from './webhook-repository.mjs';

function fail(message, statusCode) {
  const error = new Error(message);
  error.status = statusCode;
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

function copyRoute(value) {
  const suffix = `-copia-${randomUUID().slice(0, 8)}`;
  return route(`${value.slice(0, 120 - suffix.length)}${suffix}`);
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
    companySlug: row.company_slug,
    projectSlug: row.project_slug,
    publicPath: row.company_slug && row.project_slug && (row.published_route ?? row.route)
      ? publicFormPath(row.company_slug, row.project_slug, row.published_route ?? row.route)
      : null,
    name: row.name,
    route: row.route,
    draftSchema: row.draft_schema,
    lockVersion: row.lock_version,
    publishedVersionId: row.published_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submissionCount: Number(row.submission_count ?? 0),
  };
}

function publicRoute(value) {
  try {
    return normalizeRoute(value);
  } catch {
    throw fail('Formulário publicado não encontrado.', 404);
  }
}

function publicFormPath(companySlug, projectSlug, path) {
  const encodedRoute = path === '/' ? '' : path.slice(1).split('/').map(encodeURIComponent).join('/');
  return `/f/${encodeURIComponent(companySlug)}/${encodeURIComponent(projectSlug)}/${encodedRoute}`;
}

function domain(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized))
    throw fail('Domínio inválido.', 400);
  return normalized;
}

function webhook(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.length > 2000) throw fail('Webhook inválido.', 400);
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
  } catch {
    throw fail('Informe um webhook HTTPS válido.', 400);
  }
  return normalized;
}

function pageVersionRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    pageId: row.page_id,
    versionNumber: row.version_number,
    publishedPath: row.published_path,
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
    publishedPath: row.published_path,
    schema: row.schema,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function leadCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail('Cursor inválido.', 400);
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw fail('Cursor inválido.', 400);
  }
  if (Buffer.from(decoded).toString('base64url') !== value) throw fail('Cursor inválido.', 400);
  const [submittedAt, id, ...extra] = decoded.split('|');
  if (extra.length || !submittedAt || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '') || Number.isNaN(Date.parse(submittedAt)))
    throw fail('Cursor inválido.', 400);
  return { submittedAt, id };
}

function encodedLeadCursor(submittedAt, id) {
  const timestamp = submittedAt instanceof Date ? submittedAt.toISOString() : new Date(submittedAt).toISOString();
  return Buffer.from(`${timestamp}|${id}`).toString('base64url');
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
    `SELECT f.*, company.slug AS company_slug, project.slug AS project_slug, route.path AS route,
            published_version.published_path AS published_route,
            (SELECT count(*)::int FROM form_submissions submission WHERE submission.form_id = f.id) AS submission_count
     FROM forms f
     JOIN companies company ON company.id = f.company_id
     JOIN projects project ON project.id = f.project_id AND project.company_id = f.company_id
     LEFT JOIN form_versions published_version ON published_version.id = f.published_version_id
     JOIN project_routes route
       ON route.id = f.route_id
      AND route.company_id = f.company_id
      AND route.project_id = f.project_id
      AND route.deleted_at IS NULL
     WHERE f.company_id = $1
       AND f.project_id = $2
       AND f.id = $3
       AND f.deleted_at IS NULL
     ${lock ? 'FOR UPDATE OF f' : ''}`,
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

async function assertPublishedPathAvailable(client, { companyId, projectId, path, contentId, contentType }) {
  const pageId = contentType === 'page' ? contentId : null;
  const formId = contentType === 'form' ? contentId : null;
  const { rowCount } = await client.query(
    `SELECT 1
     FROM pages page
     JOIN page_versions version ON version.id = page.published_version_id
     WHERE page.company_id = $1
       AND page.project_id = $2
       AND page.deleted_at IS NULL
       AND lower(version.published_path) = lower($3)
       AND ($4::uuid IS NULL OR page.id <> $4)
     UNION ALL
     SELECT 1
     FROM forms form
     JOIN form_versions version ON version.id = form.published_version_id
     WHERE form.company_id = $1
       AND form.project_id = $2
       AND form.deleted_at IS NULL
       AND lower(version.published_path) = lower($3)
       AND ($5::uuid IS NULL OR form.id <> $5)
     LIMIT 1`,
    [companyId, projectId, path, pageId, formId],
  );
  if (rowCount) throw fail('Esta rota publicada já está em uso no projeto.', 409);
}

export class ContentRepository {
  constructor(database, { publicOrigin = process.env.PUBLIC_ORIGIN, commercialOutbox = null, commercialConsentResolver = null } = {}) {
    this.database = database;
    this.publicOrigin = publicOrigin;
    this.webhookDeliveries = new WebhookDeliveryRepository(database);
    this.commercialOutbox = commercialOutbox;
    this.commercialConsentResolver = commercialConsentResolver;
  }

  async assertPublishedVslReferences(client, { companyId, projectId, editorState, schema }) {
    const references = extractVslReferences(editorState).concat(extractVslReferences(schema));
    if (!references.length) return new Map();
    try {
      return await resolvePublishedVslReferences({ database: client, companyId, projectId, publicOrigin: this.publicOrigin, references });
    } catch (error) {
      if (error?.status === 404) throw fail(`${error.message} Publique a VSL antes de publicar este conteúdo.`, 409);
      throw error;
    }
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
    const schema = normalizeFormInput(draftSchema);
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
        const project = await client.query(
          `SELECT company.slug AS company_slug, project.slug AS project_slug
           FROM projects project JOIN companies company ON company.id = project.company_id
           WHERE project.company_id = $1 AND project.id = $2`, [companyId, projectId],
        );
        return formRecord({ ...rows[0], route: formRoute, ...project.rows[0] });
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
    `SELECT f.*, company.slug AS company_slug, project.slug AS project_slug, route.path AS route,
            published_version.published_path AS published_route,
            (SELECT count(*)::int FROM form_submissions submission WHERE submission.form_id = f.id) AS submission_count
       FROM forms f
       JOIN companies company ON company.id = f.company_id
       JOIN projects project ON project.id = f.project_id AND project.company_id = f.company_id
       LEFT JOIN form_versions published_version ON published_version.id = f.published_version_id
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
          draftSchema: normalizeFormInput(patch.draftSchema === undefined ? current.draft_schema : patch.draftSchema),
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
        return formRecord({
          ...rows[0], route: next.route, company_slug: current.company_slug,
          project_slug: current.project_slug, published_route: current.published_route,
        });
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
      const page = await client.query(
        `UPDATE pages
         SET deleted_at = now(), updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, pageId],
      );
      if (page.rowCount !== 1) throw fail('Página não encontrada.', 404);
      const route = await client.query(
        `UPDATE project_routes
         SET deleted_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, current.route_id],
      );
      if (route.rowCount !== 1) throw fail('Rota não encontrada.', 404);
      return { ok: true };
    });
  }

  async removeForm({ companyId, projectId, actorId, formId, lockVersion: expectedLockVersion }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'form.write' });
      const current = await scopedForm(client, { companyId, projectId, formId, lock: true });
      if (expectedLockVersion !== undefined && current.lock_version !== lockVersion(expectedLockVersion))
        throw fail('O formulário mudou em outra aba. Reabra antes de excluir.', 409);
      const form = await client.query(
        `UPDATE forms
         SET deleted_at = now(), updated_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, formId],
      );
      if (form.rowCount !== 1) throw fail('Formulário não encontrado.', 404);
      const route = await client.query(
        `UPDATE project_routes
         SET deleted_at = now()
         WHERE company_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [companyId, projectId, current.route_id],
      );
      if (route.rowCount !== 1) throw fail('Rota não encontrada.', 404);
      return { ok: true };
    });
  }

  async duplicatePage({ companyId, projectId, actorId, pageId }) {
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
        const source = await scopedPage(client, { companyId, projectId, pageId, lock: false });
        const nextRoute = copyRoute(source.route);
        const routeId = await createRoute(client, { companyId, projectId, path: nextRoute, contentType: 'page' });
        const { rows } = await client.query(
          `INSERT INTO pages (company_id, project_id, route_id, name, template, editor_state, rendered_html, created_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *`,
          [companyId, projectId, routeId, `${source.name} — cópia`.slice(0, 100), source.template,
            JSON.stringify(source.editor_state), source.rendered_html, actorId],
        );
        return pageRecord({ ...rows[0], route: nextRoute });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async duplicateForm({ companyId, projectId, actorId, formId }) {
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'form.write' });
        const source = await scopedForm(client, { companyId, projectId, formId, lock: false });
        const nextRoute = copyRoute(source.route);
        const routeId = await createRoute(client, { companyId, projectId, path: nextRoute, contentType: 'form' });
        const schema = { ...source.draft_schema, webhook: '' };
        const { rows } = await client.query(
          `INSERT INTO forms (company_id, project_id, route_id, name, draft_schema, created_by)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
          [companyId, projectId, routeId, `${source.name} — cópia`.slice(0, 100), JSON.stringify(schema), actorId],
        );
        return formRecord({ ...rows[0], route: nextRoute, company_slug: source.company_slug, project_slug: source.project_slug });
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async submissions({ companyId, projectId, actorId, formId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'submission.read' });
    await scopedForm(this.database, { companyId, projectId, formId });
    const { rows } = await this.database.query(
      `SELECT id, answers, submitted_at
       FROM form_submissions
       WHERE company_id = $1 AND project_id = $2 AND form_id = $3
       ORDER BY submitted_at DESC, id DESC`,
      [companyId, projectId, formId],
    );
    return rows.map((row) => ({ id: row.id, formId, answers: row.answers, submittedAt: row.submitted_at }));
  }

  async projectSubmissions({ companyId, projectId, actorId, formId, limit = 50, cursor }) {
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'submission.read' });
    if (formId) await scopedForm(this.database, { companyId, projectId, formId });
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
    const after = leadCursor(cursor);
    const { rows } = await this.database.query(
      `SELECT submission.id, submission.form_id, form.name AS form_name, submission.answers,
              submission.submitted_at, submission.tracking_status
       FROM form_submissions submission
       JOIN forms form
         ON form.id = submission.form_id
        AND form.company_id = submission.company_id
        AND form.project_id = submission.project_id
        AND form.deleted_at IS NULL
       WHERE submission.company_id = $1
         AND submission.project_id = $2
         AND ($3::uuid IS NULL OR submission.form_id = $3)
         AND ($4::timestamptz IS NULL OR (submission.submitted_at, submission.id) < ($4::timestamptz, $5::uuid))
       ORDER BY submission.submitted_at DESC, submission.id DESC
       LIMIT $6`,
      [companyId, projectId, formId ?? null, after?.submittedAt ?? null, after?.id ?? null, pageSize + 1],
    );
    const hasNext = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map((row) => ({
      id: row.id,
      formId: row.form_id,
      formName: row.form_name,
      answers: row.answers,
      submittedAt: row.submitted_at,
      webhookStatus: row.tracking_status,
    }));
    const last = items.at(-1);
    return { items, nextCursor: hasNext ? encodedLeadCursor(last.submittedAt, last.id) : null };
  }

  async pageSettings({ companyId, projectId, actorId, pageId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    await scopedPage(this.database, { companyId, projectId, pageId });
    const [domains, integrations] = await Promise.all([
      this.database.query(
        `SELECT domain FROM project_domains
         WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND is_canonical
         ORDER BY updated_at DESC LIMIT 1`, [companyId, projectId],
      ),
      this.database.query(
        `SELECT configuration FROM project_integrations
         WHERE company_id = $1 AND project_id = $2 AND provider = 'studio-page-settings' AND environment = 'production'`,
        [companyId, projectId],
      ),
    ]);
    const settings = integrations.rows[0]?.configuration?.pageWebhooks ?? {};
    return { domain: domains.rows[0]?.domain ?? '', webhook: typeof settings[pageId] === 'string' ? settings[pageId] : '' };
  }

  validatePageSettings({ domain: domainValue, webhook: webhookValue }) {
    if (domainValue !== undefined) domain(domainValue);
    if (webhookValue !== undefined) webhook(webhookValue);
  }

  async updatePageSettings({ companyId, projectId, actorId, pageId, domain: domainValue, webhook: webhookValue }) {
    if (domainValue === undefined && webhookValue === undefined) return this.pageSettings({ companyId, projectId, actorId, pageId });
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'integration.manage' });
        await scopedPage(client, { companyId, projectId, pageId, lock: true });
        if (domainValue !== undefined) {
          const nextDomain = domain(domainValue);
          if (!nextDomain) {
            await client.query(
              `DELETE FROM project_domains
               WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND is_canonical`,
              [companyId, projectId],
            );
          } else {
            const existing = await client.query(
              `SELECT id FROM project_domains
               WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND is_canonical FOR UPDATE`,
              [companyId, projectId],
            );
            if (existing.rowCount) {
              await client.query(
                `UPDATE project_domains SET domain = $4, verification_status = 'pending', updated_at = now()
                 WHERE company_id = $1 AND project_id = $2 AND id = $3`,
                [companyId, projectId, existing.rows[0].id, nextDomain],
              );
            } else {
              await client.query(
                `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical)
                 VALUES ($1, $2, 'production', $3, true)`, [companyId, projectId, nextDomain],
              );
            }
          }
        }
        if (webhookValue !== undefined) {
          const nextWebhook = webhook(webhookValue);
          const current = await client.query(
            `SELECT id, configuration FROM project_integrations
             WHERE company_id = $1 AND project_id = $2 AND provider = 'studio-page-settings' AND environment = 'production' FOR UPDATE`,
            [companyId, projectId],
          );
          const pageWebhooks = { ...(current.rows[0]?.configuration?.pageWebhooks ?? {}) };
          if (nextWebhook) pageWebhooks[pageId] = nextWebhook;
          else delete pageWebhooks[pageId];
          if (current.rowCount) {
            await client.query(
              `UPDATE project_integrations SET configuration = $4::jsonb, updated_at = now()
               WHERE company_id = $1 AND project_id = $2 AND id = $3`,
              [companyId, projectId, current.rows[0].id, JSON.stringify({ pageWebhooks })],
            );
          } else {
            await client.query(
              `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration)
               VALUES ($1, $2, 'studio-page-settings', 'production', $3::jsonb)`,
              [companyId, projectId, JSON.stringify({ pageWebhooks })],
            );
          }
        }
        const [domains, integrations] = await Promise.all([
          client.query(
            `SELECT domain FROM project_domains
             WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND is_canonical
             ORDER BY updated_at DESC LIMIT 1`, [companyId, projectId],
          ),
          client.query(
            `SELECT configuration FROM project_integrations
             WHERE company_id = $1 AND project_id = $2 AND provider = 'studio-page-settings' AND environment = 'production'`,
            [companyId, projectId],
          ),
        ]);
        const pageWebhooks = integrations.rows[0]?.configuration?.pageWebhooks ?? {};
        return { domain: domains.rows[0]?.domain ?? '', webhook: typeof pageWebhooks[pageId] === 'string' ? pageWebhooks[pageId] : '' };
      });
    } catch (error) {
      throw routeConflict(error);
    }
  }

  async publishedFormForProject(client, { companySlug, projectSlug, route: routeValue, slug }) {
    const publishedPath = publicRoute(routeValue ?? slug);
    const normalizedCompany = normalizeProjectSlug(companySlug);
    const normalizedProject = normalizeProjectSlug(projectSlug);
    const { rows } = await client.query(
      `SELECT form.id, form.company_id, form.project_id, form.name, version.id AS version_id, version.schema,
              company.slug AS company_slug, project.slug AS project_slug, version.published_path
       FROM forms form
       JOIN companies company ON company.id = form.company_id
       JOIN projects project ON project.id = form.project_id AND project.company_id = form.company_id
       JOIN form_versions version ON version.id = form.published_version_id
       WHERE company.slug = $1
         AND company.status = 'active'
         AND project.slug = $2
         AND project.status = 'active'
         AND version.published_path = $3
         AND form.deleted_at IS NULL`,
      [normalizedCompany, normalizedProject, publishedPath],
    );
    if (rows.length !== 1) throw fail('Formulário publicado não encontrado.', 404);
    return rows[0];
  }

  async publishedFormForDomain(client, { host, route: routeValue, slug }) {
    const publishedPath = publicRoute(routeValue ?? slug);
    const normalizedHost = domain(String(host).replace(/^\[/, '').replace(/\]$/, '').split(':')[0]);
    if (!normalizedHost) throw fail('Formulário publicado não encontrado.', 404);
    const { rows } = await client.query(
      `SELECT form.id, form.company_id, form.project_id, form.name, version.id AS version_id, version.schema,
              company.slug AS company_slug, project.slug AS project_slug, version.published_path
       FROM project_domains project_domain
       JOIN companies company ON company.id = project_domain.company_id
       JOIN projects project ON project.id = project_domain.project_id AND project.company_id = project_domain.company_id
       JOIN forms form ON form.project_id = project.id AND form.company_id = project.company_id AND form.deleted_at IS NULL
       JOIN form_versions version ON version.id = form.published_version_id
       WHERE lower(project_domain.domain) = lower($1)
         AND project_domain.environment = 'production'
         AND project_domain.is_canonical
         AND project_domain.verification_status = 'verified'
         AND company.status = 'active'
         AND project.status = 'active'
         AND version.published_path = $2`, [normalizedHost, publishedPath],
    );
    if (rows.length !== 1) throw fail('Formulário publicado não encontrado.', 404);
    return rows[0];
  }

  publicFormRecord(form, routeValue) {
    return {
      id: form.id,
      companyId: form.company_id,
      projectId: form.project_id,
      companySlug: form.company_slug,
      projectSlug: form.project_slug,
      publicPath: publicFormPath(form.company_slug, form.project_slug, form.published_path),
      versionId: form.version_id,
      name: form.name,
      slug: routeValue === '/' ? '' : routeValue.replace(/^\//, ''),
      ...form.schema,
    };
  }

  async publicFormForProject({ companySlug, projectSlug, route: routeValue, slug }) {
    const path = publicRoute(routeValue ?? slug);
    return this.publicFormRecord(await this.publishedFormForProject(this.database, { companySlug, projectSlug, route: path }), path);
  }

  async publicationOrigins({ companySlug, projectSlug, environment }) {
    const { rows } = await this.database.query(
      `SELECT domain AS origin FROM project_domains domain
        JOIN companies company ON company.id = domain.company_id AND company.slug = $1
        JOIN projects project ON project.id = domain.project_id AND project.company_id = domain.company_id AND project.slug = $2
       WHERE domain.environment = COALESCE($3, domain.environment) AND domain.verification_status = 'verified'
       UNION
       SELECT run.external_url AS origin FROM deployment_runs run
        JOIN companies company ON company.id = run.company_id AND company.slug = $1
        JOIN projects project ON project.id = run.project_id AND project.company_id = run.company_id AND project.slug = $2
       WHERE run.status = 'READY' AND run.external_url IS NOT NULL AND run.environment = COALESCE($3, run.environment)`,
      [companySlug, projectSlug, environment || null],
    );
    return rows.map((row) => String(row.origin).startsWith('http') ? row.origin : `https://${row.origin}`);
  }

  async isPublicOriginAllowed({ companySlug, projectSlug, origin }) {
    return allowedPublicationOrigin(origin, await this.publicationOrigins({ companySlug, projectSlug }));
  }

  async publicFormForDomain({ host, route: routeValue, slug }) {
    const path = publicRoute(routeValue ?? slug);
    return this.publicFormRecord(await this.publishedFormForDomain(this.database, { host, route: path }), path);
  }

  async submitPublicFormForProject({ companySlug, projectSlug, route: routeValue, slug, input, origin, attribution, publicationId, subjectId }) {
    const path = publicRoute(routeValue ?? slug);
    return this.submitPublishedForm({
      resolve: (client) => this.publishedFormForProject(client, { companySlug, projectSlug, route: path }),
      route: path,
      input, origin, attribution, publicationId, subjectId,
    });
  }

  async submitPublicFormForDomain({ host, route: routeValue, slug, input, origin, attribution, publicationId, subjectId }) {
    const path = publicRoute(routeValue ?? slug);
    return this.submitPublishedForm({
      resolve: (client) => this.publishedFormForDomain(client, { host, route: path }),
      route: path,
      input, origin, attribution, publicationId, subjectId,
    });
  }

  async submitPublishedForm({ resolve, route: routeValue, input, origin, attribution, publicationId, subjectId }) {
    return withTransaction(this.database, async (client) => {
      const form = await resolve(client);
      const answers = validateFormAnswers(form.schema, input);
      const { rows } = await client.query(
        `INSERT INTO form_submissions (company_id, project_id, form_id, form_version_id, answers)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, tracking_event_id, submitted_at`,
        [form.company_id, form.project_id, form.id, form.version_id, JSON.stringify(answers)],
      );
      const submissionId = rows[0].id;
      const eventId = rows[0].tracking_event_id;
      if (this.commercialOutbox) {
        const environment = await this.publicationEnvironment(client, { companyId: form.company_id, projectId: form.project_id, origin });
        if (!environment) throw fail('Origem publicada obrigatória para conversões.', 403);
        const consentState = this.commercialConsentResolver ? await this.commercialConsentResolver({ companyId: form.company_id, projectId: form.project_id, environment, origin, publicationId, subjectId }) : 'pending';
        await this.commercialOutbox.enqueue(client, {
          companyId: form.company_id, projectId: form.project_id, environment,
          trackingEventId: eventId, eventName: 'lead', consentState, answers, attribution, at: rows[0].submitted_at,
        });
      }
      let webhookDelivery = null;
      if (form.schema.webhook) {
        // Enfileira na mesma transação da submissão: a entrega nunca fica órfã (submissão sem
        // fila) nem duplicada (fila sem submissão) — os dois só existem juntos, ou nenhum existe.
        await this.webhookDeliveries.enqueue(client, {
          companyId: form.company_id,
          projectId: form.project_id,
          formId: form.id,
          submissionId,
          url: form.schema.webhook,
          event: {
            eventId,
            event: 'form.submitted',
            companyId: form.company_id,
            projectId: form.project_id,
            formId: form.id,
            submittedAt: rows[0].submitted_at,
            answers,
          },
        });
        webhookDelivery = { status: 'queued' };
      }
      return {
        id: submissionId,
        eventId,
        form: {
          id: form.id,
          companyId: form.company_id,
          projectId: form.project_id,
          name: form.name,
          slug: routeValue === '/' ? '' : routeValue.replace(/^\//, ''),
          companySlug: form.company_slug,
          projectSlug: form.project_slug,
        },
        schema: form.schema,
        answers,
        submittedAt: rows[0].submitted_at,
        webhookDelivery,
      };
    });
  }

  async publicationEnvironment(client, { companyId, projectId, origin }) {
    let normalized;
    try { normalized = new URL(String(origin)).origin; } catch { return null; }
    const { rows } = await client.query(
      `SELECT environment FROM project_domains WHERE company_id = $1 AND project_id = $2
         AND verification_status = 'verified' AND lower('https://' || domain) = lower($3)
       UNION
       SELECT environment FROM deployment_runs WHERE company_id = $1 AND project_id = $2
         AND status = 'READY' AND external_url IS NOT NULL AND lower(external_url) = lower($3)`,
      [companyId, projectId, normalized],
    );
    return rows.length === 1 && ['preview', 'production'].includes(rows[0].environment) ? rows[0].environment : null;
  }

  async publishPage({ companyId, projectId, actorId, pageId, lockVersion: expectedLockVersion }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'deployment.publish' });
      const page = await scopedPage(client, { companyId, projectId, pageId, lock: true });
      if (expectedLockVersion !== undefined && page.lock_version !== lockVersion(expectedLockVersion))
        throw fail('A página mudou em outra aba. Reabra antes de publicar.', 409);
      const resolvedVsl = await this.assertPublishedVslReferences(client, { companyId, projectId, editorState: page.editor_state });
      const renderedHtml = renderPublishedVslReferences(page.rendered_html, { vslEmbedUrls: resolvedVsl });
      await assertPublishedPathAvailable(client, {
        companyId, projectId, path: page.route, contentId: pageId, contentType: 'page',
      });
      const number = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM page_versions WHERE page_id = $1',
        [pageId],
      );
      const { rows } = await client.query(
        `INSERT INTO page_versions (company_id, project_id, page_id, version_number, published_path, editor_state, rendered_html, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [companyId, projectId, pageId, number.rows[0].version_number, page.route, JSON.stringify(page.editor_state), renderedHtml, actorId],
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

  async publishForm({ companyId, projectId, actorId, formId, lockVersion: expectedLockVersion }) {
    return withTransaction(this.database, async (client) => {
      await authorizedProject(client, { companyId, projectId, actorId, capability: 'deployment.publish' });
      const form = await scopedForm(client, { companyId, projectId, formId, lock: true });
      if (expectedLockVersion !== undefined && form.lock_version !== lockVersion(expectedLockVersion))
        throw fail('O formulário mudou em outra aba. Reabra antes de publicar.', 409);
      const schema = normalizeFormInput(form.draft_schema);
      await this.assertPublishedVslReferences(client, { companyId, projectId, schema });
      await assertPublishedPathAvailable(client, {
        companyId, projectId, path: form.route, contentId: formId, contentType: 'form',
      });
      const number = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM form_versions WHERE form_id = $1',
        [formId],
      );
      const { rows } = await client.query(
        `INSERT INTO form_versions (company_id, project_id, form_id, version_number, published_path, schema, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING *`,
        [companyId, projectId, formId, number.rows[0].version_number, form.route, JSON.stringify(schema), actorId],
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
    const page = await this.database.query(
      `SELECT version.*
       FROM pages page
       JOIN page_versions version ON version.id = page.published_version_id
       WHERE page.company_id = $1
         AND page.project_id = $2
         AND page.deleted_at IS NULL
         AND lower(version.published_path) = lower($3)`,
      [companyId, projectId, path],
    );
    if (page.rowCount) {
      const content = page.rows[0];
      return {
        type: 'page',
        id: content.id,
        pageId: content.page_id,
        versionNumber: content.version_number,
        editorState: content.editor_state,
        renderedHtml: content.rendered_html,
        publishedAt: content.created_at,
      };
    }
    const form = await this.database.query(
      `SELECT version.*
       FROM forms form
       JOIN form_versions version ON version.id = form.published_version_id
       WHERE form.company_id = $1
         AND form.project_id = $2
         AND form.deleted_at IS NULL
         AND lower(version.published_path) = lower($3)`,
      [companyId, projectId, path],
    );
    if (!form.rowCount) throw fail('Conteúdo publicado não encontrado.', 404);
    const content = form.rows[0];
    return {
      type: 'form',
      id: content.id,
      formId: content.form_id,
      versionNumber: content.version_number,
      schema: content.schema,
      publishedAt: content.created_at,
    };
  }
}
