function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function validatePublicOrigin(value) {
  try {
    const origin = new URL(String(value));
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
      throw new Error('origin');
    return origin.origin;
  } catch {
    throw fail('PUBLIC_ORIGIN deve ser uma origem absoluta válida.', 400);
  }
}

export function normalizeVslReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Referência de VSL inválida.');
  const keys = Object.keys(value);
  if (keys.length !== 2 || value.type !== 'vsl' || typeof value.publicId !== 'string' || !value.publicId.trim())
    throw fail('Referência de VSL inválida.');
  return { type: 'vsl', publicId: value.publicId.trim() };
}

export async function resolvePublishedVsl({ database, companyId, projectId, publicId, publicOrigin }) {
  if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para referência de VSL.');
  const reference = normalizeVslReference({ type: 'vsl', publicId });
  const origin = validatePublicOrigin(publicOrigin);
  const { rows } = await database.query(
    `SELECT version.public_id, version.version_number
       FROM videos video
       JOIN video_versions version ON version.id = video.published_version_id
      WHERE video.company_id = $1 AND video.project_id = $2
        AND video.public_id = $3 AND video.published_version_id IS NOT NULL
        AND video.deleted_at IS NULL`,
    [companyId, projectId, reference.publicId],
  );
  if (rows.length !== 1) throw fail('VSL publicada não encontrada neste projeto.', 404);
  return {
    publicId: reference.publicId,
    versionNumber: rows[0].version_number,
    embedUrl: `${origin}/embed/v/${encodeURIComponent(reference.publicId)}`,
  };
}

export async function resolvePublishedVslReferences({ database, companyId, projectId, publicOrigin, references = [] }) {
  const unique = new Map();
  for (const value of references) {
    const reference = normalizeVslReference(value);
    unique.set(reference.publicId, reference);
  }
  const resolved = new Map();
  for (const reference of unique.values()) {
    resolved.set(reference.publicId, await resolvePublishedVsl({ database, companyId, projectId, publicId: reference.publicId, publicOrigin }));
  }
  return resolved;
}

export function renderPublishedVslReferences(html, { vslEmbedUrls = new Map() } = {}) {
  const source = String(html ?? '');
  const rendered = source.replace(/<([a-z][\w:-]*)\b([^>]*\bdata-alva-vsl\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*)>([\s\S]*?)<\/\1\s*>/gi, (whole, _tag, _attributes, doubleId, singleId) => {
    const publicId = String(doubleId ?? singleId ?? '').trim();
    const value = vslEmbedUrls instanceof Map ? vslEmbedUrls.get(publicId) : vslEmbedUrls?.[publicId];
    const embedUrl = typeof value === 'string' ? value : value?.embedUrl;
    if (!/^https?:\/\/[^\s]+$/i.test(String(embedUrl || ''))) {
      throw fail(`A VSL referenciada (${publicId || 'sem publicId'}) não está publicada neste projeto. Publique a VSL antes de publicar o conteúdo.`, 409);
    }
    return publishedVslIframeMarkup(embedUrl);
  });
  return rewriteKnownVslIframes(rendered, vslEmbedUrls);
}

function publishedVslIframeMarkup(embedUrl) {
  return `<iframe class="alva-vsl-frame" src="${escapeHtml(embedUrl)}" title="VSL" aria-label="VSL" allow="autoplay; fullscreen; picture-in-picture" loading="lazy" allowfullscreen></iframe>`;
}

function rewriteKnownVslIframes(html, vslEmbedUrls) {
  const source = String(html ?? '');
  return source.replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe\s*>/gi, (whole, attributes) => {
    const classMatch = attributes.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!classMatch || !classMatch[2].split(/\s+/).includes('alva-vsl-frame')) return whole;
    const srcMatch = attributes.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!srcMatch) return whole;
    let url;
    try {
      url = new URL(srcMatch[2]);
    } catch {
      return whole;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) return whole;
    const prefix = '/embed/v/';
    if (!url.pathname.startsWith(prefix)) return whole;
    const encodedPublicId = url.pathname.slice(prefix.length);
    if (!encodedPublicId || encodedPublicId.includes('/')) return whole;
    let publicId;
    try {
      publicId = decodeURIComponent(encodedPublicId);
    } catch {
      return whole;
    }
    const value = vslEmbedUrls instanceof Map ? vslEmbedUrls.get(publicId) : vslEmbedUrls?.[publicId];
    const embedUrl = typeof value === 'string' ? value : value?.embedUrl;
    if (!/^https?:\/\/[^\s]+$/i.test(String(embedUrl || ''))) return whole;
    return publishedVslIframeMarkup(embedUrl);
  });
}

// Public form rendering may keep a partial map so the renderer can show its
// accessible fallback while publication validation remains strict above.
export async function resolvePublishedVslReferencesForRender({ database, companyId, projectId, publicOrigin, references = [] }) {
  const unique = new Map();
  for (const value of references) {
    const reference = normalizeVslReference(value);
    unique.set(reference.publicId, reference);
  }
  const resolved = new Map();
  for (const reference of unique.values()) {
    try {
      resolved.set(reference.publicId, await resolvePublishedVsl({
        database, companyId, projectId, publicId: reference.publicId, publicOrigin,
      }));
    } catch (error) {
      if (error?.status === 404) continue;
      throw error;
    }
  }
  return resolved;
}
