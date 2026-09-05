import { createHash } from 'node:crypto';
import { normalizeRoute } from './domain/access.mjs';
import { normalizeFormInput } from './form-store.mjs';
import { renderDynamicForm } from './dynamic-form.mjs';
import { renderPublishedVslReferences, resolvePublishedVslReferences } from './vsl-reference.mjs';
import { formContentSecurityPolicy } from './content-security-policy.mjs';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function pathFile(path) {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`;
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function withoutFrameAncestors(policy) {
  return policy.split('; ').filter((directive) => !directive.startsWith('frame-ancestors')).join('; ');
}

// A página estática ainda não emite CSP (fica para a fase 2, via cabeçalho em vercel.json);
// aqui só entra o script do tracker, no mesmo padrão do formulário.
function injectPageTracker(html, { nonce, trackerPublicId }) {
  if (!trackerPublicId) return html;
  const script = `<script src="/tracker.js" data-alva-tracker="${escapeAttribute(trackerPublicId)}" nonce="${escapeAttribute(nonce)}"></script>`;
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
}

function injectPublicationCsp(html, policy) {
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`);
}

async function resolveAnalyticsTrackerPublicId(database, companyId, projectId) {
  const { rows } = await database.query(
    `SELECT tracker_public_id FROM analytics_websites WHERE company_id = $1 AND project_id = $2 AND environment = 'production' LIMIT 1`,
    [companyId, projectId],
  );
  return rows[0]?.tracker_public_id || null;
}

function publicFormAction(publicOrigin, companySlug, projectSlug, path) {
  const origin = new URL(publicOrigin);
  const segments = path === '/' ? [] : path.slice(1).split('/');
  const route = segments.map((segment) => encodeURIComponent(segment)).join('/');
  origin.pathname = `/api/public/forms/${encodeURIComponent(companySlug)}/${encodeURIComponent(projectSlug)}${route ? `/${route}` : ''}/submissions`;
  origin.search = '';
  origin.hash = '';
  return origin.toString();
}

const VSL_COMPONENT_KEYS = new Set([
  'id', 'type', 'publicId', 'title', 'description', 'required', 'motion', 'advanceAfterCta', 'tagName', 'attributes', 'components', 'style', 'classes', 'droppable',
]);
const VSL_PRESENTATION_ATTRIBUTES = new Set(['data-alva-vsl', 'data-alva-motion']);
const VSL_MOTION_VALUES = new Set(['fade-up', 'slide-left', 'zoom-in', 'float']);

function canonicalVslReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Referência de VSL inválida.', 400);
  if (Object.keys(value).some((key) => !VSL_COMPONENT_KEYS.has(key))) throw fail('Referência de VSL inválida.', 400);
  const attributes = value.attributes;
  if (attributes !== undefined && (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)))
    throw fail('Referência de VSL inválida.', 400);
  if (attributes && Object.keys(attributes).some((key) => !VSL_PRESENTATION_ATTRIBUTES.has(key))) throw fail('Referência de VSL inválida.', 400);
  const motion = attributes?.['data-alva-motion'];
  if (motion !== undefined && (typeof motion !== 'string' || !VSL_MOTION_VALUES.has(motion.trim()))) throw fail('Referência de VSL inválida.', 400);
  const publicId = typeof value.publicId === 'string' ? value.publicId.trim() : '';
  const attributeId = typeof attributes?.['data-alva-vsl'] === 'string' ? attributes['data-alva-vsl'].trim() : '';
  if (value.publicId !== undefined && typeof value.publicId !== 'string') throw fail('Referência de VSL inválida.', 400);
  if (attributes?.['data-alva-vsl'] !== undefined && !attributeId) throw fail('Referência de VSL inválida.', 400);
  if (publicId && attributeId && publicId !== attributeId) throw fail('Referência de VSL inválida.', 400);
  if (!publicId && !attributeId) throw fail('Referência de VSL inválida.', 400);
  if (value.motion !== undefined && (typeof value.motion !== 'string' || !VSL_MOTION_VALUES.has(value.motion.trim()))) throw fail('Referência de VSL inválida.', 400);
  if (value.advanceAfterCta !== undefined && typeof value.advanceAfterCta !== 'boolean') throw fail('Referência de VSL inválida.', 400);
  return { type: 'vsl', publicId: publicId || attributeId };
}

function vslReferences(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) vslReferences(item, output);
  } else if (value && typeof value === 'object') {
    if (value.type === 'vsl') output.push(canonicalVslReference(value));
    else for (const item of Object.values(value)) vslReferences(item, output);
  }
  return output;
}

export function extractVslReferences(value) {
  return vslReferences(value);
}

function validateOrigin(value) {
  try {
    const origin = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
      throw new Error('origin');
    return origin.toString().slice(0, -1);
  } catch {
    throw fail('PUBLIC_ORIGIN deve ser uma origem absoluta válida.', 500);
  }
}

function recordForRow(row, publicOrigin, vslEmbedUrls = new Map(), { nonce, trackerPublicId } = {}) {
  if (!row || !['page', 'form'].includes(row.kind)) throw fail('Conteúdo publicado inválido.', 409);
  let path;
  try { path = normalizeRoute(row.path); } catch { throw fail('A publicação contém uma rota inválida.', 409); }
  if (!row.company_id || !row.project_id || !row.content_id || !row.version_id) throw fail('A publicação contém uma versão inválida.', 409);
  if (row.kind === 'page') {
    if (typeof row.rendered_html !== 'string' || !row.rendered_html.trim()) throw fail('A publicação contém uma página vazia.', 409);
    const pageHtml = renderPublishedVslReferences(row.rendered_html, { vslEmbedUrls });
    return {
      path,
      type: 'page',
      contentId: row.content_id,
      versionId: row.version_id,
      versionNumber: row.version_number,
      file: pathFile(path),
      data: injectPageTracker(pageHtml, { nonce, trackerPublicId }),
    };
  }
  if (!row.company_slug || !row.project_slug) throw fail('A publicação não encontrou o projeto público.', 409);
  let schema;
  try { schema = normalizeFormInput(row.schema); } catch { throw fail('A publicação contém um formulário inválido.', 409); }
  const form = { ...schema, id: row.content_id, name: row.name || 'Formulário' };
  const actionUrl = publicFormAction(publicOrigin, row.company_slug, row.project_slug, path);
  const html = renderDynamicForm(form, actionUrl, { vslEmbedUrls, nonce, trackerPublicId });
  const policy = withoutFrameAncestors(formContentSecurityPolicy({
    nonce,
    studioOrigin: publicOrigin,
    actionOrigin: new URL(actionUrl).origin,
    frameOrigins: vslEmbedUrls.size ? [publicOrigin] : [],
  }));
  return {
    path,
    type: 'form',
    contentId: row.content_id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    file: pathFile(path),
    data: injectPublicationCsp(html, policy),
  };
}

export async function buildPublishableSnapshot({ database, companyId, projectId, publicOrigin = process.env.PUBLIC_ORIGIN }) {
  if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para snapshot.');
  if (!companyId || !projectId) throw fail('Empresa e projeto são obrigatórios.', 400);
  const origin = validateOrigin(publicOrigin);
  const { rows } = await database.query(
    `SELECT 'page' AS kind, page.company_id, page.project_id, company.slug AS company_slug,
            project.slug AS project_slug, page.id AS content_id, version.id AS version_id,
            version.version_number, version.published_path AS path, version.rendered_html,
            version.editor_state,
            NULL::jsonb AS schema, page.name
       FROM pages page
       JOIN companies company ON company.id = page.company_id
       JOIN projects project ON project.id = page.project_id AND project.company_id = page.company_id
       JOIN page_versions version ON version.id = page.published_version_id
      WHERE page.company_id = $1 AND page.project_id = $2 AND page.deleted_at IS NULL
     UNION ALL
     SELECT 'form' AS kind, form.company_id, form.project_id, company.slug AS company_slug,
            project.slug AS project_slug, form.id AS content_id, version.id AS version_id,
            version.version_number, version.published_path AS path, NULL::text AS rendered_html,
            NULL::jsonb AS editor_state,
            version.schema, form.name
       FROM forms form
       JOIN companies company ON company.id = form.company_id
       JOIN projects project ON project.id = form.project_id AND project.company_id = form.company_id
       JOIN form_versions version ON version.id = form.published_version_id
      WHERE form.company_id = $1 AND form.project_id = $2 AND form.deleted_at IS NULL`,
    [companyId, projectId],
  );
  if (!rows.length) throw fail('Não há nenhuma rota publicada para este projeto.', 409);
  const references = rows.flatMap((row) => vslReferences(row.editor_state).concat(vslReferences(row.schema)));
  let resolvedVsl;
  try {
    resolvedVsl = await resolvePublishedVslReferences({ database, companyId, projectId, publicOrigin: origin, references });
  } catch (error) {
    if (error?.status === 404) {
      throw fail(`${error.message} Publique a VSL antes de publicar este conteúdo.`, 409);
    }
    throw error;
  }
  const vslEmbedUrls = new Map([...resolvedVsl].map(([publicId, value]) => [publicId, value.embedUrl]));
  const trackerPublicId = await resolveAnalyticsTrackerPublicId(database, companyId, projectId);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({
    rows: rows
      .map((row) => ({ path: row.path, rendered_html: row.rendered_html, schema: row.schema, editor_state: row.editor_state, version_id: row.version_id }))
      .sort((left, right) => left.version_id.localeCompare(right.version_id)),
    vslEmbedUrls: [...vslEmbedUrls],
    trackerPublicId,
  }))).digest('hex');
  const nonce = fingerprint.slice(0, 24);
  const records = rows.map((row) => {
    if (row.company_id !== companyId || row.project_id !== projectId) throw fail('A publicação contém conteúdo de outra empresa.', 403);
    return recordForRow(row, origin, vslEmbedUrls, { nonce, trackerPublicId });
  }).sort((left, right) => left.path.localeCompare(right.path));
  const seen = new Set();
  for (const record of records) {
    const key = record.path.toLowerCase();
    if (seen.has(key)) throw fail('A publicação contém uma rota duplicada.', 409);
    seen.add(key);
  }
  const manifest = records.map(({ path, type, contentId, versionId, versionNumber, file }) => ({ path, type, contentId, versionId, versionNumber, file }));
  const files = records.map(({ file, data }) => ({ file, data }));
  const hash = createHash('sha256').update(JSON.stringify(canonical({ manifest, files }))).digest('hex');
  return { manifest, files, hash };
}

export class PublicationSnapshotBuilder {
  constructor(options) { this.options = options; }
  build(input) { return buildPublishableSnapshot({ ...this.options, ...input }); }
}
