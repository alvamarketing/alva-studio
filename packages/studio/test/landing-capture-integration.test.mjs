import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';

import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest, signRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

function http(base, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(base + path, { method: 'POST', headers }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.end(body);
  });
}

test('landing publicada preserva captura/versionamento até a submissão assinada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString }); await migrate(database);
  const owner = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('landing-capture@alva.test','hash','Owner') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name,slug) VALUES ('Acme','acme') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Campanha','campanha',$2) RETURNING id", [company.id, owner.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [company.id, owner.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production','lp.example.test',true,'verified')", [company.id, project.id]);
  const captureId = '11111111-1111-4111-8111-111111111111';
  const state = { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': captureId }, components: [{ tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: '' } }] }] }] };
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: owner.id, name: 'Landing', route: '/oferta', editorState: state, renderedHtml: `<main><form data-alva-capture-id="${captureId}" action="#" onsubmit="return false"><input name="email" type="email"></form></main>` });
  const version = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: page.lockVersion });
  const snapshot = await buildPublishableSnapshot({ database, companyId: company.id, projectId: project.id, publicOrigin: 'https://studio.example.test', environment: 'production' });
  assert.deepEqual(snapshot.manifest.find((item) => item.contentId === page.id).captureIds, [captureId]);
  const artifact = runtimeGatewayArtifacts(snapshot.files, { publicationId: 'landing-capture-run', snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'root-secret-only-at-studio', runtimeBootstrap: false });
  const html = artifact.files.find((file) => file.file === 'oferta/index.html').data;
  const action = html.match(/action="([^"]+)"/)?.[1];
  assert.equal(action, `/api/public/pages/oferta/captures/${captureId}/submissions`);
  const manifest = buildRuntimeManifest({ publicationId: 'landing-capture-run', snapshotHash: snapshot.hash, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: company.id, projectId: project.id, manifest });
  const app = createApp({ database, publicOrigin: 'https://studio.example.test', runtimeFlags: { pixels: false, nvsRuntime: false }, runtimeHmacSecret: 'root-secret-only-at-studio' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const body = Buffer.from('email=lead%40example.test'); const timestamp = Math.floor(Date.now() / 1000); const nonce = 'landing-capture-submit-1';
  const key = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: manifest.publicationId, snapshotHash: manifest.snapshotHash, environment: manifest.environment });
  const headers = { Host: 'studio.example.test', Origin: 'https://lp.example.test', 'Content-Type': 'application/x-www-form-urlencoded', 'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': manifest.publicationId, 'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(timestamp), 'x-alva-runtime-nonce': nonce, 'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path: action, publicationId: manifest.publicationId, environment: 'production', timestamp, nonce, body }, key) };
  const result = await http(`http://127.0.0.1:${app.address().port}`, action, { headers, body });
  assert.equal(result.status, 200, result.text);
  const submission = (await database.query('SELECT page_version_id,capture_id,answers,tracking_event_id FROM page_submissions')).rows[0];
  assert.equal(submission.page_version_id, version.id); assert.equal(submission.capture_id, captureId); assert.deepEqual(submission.answers, { email: 'lead@example.test' }); assert.ok(submission.tracking_event_id);
  const leads = await content.projectSubmissions({ companyId: company.id, projectId: project.id, actorId: owner.id, sourceKind: 'page', sourceId: page.id, captureId });
  assert.deepEqual(leads.items.map((item) => ({ version: item.sourceVersionId, answers: item.answers })), [{ version: version.id, answers: { email: 'lead@example.test' } }]);
});

test('prévia sem captura mantém o fluxo anterior mesmo com pixels habilitados', async () => {
  let payload;
  const service = new PublicationService({
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [{ path: '/', type: 'page', contentId: 'page', versionId: 'version', captureIds: [] }], files: [{ file: 'index.html', data: '<main>sem captura</main>' }] }) },
    integrations: { credentials: async () => ({ vercelProjectId: 'project' }) },
    deployments: { createOrGet: async (input) => ({ id: 'preview-no-capture', ...input, status: 'queued' }), updateExternal: async (input) => ({ ...input, externalDeploymentId: 'deployment' }) },
    publisherFactory: () => ({ publish: async (input) => { payload = input; return { id: 'deployment', projectId: 'project', url: 'preview.example.test' }; } }),
    runtimeEnabled: true, runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'root-secret-only-at-studio', audit: { record: async () => {} },
  });
  await service.preview({ companyId: 'company', projectId: 'project', requestedBy: 'owner', expectedRevision: 1 });
  assert.deepEqual(payload.files, [{ file: 'index.html', data: '<main>sem captura</main>' }]);
  assert.equal(payload.runtimeEnv, undefined);
});
