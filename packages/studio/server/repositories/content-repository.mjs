import { withTransaction } from '../db/postgres.mjs';
import { hasCapability, normalizeRoute } from '../domain/access.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { allowedPublicationOrigin } from '../publication-cors.mjs';
import { extractVslReferences } from '../publication-snapshot.mjs';
import { renderPublishedVslReferences, resolvePublishedVslReferences } from '../vsl-reference.mjs';
import { WebhookDeliveryRepository } from './webhook-repository.mjs';
import { LeadWebhookRepository } from './lead-webhook-repository.mjs';
import { extractPageCaptureSchema, normalizePageCaptureIds, validatePageCaptureAnswers } from '../page-capture-schema.mjs';
import { capturasDoEstado, documentoDaPagina, ehEstadoAlva, normalizarEstadoAlva } from '../../public/pagina-alva.js';

function fail(message, statusCode) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

const PAGE_CAPTURE_EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Quanto tempo um envio idêntico da mesma pessoa conta como o mesmo lead.
const JANELA_DE_REENVIO_MIN = 30;

// Quem enviou, sem identificar ninguém: o cookie de consentimento da pessoa ou, sem ele, o
// IP e o navegador — em hash, amarrado à captura. Sem nenhum dos dois, não há como saber se
// é a mesma pessoa, e cada envio conta.
// `remetente` é quem fez a requisição, para uso só aqui: diferente do `cliente` que vai às
// plataformas, ele pode ser o endereço do socket, porque vira hash e não sai do Studio.
function chaveDoVisitante({ pageId, captureId, subjectId, remetente }) {
  const pessoa = subjectId ? `s:${subjectId}` : remetente?.ip && remetente?.userAgent ? `c:${remetente.ip}|${remetente.userAgent}` : null;
  return pessoa ? createHash('sha256').update(`${pageId}:${captureId}:${pessoa}`).digest('hex') : null;
}

function requestedTrackingEventId(input) {
  const value = input?.trackingEventId;
  if (value === undefined) return null;
  if (typeof value !== 'string' || !PAGE_CAPTURE_EVENT_ID.test(value)) throw fail('Identificador de envio inválido.', 400);
  return value;
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

// O que se grava de uma página. No esquema do Alva, quem desenha o HTML publicado é o
// servidor, a partir do estado — o HTML que o navegador mandar é ignorado. No formato
// antigo (GrapesJS), o HTML continua vindo pronto do editor.
function paginaParaSalvar(estado, renderedHtml, publicOrigin) {
  if (ehEstadoAlva(estado)) {
    const limpo = normalizarEstadoAlva(estado);
    return { state: limpo, html: documentoDaPagina(limpo, { publicOrigin }) };
  }
  return { state: normalizePageCaptureIds(estado), html: validRenderedHtml(renderedHtml) };
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

// Um quiz é uma página com uma marca: mesmo editor, mesmos elementos, mesmo salvamento.
function pageKindOf(value) {
  const kind = String(value ?? 'page');
  if (!['page', 'quiz'].includes(kind)) throw fail(`Tipo de página desconhecido: ${kind}`, 400);
  return kind;
}

function pageRecord(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    name: row.name,
    route: row.route,
    template: row.template,
    kind: row.kind || 'page',
    editorState: row.editor_state,
    renderedHtml: row.rendered_html,
    lockVersion: row.lock_version,
    publishedVersionId: row.published_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail(`${label} inválido.`, 400);
  return value;
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
  const [submittedAt, id, sourceKind, ...extra] = decoded.split('|');
  if (extra.length || !submittedAt || !UUID.test(id ?? '') || sourceKind !== 'page' || Number.isNaN(Date.parse(submittedAt)))
    throw fail('Cursor inválido.', 400);
  return { submittedAt, id };
}

function encodedLeadCursor(submittedAt, id) {
  const timestamp = submittedAt instanceof Date ? submittedAt.toISOString() : new Date(submittedAt).toISOString();
  return Buffer.from(`${timestamp}|${id}|page`).toString('base64url');
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

async function assertPublishedPathAvailable(client, { companyId, projectId, path, pageId }) {
  const { rowCount } = await client.query(
    `SELECT 1
     FROM pages page
     JOIN page_versions version ON version.id = page.published_version_id
     WHERE page.company_id = $1
       AND page.project_id = $2
       AND page.deleted_at IS NULL
       AND lower(version.published_path) = lower($3)
       AND ($4::uuid IS NULL OR page.id <> $4)
     LIMIT 1`,
    [companyId, projectId, path, pageId],
  );
  if (rowCount) throw fail('Esta rota publicada já está em uso no projeto.', 409);
}

// A origem validada é só o domínio; o caminho publicado é a outra metade. Juntos dão o
// endereço da página onde a pessoa estava, que é o que a plataforma entende.
function enderecoPublicado(origin, publishedPath) {
  if (typeof origin !== 'string' || !origin) return undefined;
  const caminho = typeof publishedPath === 'string' && publishedPath.startsWith('/') ? publishedPath : '';
  return `${origin.replace(/\/$/, '')}${caminho}`;
}

export class ContentRepository {
  constructor(database, { publicOrigin = process.env.PUBLIC_ORIGIN, commercialOutbox = null, commercialConsentResolver = null } = {}) {
    this.database = database;
    this.publicOrigin = publicOrigin;
    this.webhookDeliveries = new WebhookDeliveryRepository(database);
    this.leadWebhooks = new LeadWebhookRepository(database);
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

  async createPage({ companyId, projectId, actorId, name, route: routeValue, template, editorState = {}, renderedHtml = '', kind = 'page', client: suppliedClient = null }) {
    const pageName = requiredName(name, 'Nome da página');
    const pageRoute = route(routeValue);
    const { state, html } = paginaParaSalvar(json(editorState, 'Estado do editor'), renderedHtml, this.publicOrigin);
    const pageTemplate = optionalTemplate(template);
    // Só dois tipos existem; recusar aqui evita uma página órfã, que não apareceria nem
    // na lista de páginas nem na de quizzes.
    const pageKind = pageKindOf(kind);
    try {
      const create = async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
        const routeId = await createRoute(client, { companyId, projectId, path: pageRoute, contentType: 'page' });
        const { rows } = await client.query(
          `INSERT INTO pages (company_id, project_id, route_id, name, template, editor_state, rendered_html, created_by, kind)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
           RETURNING *`,
          [companyId, projectId, routeId, pageName, pageTemplate, JSON.stringify(state), html, actorId, pageKind],
        );
        return pageRecord({ ...rows[0], route: pageRoute });
      };
      return suppliedClient ? await create(suppliedClient) : await withTransaction(this.database, create);
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

  async getPage({ companyId, projectId, actorId, pageId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    return pageRecord(await scopedPage(this.database, { companyId, projectId, pageId }));
  }

  async updatePage({ companyId, projectId, actorId, pageId, lockVersion: expectedLockVersion, ...patch }) {
    const expected = lockVersion(expectedLockVersion);
    try {
      return await withTransaction(this.database, async (client) => {
        await authorizedProject(client, { companyId, projectId, actorId, capability: 'page.write' });
        const current = await scopedPage(client, { companyId, projectId, pageId, lock: true });
        if (current.lock_version !== expected) throw fail('A página mudou em outra aba. Reabra antes de salvar.', 409);
        const salvo = paginaParaSalvar(
          patch.editorState === undefined ? current.editor_state : json(patch.editorState, 'Estado do editor'),
          patch.renderedHtml === undefined ? current.rendered_html : patch.renderedHtml,
          this.publicOrigin,
        );
        const next = {
          name: patch.name === undefined ? current.name : requiredName(patch.name, 'Nome da página'),
          route: patch.route === undefined ? current.route : route(patch.route),
          template: patch.template === undefined ? current.template : optionalTemplate(patch.template),
          editorState: salvo.state,
          renderedHtml: salvo.html,
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

  async projectSubmissions({ companyId, projectId, actorId, sourceKind, sourceId, captureId, limit = 50, cursor }) {
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'submission.read' });
    if (sourceKind !== undefined && sourceKind !== 'page') throw fail('Tipo de origem inválido.', 400);
    if (sourceId !== undefined) uuid(sourceId, 'Origem');
    if (captureId !== undefined) uuid(captureId, 'Captura');
    if (sourceKind && !sourceId) throw fail('Informe a origem.', 400);
    if (captureId && sourceKind !== 'page') throw fail('Captura requer uma página.', 400);
    if (sourceKind === 'page') {
      await scopedPage(this.database, { companyId, projectId, pageId: sourceId });
      if (captureId) {
        const capture = await this.database.query(
          `SELECT 1 FROM page_versions version
           WHERE version.company_id = $1 AND version.project_id = $2 AND version.page_id = $3
             AND jsonb_path_exists(version.capture_schema, '$.forms[*] ? (@.captureId == $captureId)', jsonb_build_object('captureId', to_jsonb($4::text)))
           LIMIT 1`,
          [companyId, projectId, sourceId, captureId],
        );
        if (!capture.rows.length) throw fail('Captura não encontrada.', 404);
      }
    }
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
    const after = leadCursor(cursor);
    const { rows } = await this.database.query(
      `SELECT submission.id, submission.page_id AS source_id,
              submission.page_version_id AS source_version_id, page.name AS source_name,
              version.published_path AS source_path, submission.capture_id,
              version.capture_schema AS source_schema, submission.answers, submission.submitted_at, delivery.status AS webhook_status
       FROM page_submissions submission
       JOIN pages page ON page.id = submission.page_id AND page.company_id = submission.company_id AND page.project_id = submission.project_id AND page.deleted_at IS NULL
       JOIN page_versions version ON version.id = submission.page_version_id AND version.page_id = page.id
       LEFT JOIN webhook_deliveries delivery ON delivery.company_id = submission.company_id AND delivery.project_id = submission.project_id
         AND delivery.page_submission_id = submission.id
       WHERE submission.company_id = $1 AND submission.project_id = $2
         AND ($3::uuid IS NULL OR submission.page_id = $3)
         AND ($4::uuid IS NULL OR submission.capture_id = $4)
         AND ($5::timestamptz IS NULL OR (submission.submitted_at, submission.id) < ($5::timestamptz, $6::uuid))
       ORDER BY submission.submitted_at DESC, submission.id DESC
       LIMIT $7`,
      [companyId, projectId, sourceId ?? null, captureId ?? null, after?.submittedAt ?? null, after?.id ?? null, pageSize + 1],
    );
    const hasNext = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map((row) => {
      const capture = row.source_schema?.forms?.find((item) => item?.captureId === row.capture_id);
      return {
        id: row.id, sourceKind: 'page', sourceId: row.source_id, sourceVersionId: row.source_version_id,
        sourceName: row.source_name || '', sourcePath: row.source_path || '', captureId: row.capture_id || '',
        captureName: capture?.name || '', fields: capture?.fields ?? [],
        answers: row.answers, submittedAt: row.submitted_at,
        webhookStatus: row.webhook_status === 'dead' ? 'failed' : (row.webhook_status || ''),
      };
    });
    const last = items.at(-1);
    const sources = await this.projectSubmissionSources({ companyId, projectId });
    return { items, nextCursor: hasNext ? encodedLeadCursor(last.submittedAt, last.id) : null, sources };
  }

  async projectSubmissionSources({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT page.id AS source_id, page.name AS source_name, version.id AS source_version_id,
              version.published_path AS source_path, (capture->>'captureId')::uuid AS capture_id, capture
       FROM pages page JOIN page_versions version ON version.page_id = page.id
       CROSS JOIN LATERAL jsonb_array_elements(version.capture_schema->'forms') capture
       WHERE page.company_id = $1 AND page.project_id = $2 AND page.deleted_at IS NULL
       ORDER BY source_name, source_id, source_version_id`,
      [companyId, projectId],
    );
    const unique = new Map();
    for (const row of rows) {
      const source = {
        sourceKind: 'page', sourceId: row.source_id, sourceName: row.source_name || '',
        sourcePath: row.source_path || '', captureId: row.capture_id || '', captureName: row.capture?.name || '',
      };
      const key = `${source.sourceId}:${source.captureId}`;
      if (!unique.has(key)) unique.set(key, source);
    }
    return [...unique.values()];
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
    return {
      domain: domains.rows[0]?.domain ?? '', webhook: typeof settings[pageId] === 'string' ? settings[pageId] : '',
      projectWebhookHost: await this.leadWebhooks.host({ companyId, projectId }),
    };
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
        return {
          domain: domains.rows[0]?.domain ?? '', webhook: typeof pageWebhooks[pageId] === 'string' ? pageWebhooks[pageId] : '',
          projectWebhookHost: await this.leadWebhooks.host({ companyId, projectId }, client),
        };
      });
    } catch (error) {
      throw routeConflict(error);
    }
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

  async submitPublishedPageCapture({ companyId, projectId, pageId, pageVersionId, captureId, input, origin, attribution, cliente, remetente, publicationId, subjectId }) {
    return withTransaction(this.database, async (client) => {
      const { rows } = await client.query(
        `SELECT page.id AS page_id, page.name AS page_name, version.id AS version_id,
                version.capture_schema, version.published_path
         FROM pages page JOIN page_versions version
           ON version.page_id = page.id AND version.company_id = page.company_id AND version.project_id = page.project_id
         WHERE page.company_id = $1 AND page.project_id = $2 AND page.id = $3 AND version.id = $4 AND page.deleted_at IS NULL`,
        [companyId, projectId, pageId, pageVersionId],
      );
      if (rows.length !== 1) throw fail('Captura publicada não encontrada.', 404);
      const capture = rows[0].capture_schema?.forms?.find((item) => item?.captureId === captureId);
      if (!capture) throw fail('Captura publicada não encontrada.', 404);
      const answers = validatePageCaptureAnswers(capture, input);
      const retryEventId = requestedTrackingEventId(input);
      // Recarregar a página de obrigado faz o navegador reenviar o POST: mesmas respostas,
      // mesma pessoa. É o mesmo lead, e devolve-se o original em vez de contar outro.
      const visitante = chaveDoVisitante({ pageId, captureId, subjectId, remetente: remetente ?? cliente });
      const reenvio = !retryEventId && visitante
        ? (await client.query(
          `SELECT id, tracking_event_id, submitted_at, answers FROM page_submissions
           WHERE company_id = $1 AND project_id = $2 AND page_id = $3 AND capture_id = $4 AND visitor_key = $5
             AND answers = $6::jsonb AND submitted_at > now() - make_interval(mins => $7)
           ORDER BY submitted_at DESC LIMIT 1`,
          [companyId, projectId, pageId, captureId, visitante, JSON.stringify(answers), JANELA_DE_REENVIO_MIN],
        )).rows[0]
        : null;
      if (reenvio) return { id: reenvio.id, eventId: reenvio.tracking_event_id, answers: reenvio.answers, submittedAt: reenvio.submitted_at, reenvio: true };
      const inserted = retryEventId
        ? await client.query(
          `INSERT INTO page_submissions (company_id, project_id, page_id, page_version_id, capture_id, answers, tracking_event_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT (tracking_event_id) DO NOTHING
           RETURNING id, tracking_event_id, submitted_at`,
          [companyId, projectId, pageId, pageVersionId, captureId, JSON.stringify(answers), retryEventId],
        )
        : await client.query(
          `INSERT INTO page_submissions (company_id, project_id, page_id, page_version_id, capture_id, answers, visitor_key)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id, tracking_event_id, submitted_at`,
          [companyId, projectId, pageId, pageVersionId, captureId, JSON.stringify(answers), visitante],
        );
      const repeated = retryEventId && !inserted.rows.length;
      const submission = repeated
        ? (await client.query(
          `SELECT id, tracking_event_id, submitted_at, answers FROM page_submissions
           WHERE company_id = $1 AND project_id = $2 AND page_id = $3 AND page_version_id = $4 AND capture_id = $5 AND tracking_event_id = $6`,
          [companyId, projectId, pageId, pageVersionId, captureId, retryEventId],
        )).rows[0]
        : inserted.rows[0];
      if (!submission) throw fail('Identificador de envio já pertence a outra captura.', 409);
      if (repeated && JSON.stringify(submission.answers) !== JSON.stringify(answers))
        throw fail('A nova tentativa não corresponde à captura original.', 409);
      const environment = await this.publicationEnvironment(client, { companyId, projectId, origin });
      if (!environment) throw fail('Origem publicada obrigatória para conversões.', 403);
      if (!repeated && this.commercialOutbox) {
        const consentState = this.commercialConsentResolver ? await this.commercialConsentResolver({ companyId, projectId, environment, origin, publicationId, subjectId }) : 'pending';
        // Onde o lead aconteceu viaja com ele. Sem isso a conversão chega à plataforma como
        // "alguém converteu", e separar a landing que funciona da que não funciona vira
        // trabalho manual fora do painel do anúncio.
        await this.commercialOutbox.enqueue(client, {
          companyId, projectId, environment, trackingEventId: submission.tracking_event_id,
          eventName: 'lead', consentState, answers, attribution, cliente, at: submission.submitted_at,
          contexto: { sourceUrl: enderecoPublicado(origin, rows[0].published_path), contentId: pageId, contentName: rows[0].page_name },
        });
      }
      // O destino da página (congelado na versão publicada) vale primeiro; sem ele, cai no do
      // projeto, lido AGORA e não na publicação: quem configura o projeto depois de publicar
      // não precisa republicar cada página. Um lead, uma entrega: nunca os dois.
      const destino = repeated ? '' : (capture.webhook || (await this.leadWebhooks.get({ companyId, projectId }, client)).url);
      if (destino) await this.webhookDeliveries.enqueue(client, { companyId, projectId, pageId, pageSubmissionId: submission.id, url: destino, event: { eventId: submission.tracking_event_id, event: 'page.submitted', companyId, projectId, pageId, pageVersionId, captureId, submittedAt: submission.submitted_at, answers } });
      return { id: submission.id, eventId: submission.tracking_event_id, answers: repeated ? submission.answers : answers, submittedAt: submission.submitted_at };
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
      const setting = await client.query(
        `SELECT configuration FROM project_integrations WHERE company_id = $1 AND project_id = $2 AND provider = 'studio-page-settings' AND environment = 'production' LIMIT 1`,
        [companyId, projectId],
      );
      const pageWebhook = webhook(setting.rows[0]?.configuration?.pageWebhooks?.[pageId] || '');
      const alva = ehEstadoAlva(page.editor_state);
      const normalizedEditorState = alva ? normalizarEstadoAlva(page.editor_state) : normalizePageCaptureIds(page.editor_state);
      const captureSchema = alva ? capturasDoEstado(normalizedEditorState, { webhook: pageWebhook }) : extractPageCaptureSchema(normalizedEditorState, { webhook: pageWebhook });
      if (JSON.stringify(normalizedEditorState) !== JSON.stringify(page.editor_state)) {
        await client.query(
          `UPDATE pages SET editor_state = $4::jsonb, updated_at = now()
           WHERE company_id = $1 AND project_id = $2 AND id = $3`,
          [companyId, projectId, pageId, JSON.stringify(normalizedEditorState)],
        );
      }
      await assertPublishedPathAvailable(client, { companyId, projectId, path: page.route, pageId });
      const number = await client.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM page_versions WHERE page_id = $1',
        [pageId],
      );
      const { rows } = await client.query(
        `INSERT INTO page_versions (company_id, project_id, page_id, version_number, published_path, editor_state, rendered_html, capture_schema, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
         RETURNING *`,
        [companyId, projectId, pageId, number.rows[0].version_number, page.route, JSON.stringify(normalizedEditorState), renderedHtml, JSON.stringify(captureSchema), actorId],
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
    if (!page.rowCount) throw fail('Conteúdo publicado não encontrado.', 404);
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
}
