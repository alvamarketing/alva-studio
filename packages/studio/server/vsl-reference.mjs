function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
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
    embedUrl: `${String(publicOrigin).replace(/\/$/, '')}/embed/v/${encodeURIComponent(reference.publicId)}`,
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
