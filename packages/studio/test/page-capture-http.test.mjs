import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';

import { createApp, parsePageCaptureRequest } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildRuntimeManifest, signRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey } from '../server/vercel-runtime-gateway.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

function http(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('parser de captura rejeita segmentos codificados perigosos', () => {
  const captureId = '11111111-1111-4111-8111-111111111111';
  assert.equal(parsePageCaptureRequest(`/api/public/pages/acme/lp/%2f/captures/${captureId}/submissions`, 'POST', false), null);
  assert.equal(parsePageCaptureRequest(`/api/public/pages/acme/lp/%5c/captures/${captureId}/submissions`, 'POST', false), null);
  assert.equal(parsePageCaptureRequest(`/api/public/pages/acme/lp/../captures/${captureId}/submissions`, 'POST', false), null);
});

test('HTTP de captura publicada usa versão congelada, gateway assinado e namespace confiável', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('page-capture-http@alva.test','hash','Capture') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Acme','acme') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Landing','landing',$2) RETURNING id", [company.id, user.id])).rows[0];
  const other = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Outro','outro',$2) RETURNING id", [company.id, user.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1,$2,'owner',now())", [company.id, user.id]);
  await database.query("INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status) VALUES ($1,$2,'production','lp.example.test',true,'verified')", [company.id, project.id]);
  await database.query("INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status) VALUES ($1,$2,'production','other.example.test',true,'verified')", [company.id, other.id]);

  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const stateA = { components: [{ tagName: 'form', components: [
    { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { type: 'alva-field', attributes: { name: 'email', type: 'email', required: '' } }] },
    { tagName: 'label', components: [{ type: 'textnode', content: 'Interesses' }, { type: 'alva-field', attributes: { name: 'interesses', type: 'checkbox', value: 'a' } }] },
    { tagName: 'label', components: [{ type: 'textnode', content: 'Interesses' }, { type: 'alva-field', attributes: { name: 'interesses', type: 'checkbox', value: 'b' } }] },
  ] }] };
  const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: user.id, name: 'Landing', route: '/landing', editorState: stateA, renderedHtml: '<form></form>' });
  const quiz = await content.createForm({ companyId: company.id, projectId: project.id, actorId: user.id, name: 'Quiz legado', route: '/quiz', draftSchema: { headerElements: [], steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }], completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' }, webhook: '' } });
  await content.publishForm({ companyId: company.id, projectId: project.id, actorId: user.id, formId: quiz.id });
  const versionA = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: page.lockVersion });
  const captureId = versionA.editorState.components[0].attributes['data-alva-capture-id'];
  const changed = await content.updatePage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: page.lockVersion, editorState: { ...versionA.editorState, components: [{ ...versionA.editorState.components[0], components: [...versionA.editorState.components[0].components, { tagName: 'label', components: [{ type: 'textnode', content: 'Nome' }, { type: 'alva-field', attributes: { name: 'nome', type: 'text', required: '' } }] }] }] } });
  await content.publishPage({ companyId: company.id, projectId: project.id, actorId: user.id, pageId: page.id, lockVersion: changed.lockVersion });

  const manifest = buildRuntimeManifest({ publicationId: 'page-capture-http', snapshotHash: 'c'.repeat(64), origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', contents: [{ path: '/landing', type: 'page', contentId: page.id, versionId: versionA.id, captureIds: [captureId] }] });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: company.id, projectId: project.id, manifest });
  const app = createApp({ database, publicOrigin: 'https://studio.example.test', runtimeFlags: { pixels: false, nvsRuntime: false }, runtimeHmacSecret: 'root-secret-only-at-studio' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const key = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: manifest.publicationId, snapshotHash: manifest.snapshotHash, environment: manifest.environment });
  const signed = (method, path, body = Buffer.alloc(0), nonce) => {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': manifest.publicationId, 'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(timestamp), 'x-alva-runtime-nonce': nonce,
      'x-alva-runtime-signature': signRuntimeRequest({ method, path, publicationId: manifest.publicationId, environment: 'production', timestamp, nonce, body }, key),
    };
  };
  const consent = await http(base, `/_alva/consent?publicationId=${manifest.publicationId}`, { headers: { Host: 'studio.example.test', ...signed('GET', '/_alva/consent', Buffer.alloc(0), 'nonce-capture-consent-1') } });
  assert.notEqual(consent.status, 200);
  const loader = await http(base, `/_alva/runtime.js?publicationId=${manifest.publicationId}`, { headers: { Host: 'studio.example.test', ...signed('GET', '/_alva/runtime.js', Buffer.alloc(0), 'nonce-capture-loader-1') } });
  assert.notEqual(loader.status, 200);
  const path = `/api/public/pages/landing/captures/${captureId}/submissions`;
  const body = Buffer.from('email=lead%40example.test&interesses=a&interesses=b');
  const headers = { Host: 'studio.example.test', Origin: 'https://lp.example.test', 'Content-Type': 'application/x-www-form-urlencoded', ...signed('POST', path, body, 'nonce-capture-success-1') };
  const accepted = await http(base, path, { method: 'POST', body, headers });
  assert.equal(accepted.status, 200, accepted.text);
  assert.match(accepted.text, /Obrigado!/);
  const submission = (await database.query('SELECT page_version_id, answers FROM page_submissions')).rows[0];
  assert.equal(submission.page_version_id, versionA.id);
  assert.deepEqual(submission.answers, { email: 'lead@example.test', interesses: ['a', 'b'] });

  const legacyQuiz = await http(base, '/api/public/forms/acme/landing/quiz/submissions', { method: 'POST', body: Buffer.from('{"answers":{"email":"quiz@example.test"}}'), headers: { Host: 'studio.example.test', Origin: 'https://studio.example.test', 'Content-Type': 'application/json' } });
  assert.equal(legacyQuiz.status, 200, legacyQuiz.text);

  const wrongOrigin = await http(base, path, { method: 'POST', body, headers: { ...headers, Origin: 'https://evil.example.test', ...signed('POST', path, body, 'nonce-capture-origin-1') } });
  assert.equal(wrongOrigin.status, 403);
  const missingCapture = '22222222-2222-4222-8222-222222222222';
  const absentPath = `/api/public/pages/landing/captures/${missingCapture}/submissions`;
  const absent = await http(base, absentPath, { method: 'POST', body, headers: { ...headers, ...signed('POST', absentPath, body, 'nonce-capture-absent-1') } });
  assert.equal(absent.status, 404);
  const invalidSignature = await http(base, path, { method: 'POST', body, headers: { ...headers, 'x-alva-runtime-nonce': 'nonce-capture-signature-1', 'x-alva-runtime-signature': '0'.repeat(64) } });
  assert.equal(invalidSignature.status, 403);
  const replayPath = `/api/public/pages/landing/captures/${captureId}/submissions`;
  const replayHeaders = { ...headers, ...signed('POST', replayPath, body, 'nonce-capture-replay-1') };
  assert.equal((await http(base, replayPath, { method: 'POST', body, headers: replayHeaders })).status, 200);
  assert.equal((await http(base, replayPath, { method: 'POST', body, headers: replayHeaders })).status, 403);

  const namespacedManifest = buildRuntimeManifest({ publicationId: 'page-capture-namespace', snapshotHash: 'd'.repeat(64), origin: 'https://studio.example.test', domain: 'studio.example.test', environment: 'production', contents: [{ path: '/landing', type: 'page', contentId: page.id, versionId: versionA.id, captureIds: [captureId] }] });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: company.id, projectId: project.id, manifest: namespacedManifest });
  const namespaceKey = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: namespacedManifest.publicationId, snapshotHash: namespacedManifest.snapshotHash, environment: namespacedManifest.environment });
  const otherPath = `/api/public/pages/acme/outro/landing/captures/${captureId}/submissions`;
  const namespaceTimestamp = Math.floor(Date.now() / 1000);
  const namespaceHeaders = {
    Host: 'studio.example.test', Origin: 'https://studio.example.test', 'Content-Type': 'application/x-www-form-urlencoded',
    'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'studio.example.test', 'x-alva-publication-id': namespacedManifest.publicationId, 'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(namespaceTimestamp), 'x-alva-runtime-nonce': 'nonce-capture-namespace-1',
    'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path: otherPath, publicationId: namespacedManifest.publicationId, environment: 'production', timestamp: namespaceTimestamp, nonce: 'nonce-capture-namespace-1', body }, namespaceKey),
  };
  assert.equal((await http(base, otherPath, { method: 'POST', body, headers: namespaceHeaders })).status, 404);
});
