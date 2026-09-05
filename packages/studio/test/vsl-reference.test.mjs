import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { VideoRepository } from '../server/repositories/video-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import {
  normalizeVslReference,
  resolvePublishedVsl,
  resolvePublishedVslReferences,
} from '../server/vsl-reference.mjs';

test('normaliza somente uma referência pública mínima de VSL', () => {
  const input = { type: 'vsl', publicId: 'public-vsl-123456' };
  const result = normalizeVslReference(input);
  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.throws(() => normalizeVslReference({ type: 'video', publicId: input.publicId }), /referência/i);
  assert.throws(() => normalizeVslReference({ type: 'vsl', publicId: '  ' }), /referência/i);
});

test('rejeita ID interno e configuração embutida na referência', () => {
  assert.throws(() => normalizeVslReference({ type: 'vsl', publicId: 'public-vsl-123456', id: 'internal-id' }), /referência/i);
  assert.throws(() => normalizeVslReference({ type: 'vsl', publicId: 'public-vsl-123456', sourceUrl: 'https://cdn.example/v.mp4' }), /referência/i);
  assert.throws(() => normalizeVslReference({ id: 'internal-id', sourceUrl: 'https://cdn.example/v.mp4' }), /referência/i);
});

test('resolve somente a versão publicada no projeto e monta o embed absoluto', async () => {
  const calls = [];
  const database = { query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [{ public_id: 'public-vsl-123456', version_number: 3 }] };
  } };
  const result = await resolvePublishedVsl({ database, companyId: 'company-a', projectId: 'project-a', publicId: 'public-vsl-123456', publicOrigin: 'https://studio.example.test' });
  assert.deepEqual(result, { publicId: 'public-vsl-123456', versionNumber: 3, embedUrl: 'https://studio.example.test/embed/v/public-vsl-123456' });
  assert.deepEqual(calls[0].values, ['company-a', 'project-a', 'public-vsl-123456']);
  assert.match(calls[0].text, /company_id\s*=\s*\$1/i);
  assert.match(calls[0].text, /project_id\s*=\s*\$2/i);
  assert.match(calls[0].text, /public_id\s*=\s*\$3/i);
  assert.match(calls[0].text, /published_version_id/i);
});

test('retorna 404 para VSL ausente e deduplica referências no mapa', async () => {
  const missing = { query: async () => ({ rows: [] }) };
  await assert.rejects(() => resolvePublishedVsl({ database: missing, companyId: 'c', projectId: 'p', publicId: 'public-vsl-123456', publicOrigin: 'https://studio.example.test' }), (error) => error.status === 404);
  let queries = 0;
  const database = { query: async () => { queries += 1; return { rows: [{ public_id: 'public-vsl-123456', version_number: 2 }] }; } };
  const result = await resolvePublishedVslReferences({ database, companyId: 'c', projectId: 'p', publicOrigin: 'https://studio.example.test', references: [
    { type: 'vsl', publicId: 'public-vsl-123456' },
    { type: 'vsl', publicId: 'public-vsl-123456' },
  ] });
  assert.equal(queries, 1);
  assert.deepEqual([...result.keys()], ['public-vsl-123456']);
});

test('isola a resolução por empresa/projeto e exige versão publicada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('vsl-reference@test', 'hash', 'Pessoa') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Empresa', 'vsl-reference') RETURNING id")).rows[0];
  const otherCompany = (await database.query("INSERT INTO companies (name, slug) VALUES ('Outra', 'vsl-reference-other') RETURNING id")).rows[0];
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [company.id, user.id]);
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', 'projeto', $2) RETURNING id", [company.id, user.id])).rows[0];
  const otherProject = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', 'projeto', $2) RETURNING id", [otherCompany.id, user.id])).rows[0];
  const repository = new VideoRepository(database);
  try {
    const input = { companyId: company.id, projectId: project.id, actorId: user.id, name: 'VSL', sourceUrl: 'https://media.example.test/vsl.mp4', sourceType: 'mp4' };
    const draft = await repository.createVideo(input);
    await assert.rejects(() => resolvePublishedVsl({ database, companyId: company.id, projectId: project.id, publicId: draft.publicId, publicOrigin: 'https://studio.example.test' }), (error) => error.status === 404);
    await repository.publishVideo({ ...input, videoId: draft.id, lockVersion: 0 });
    await assert.rejects(() => resolvePublishedVsl({ database, companyId: otherCompany.id, projectId: otherProject.id, publicId: draft.publicId, publicOrigin: 'https://studio.example.test' }), (error) => error.status === 404);
    await assert.rejects(() => resolvePublishedVsl({ database, companyId: company.id, projectId: otherProject.id, publicId: draft.publicId, publicOrigin: 'https://studio.example.test' }), (error) => error.status === 404);
  } finally {
    await database.close();
  }
});

test('resolvePublishedVsl valida a origem pública', async () => {
  const database = { query: async () => ({ rows: [{ public_id: 'public-vsl-123456', version_number: 1 }] }) };
  await assert.rejects(() => resolvePublishedVsl({ database, companyId: 'c', projectId: 'p', publicId: 'public-vsl-123456', publicOrigin: 'javascript:alert(1)' }), (error) => error.status === 400);
});

test('snapshot resolve referências antes de gerar arquivos públicos', async () => {
  const calls = [];
  const database = { query: async (text, values) => {
    calls.push({ text, values });
    if (/FROM videos/i.test(text)) return { rows: [{ public_id: 'public-vsl-123456', version_number: 1 }] };
    return { rows: [{ kind: 'page', company_id: 'c', project_id: 'p', company_slug: 'co', project_slug: 'pr', content_id: 'page-1', version_id: 'pv-1', version_number: 1, path: '/', rendered_html: '<div>page</div>', editor_state: { blocks: [{ type: 'vsl', publicId: 'public-vsl-123456' }] } }] };
  } };
  const { buildPublishableSnapshot } = await import('../server/publication-snapshot.mjs');
  await buildPublishableSnapshot({ database, companyId: 'c', projectId: 'p', publicOrigin: 'https://studio.example.test' });
  assert.ok(calls.some((call) => /FROM videos/i.test(call.text)));
});
