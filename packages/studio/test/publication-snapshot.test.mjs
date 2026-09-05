import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';

function database(rows) {
  return { query: async () => ({ rows }) };
}

test('snapshot inclui todas as páginas e formulários publicados em ordem estável', async () => {
  const rows = [
    {
      kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'form-1', version_id: 'form-version-1', version_number: 2, path: '/captura',
      schema: { steps: [{ id: 'email', elements: [{ id: 'email', type: 'email', title: 'E-mail', required: true }] }] },
    },
    {
      kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'page-1', version_id: 'page-version-1', version_number: 3, path: '/',
      rendered_html: '<h1>Alva</h1>', editor_state: { title: 'Alva' },
    },
  ];
  const snapshot = await buildPublishableSnapshot({ database: database(rows), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' });
  assert.deepEqual(snapshot.manifest.map((item) => item.path), ['/', '/captura']);
  assert.deepEqual(snapshot.files.map((item) => item.file), ['index.html', 'captura/index.html']);
  assert.match(snapshot.files[1].data, /https:\/\/studio\.alva\.test\/api\/public\/forms\/alva\/campanha\/captura\/submissions/);
  assert.equal(snapshot.files[0].data, '<h1>Alva</h1>');
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  const repeat = await buildPublishableSnapshot({ database: database([...rows].reverse()), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' });
  assert.equal(repeat.hash, snapshot.hash);
  assert.deepEqual(repeat.files, snapshot.files);
});

test('snapshot rejeita vazio, rota duplicada e registros de outra empresa', async () => {
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database([]), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /nenhuma rota publicada/i,
  );
  const duplicate = [
    { kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha', content_id: 'p1', version_id: 'v1', version_number: 1, path: '/Oferta', rendered_html: '<h1>1</h1>' },
    { kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha', content_id: 'f1', version_id: 'v2', version_number: 1, path: '/oferta', schema: { steps: [{ id: 'step', elements: [{ id: 'email', type: 'email', title: 'E-mail' }] }] } },
  ];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(duplicate), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /rota duplicada/i,
  );
  const foreign = [{ ...duplicate[0], company_id: 'company-b' }];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(foreign), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /nenhuma rota publicada|outra empresa/i,
  );
});
