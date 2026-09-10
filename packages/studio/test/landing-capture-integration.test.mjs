import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';

import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { DeploymentRepository } from '../server/repositories/publication-repository.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest, signRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
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

test('prévia real promove produção por contentHash e bloqueia conteúdo alterado ou legado', async (t) => {
  const { connectionString } = await postgresFixture(t); const database = createDatabase({ connectionString }); await migrate(database);
  const user = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('parity@alva.test','hash','Owner') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name,slug) VALUES ('Parity','parity') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [company.id, user.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [company.id, user.id]);
  t.after(async () => database.close());
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: user.id, name: 'Página', route: '/', editorState: {}, renderedHtml: '<main>versão A</main>' });
  await content.publishPage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: page.lockVersion });
  let publishes = 0;
  const service = new PublicationService({ snapshotBuilder: { build: (input) => buildPublishableSnapshot({ database, publicOrigin: 'https://studio.example.test', ...input }) }, deployments: new DeploymentRepository(database), integrations: { credentials: async () => ({ vercelProjectId: 'project-ext' }) }, publisherFactory: () => ({ publish: async () => ({ id: `deploy-${++publishes}`, projectId: 'project-ext', state: 'READY', url: 'lp.example.test' }) }), audit: { record: async () => {} } });
  const preview = await service.preview({ companyId: company.id, projectId: project.id, requestedBy: user.id, expectedRevision: 1 });
  const before = await buildPublishableSnapshot({ database, companyId: company.id, projectId: project.id, publicOrigin: 'https://studio.example.test', environment: 'production' });
  assert.notEqual(preview.snapshotHash, before.hash); assert.equal((await new DeploymentRepository(database).find({ companyId: company.id, projectId: project.id, runId: preview.id })).contentHash, before.contentHash);
  await service.production({ companyId: company.id, projectId: project.id, requestedBy: user.id, expectedRevision: 1, confirmed: true, previewRunId: preview.id });
  await database.query('UPDATE deployment_runs SET content_hash=NULL WHERE id=$1', [preview.id]);
  await assert.rejects(() => service.production({ companyId: company.id, projectId: project.id, requestedBy: user.id, expectedRevision: 1, confirmed: true, previewRunId: preview.id }), /nova prévia/i);
  await database.query('UPDATE deployment_runs SET content_hash=$2 WHERE id=$1', [preview.id, before.contentHash]);
  const changed = await content.updatePage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: page.lockVersion, renderedHtml: '<main>versão B</main>' });
  await content.publishPage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: changed.lockVersion });
  await assert.rejects(() => service.production({ companyId: company.id, projectId: project.id, requestedBy: user.id, expectedRevision: 2, confirmed: true, previewRunId: preview.id }), /nova prévia/i);
});

test('quiz publicado confirma captura versionada antes da conclusão', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString }); await migrate(database);
  const owner = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('quiz-capture@alva.test','hash','Owner') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name,slug) VALUES ('Quiz Acme','quiz-acme') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Diagnóstico','diagnostico',$2) RETURNING id", [company.id, owner.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [company.id, owner.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production','quiz.example.test',true,'verified')", [company.id, project.id]);
  const captureId = '11111111-1111-4111-8111-111111111111';
  const state = { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': captureId, 'data-alva-quiz-capture': 'true' }, components: [
    { tagName: 'section', components: [{ tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: '' } }] }, { tagName: 'button', components: [{ type: 'textnode', content: 'Continuar' }] }] },
    { tagName: 'section', components: [{ tagName: 'h2', components: [{ type: 'textnode', content: 'Obrigado' }] }] },
  ] }] };
  const { buildPageExportHtml } = await import('../public/editor-shell.js');
  const renderedHtml = buildPageExportHtml({ title: 'Quiz', quiz: true, html: `<form data-alva-capture-id="${captureId}" data-alva-quiz-capture="true" action="#"><section><input name="email"><button data-alva-quiz-next>Continuar</button></section><section><h2>Obrigado</h2></section></form>` });
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: owner.id, name: 'Quiz', route: '/quiz', kind: 'quiz', editorState: state, renderedHtml });
  const version = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: page.lockVersion });
  const snapshot = await buildPublishableSnapshot({ database, companyId: company.id, projectId: project.id, publicOrigin: 'https://studio.example.test', environment: 'production' });
  const artifact = runtimeGatewayArtifacts(snapshot.files, { publicationId: 'quiz-capture-run', snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'root-secret-only-at-studio', runtimeBootstrap: false });
  const published = artifact.files.find((file) => file.file === 'quiz/index.html').data;
  const action = published.match(/action="([^"]+)"/)?.[1];
  assert.equal(action, `/api/public/pages/quiz/captures/${captureId}/submissions`);
  const manifest = buildRuntimeManifest({ publicationId: 'quiz-capture-run', snapshotHash: snapshot.hash, origin: 'https://quiz.example.test', domain: 'quiz.example.test', environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: company.id, projectId: project.id, manifest });
  const app = createApp({ database, publicOrigin: 'https://studio.example.test', runtimeFlags: { pixels: false, nvsRuntime: false }, runtimeHmacSecret: 'root-secret-only-at-studio' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const body = Buffer.from(JSON.stringify({ answers: { email: 'lead@quiz.test' }, trackingEventId: '33333333-3333-4333-8333-333333333333' })); const timestamp = Math.floor(Date.now() / 1000); const nonce = 'quiz-capture-submit-1';
  const key = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: manifest.publicationId, snapshotHash: manifest.snapshotHash, environment: manifest.environment });
  const headers = { Host: 'studio.example.test', Origin: 'https://quiz.example.test', 'Content-Type': 'application/json', 'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'quiz.example.test', 'x-alva-publication-id': manifest.publicationId, 'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(timestamp), 'x-alva-runtime-nonce': nonce, 'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path: action, publicationId: manifest.publicationId, environment: manifest.environment, timestamp, nonce, body }, key) };
  const result = await http(`http://127.0.0.1:${app.address().port}`, action, { headers, body });
  assert.equal(result.status, 200, result.text);
  const retryNonce = 'quiz-capture-submit-2';
  const retryHeaders = { ...headers, 'x-alva-runtime-nonce': retryNonce, 'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path: action, publicationId: manifest.publicationId, environment: manifest.environment, timestamp, nonce: retryNonce, body }, key) };
  assert.equal((await http(`http://127.0.0.1:${app.address().port}`, action, { headers: retryHeaders, body })).status, 200);
  const submissions = (await database.query('SELECT page_version_id,capture_id,answers,tracking_event_id FROM page_submissions'));
  assert.equal(submissions.rows.length, 1, 'retry com mesmo trackingEventId não cria outro lead');
  const submission = submissions.rows[0];
  assert.equal(submission.page_version_id, version.id); assert.equal(submission.capture_id, captureId); assert.deepEqual(submission.answers, { email: 'lead@quiz.test' }); assert.equal(submission.tracking_event_id, '33333333-3333-4333-8333-333333333333');
  const changedBody = Buffer.from(JSON.stringify({ answers: { email: 'other@quiz.test' }, trackingEventId: '33333333-3333-4333-8333-333333333333' }));
  const changedNonce = 'quiz-capture-submit-3';
  const changedHeaders = { ...headers, 'x-alva-runtime-nonce': changedNonce, 'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path: action, publicationId: manifest.publicationId, environment: manifest.environment, timestamp, nonce: changedNonce, body: changedBody }, key) };
  assert.equal((await http(`http://127.0.0.1:${app.address().port}`, action, { headers: changedHeaders, body: changedBody })).status, 409, 'mesmo ID não pode reaproveitar outra resposta');
});
