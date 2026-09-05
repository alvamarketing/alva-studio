import { test } from 'node:test';
import assert from 'node:assert/strict';
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
