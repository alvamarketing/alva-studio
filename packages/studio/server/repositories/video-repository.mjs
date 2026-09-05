import { randomBytes } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';
import { hasCapability } from '../domain/access.mjs';

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

function requiredName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100) throw fail('Nome da VSL inválido.');
  return name;
}

function safeUrl(value, { required = false, label = 'URL da mídia', relative = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text && !required) return null;
  if (!text) throw fail(`${label} é obrigatória.`);
  if (relative) {
    if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\') || /(^|\/)\.\.?([/]|$)/.test(text))
      throw fail(`${label} deve ser um caminho relativo seguro.`);
    return text;
  }
  let url;
  try { url = new URL(text); } catch { throw fail(`${label} precisa ser HTTPS e absoluta.`); }
  if (!/^https:\/\//i.test(text) || url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw fail(`${label} precisa ser HTTPS sem credenciais.`);
  return text;
}

function sourceType(value, sourceUrl) {
  const type = value || (/\.m3u8(?:$|[?#])/i.test(sourceUrl) ? 'hls' : 'mp4');
  if (!['mp4', 'hls'].includes(type)) throw fail('Tipo de mídia inválido.');
  return type;
}

function color(value) {
  const text = String(value ?? '#286eea').trim();
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw fail('Cor inválida. Use hexadecimal com seis caracteres.');
  return text.toLowerCase();
}

function aspectRatio(value) {
  const text = String(value ?? '16:9').trim();
  const match = text.match(/^(\d{1,4}):(\d{1,4})$/);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw fail('Proporção inválida.');
  return `${Number(match[1])}:${Number(match[2])}`;
}

function boolean(value, defaultValue) {
  return value === undefined ? defaultValue : value === true;
}

function ctaSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isInteger(value) || value < 0 || value > 86400) throw fail('Tempo do CTA inválido.');
  return value;
}

function ctaText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > 200) throw fail('Texto do CTA inválido.');
  return text;
}

function milestones(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 0 || item > 100))
    throw fail('Marcos inválidos.');
  return [...new Set(value)].sort((left, right) => left - right);
}

function normalizedInput(input = {}, current = {}) {
  const sourceUrl = safeUrl(input.sourceUrl === undefined ? current.source_url : input.sourceUrl, { required: true, label: 'URL da mídia' });
  const type = sourceType(input.sourceType === undefined ? current.source_type : input.sourceType, sourceUrl);
  const posterUrl = safeUrl(input.posterUrl === undefined ? current.poster_url : input.posterUrl, { label: 'URL do poster' });
  const captionsUrl = safeUrl(input.captionsUrl === undefined ? current.captions_url : input.captionsUrl, { label: 'URL da legenda' });
  const text = ctaText(input.ctaText === undefined ? current.cta_text : input.ctaText);
  const urlValue = input.ctaUrl === undefined ? current.cta_url : input.ctaUrl;
  const ctaUrl = urlValue && String(urlValue).trim().startsWith('/')
    ? safeUrl(urlValue, { label: 'URL do CTA', relative: true })
    : safeUrl(urlValue, { label: 'URL do CTA' });
  const seconds = ctaSeconds(input.ctaSeconds === undefined ? current.cta_seconds : input.ctaSeconds);
  const hasCta = Boolean(text || ctaUrl || seconds !== null);
  if (hasCta && (!text || !ctaUrl || seconds === null))
    throw fail('CTA precisa de texto, destino e tempo.');
  return {
    name: input.name === undefined ? current.name : requiredName(input.name),
    sourceUrl,
    sourceType: type,
    posterUrl,
    captionsUrl,
    accentColor: color(input.accentColor === undefined ? current.accent_color : input.accentColor),
    aspectRatio: aspectRatio(input.aspectRatio === undefined ? current.aspect_ratio : input.aspectRatio),
    autoplayMuted: boolean(input.autoplayMuted, current.autoplay_muted ?? true),
    resumeEnabled: boolean(input.resumeEnabled, current.resume_enabled ?? true),
    ctaText: text,
    ctaUrl,
    ctaSeconds: seconds,
    milestones: milestones(input.milestones === undefined ? current.milestones : input.milestones),
  };
}

function publicId() {
  return randomBytes(18).toString('base64url');
}

function record(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    publicId: row.public_id,
    name: row.name,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    posterUrl: row.poster_url,
    captionsUrl: row.captions_url,
    accentColor: row.accent_color,
    aspectRatio: row.aspect_ratio,
    autoplayMuted: row.autoplay_muted,
    resumeEnabled: row.resume_enabled,
    ctaText: row.cta_text,
    ctaUrl: row.cta_url,
    ctaSeconds: row.cta_seconds,
    milestones: row.milestones ?? [],
    lockVersion: row.lock_version,
    publishedVersionId: row.published_version_id,
    publishedLockVersion: row.published_lock_version,
    versionId: row.version_id ?? null,
    versionNumber: row.version_number ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authorizedProject(client, { companyId, projectId, actorId, capability }) {
  const { rows } = await client.query(
    `SELECT membership.role
       FROM projects project
       JOIN company_memberships membership
         ON membership.company_id = project.company_id
        AND membership.user_id = $3 AND membership.status = 'active'
       LEFT JOIN project_grants grant_access
         ON grant_access.company_id = project.company_id
        AND grant_access.project_id = project.id
        AND grant_access.membership_id = membership.id
      WHERE project.company_id = $1 AND project.id = $2 AND project.status = 'active'
        AND (membership.role IN ('owner', 'admin') OR grant_access.id IS NOT NULL)`,
    [companyId, projectId, actorId],
  );
  if (!rows.length) throw fail('Projeto não encontrado.', 404);
  if (capability && !hasCapability(rows[0].role, capability)) throw fail('Sem permissão para este conteúdo.', 403);
}

async function scoped(client, { companyId, projectId, videoId, lock = false }) {
  const { rows } = await client.query(
    `SELECT video.*, published.version_id, published.version_number
       FROM videos video
       LEFT JOIN LATERAL (
         SELECT version.id AS version_id, version.version_number
           FROM video_versions version
          WHERE version.id = video.published_version_id
       ) published ON true
      WHERE video.company_id = $1 AND video.project_id = $2 AND video.id = $3 AND video.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF video' : ''}`,
    [companyId, projectId, videoId],
  );
  if (!rows.length) throw fail('VSL não encontrada.', 404);
  return rows[0];
}

export class VideoRepository {
  constructor(database) { this.database = database; }

  async createVideo(input) {
    const next = normalizedInput(input);
    const id = publicId();
    await authorizedProject(this.database, { ...input, capability: 'video.write' });
    const { rows } = await this.database.query(
      `INSERT INTO videos
        (company_id, project_id, public_id, name, source_url, source_type, poster_url, captions_url,
         accent_color, aspect_ratio, autoplay_muted, resume_enabled, cta_text, cta_url, cta_seconds, milestones, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
       RETURNING *`,
      [input.companyId, input.projectId, id, next.name, next.sourceUrl, next.sourceType, next.posterUrl, next.captionsUrl,
        next.accentColor, next.aspectRatio, next.autoplayMuted, next.resumeEnabled, next.ctaText, next.ctaUrl, next.ctaSeconds,
        JSON.stringify(next.milestones), input.actorId],
    );
    return record(rows[0]);
  }

  async listVideos({ companyId, projectId, actorId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    const { rows } = await this.database.query(
      `SELECT video.*, version.id AS version_id, version.version_number
         FROM videos video
         LEFT JOIN video_versions version ON version.id = video.published_version_id
        WHERE video.company_id = $1 AND video.project_id = $2 AND video.deleted_at IS NULL
        ORDER BY video.created_at, video.id`, [companyId, projectId],
    );
    return rows.map(record);
  }

  async getVideo({ companyId, projectId, actorId, videoId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId });
    return record(await scoped(this.database, { companyId, projectId, videoId }));
  }

  async updateVideo({ companyId, projectId, actorId, videoId, lockVersion, ...input }) {
    if (!Number.isInteger(lockVersion) || lockVersion < 0) throw fail('Revisão inválida.');
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'video.write' });
    return withTransaction(this.database, async (client) => {
      const current = await scoped(client, { companyId, projectId, videoId, lock: true });
      if (current.lock_version !== lockVersion) throw fail('A VSL mudou em outra aba. Reabra antes de salvar.', 409);
      const next = normalizedInput(input, current);
      const { rows } = await client.query(
        `UPDATE videos SET name=$4, source_url=$5, source_type=$6, poster_url=$7, captions_url=$8,
         accent_color=$9, aspect_ratio=$10, autoplay_muted=$11, resume_enabled=$12, cta_text=$13, cta_url=$14,
         cta_seconds=$15, milestones=$16::jsonb, lock_version=lock_version+1, updated_at=now()
         WHERE company_id=$1 AND project_id=$2 AND id=$3 AND lock_version=$17 AND deleted_at IS NULL RETURNING *`,
        [companyId, projectId, videoId, next.name, next.sourceUrl, next.sourceType, next.posterUrl, next.captionsUrl,
          next.accentColor, next.aspectRatio, next.autoplayMuted, next.resumeEnabled, next.ctaText, next.ctaUrl, next.ctaSeconds,
          JSON.stringify(next.milestones), lockVersion],
      );
      if (!rows.length) throw fail('A VSL mudou em outra aba. Reabra antes de salvar.', 409);
      return record({ ...rows[0], version_id: current.version_id, version_number: current.version_number });
    });
  }

  async publishVideo({ companyId, projectId, actorId, videoId, lockVersion }) {
    if (!Number.isInteger(lockVersion) || lockVersion < 0) throw fail('Revisão inválida.');
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'deployment.publish' });
    return withTransaction(this.database, async (client) => {
      const current = await scoped(client, { companyId, projectId, videoId, lock: true });
      if (current.lock_version !== lockVersion) throw fail('Salve a versão atual antes de publicar.', 409);
      const versionNumber = Number((await client.query('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM video_versions WHERE video_id = $1', [videoId])).rows[0].next);
      const { rows } = await client.query(
        `INSERT INTO video_versions
         (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type, poster_url, captions_url,
          accent_color, aspect_ratio, autoplay_muted, resume_enabled, cta_text, cta_url, cta_seconds, milestones, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19) RETURNING *`,
        [companyId, projectId, videoId, versionNumber, current.public_id, current.name, current.source_url, current.source_type,
          current.poster_url, current.captions_url, current.accent_color, current.aspect_ratio, current.autoplay_muted,
          current.resume_enabled, current.cta_text, current.cta_url, current.cta_seconds, JSON.stringify(current.milestones), actorId],
      );
      await client.query(
        'UPDATE videos SET published_version_id=$4, published_lock_version=$5, updated_at=now() WHERE company_id=$1 AND project_id=$2 AND id=$3',
        [companyId, projectId, videoId, rows[0].id, current.lock_version],
      );
      return record({ ...rows[0], published_version_id: rows[0].id, version_id: rows[0].id, version_number: versionNumber, lock_version: current.lock_version });
    });
  }

  async duplicateVideo({ companyId, projectId, actorId, videoId }) {
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'video.write' });
    const source = await scoped(this.database, { companyId, projectId, videoId });
    const input = {
      companyId, projectId, actorId,
      name: `${source.name} — cópia`.slice(0, 100), sourceUrl: source.source_url, sourceType: source.source_type,
      posterUrl: source.poster_url, captionsUrl: source.captions_url, accentColor: source.accent_color,
      aspectRatio: source.aspect_ratio, autoplayMuted: source.autoplay_muted, resumeEnabled: source.resume_enabled,
      ctaText: source.cta_text, ctaUrl: source.cta_url, ctaSeconds: source.cta_seconds, milestones: source.milestones,
    };
    return this.createVideo(input);
  }

  async removeVideo({ companyId, projectId, actorId, videoId, lockVersion }) {
    if (!Number.isInteger(lockVersion) || lockVersion < 0) throw fail('Revisão inválida.');
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'video.write' });
    return withTransaction(this.database, async (client) => {
      const current = await scoped(client, { companyId, projectId, videoId, lock: true });
      if (current.lock_version !== lockVersion) throw fail('A VSL mudou em outra aba. Reabra antes de excluir.', 409);
      const { rowCount } = await client.query('UPDATE videos SET deleted_at=now(), lock_version=lock_version+1, updated_at=now() WHERE company_id=$1 AND project_id=$2 AND id=$3 AND lock_version=$4', [companyId, projectId, videoId, lockVersion]);
      if (rowCount !== 1) throw fail('VSL não encontrada.', 404);
      return { ok: true };
    });
  }

  async getPublicVideo(publicIdValue) {
    const publicIdText = String(publicIdValue ?? '');
    if (!/^[A-Za-z0-9_-]{16,32}$/.test(publicIdText)) throw fail('VSL publicada não encontrada.', 404);
    const { rows } = await this.database.query(
      `SELECT version.*, video.id AS video_id, video.company_id, video.project_id
         FROM videos video
         JOIN video_versions version ON version.id = video.published_version_id
        WHERE video.public_id = $1 AND video.deleted_at IS NULL`, [publicIdText],
    );
    if (rows.length !== 1) throw fail('VSL publicada não encontrada.', 404);
    const published = record({ ...rows[0], id: rows[0].video_id, public_id: rows[0].public_id, published_version_id: rows[0].id, version_id: rows[0].version_number });
    const { id, companyId, projectId, lockVersion, publishedVersionId, publishedLockVersion, createdBy, createdAt, updatedAt, ...publicRecord } = published;
    const { versionId, ...withoutLegacyVersionId } = publicRecord;
    return { ...withoutLegacyVersionId, versionNumber: versionId };
  }
}

export const VslRepository = VideoRepository;
