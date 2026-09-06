import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey } from '../server/vercel-runtime-gateway.mjs';
import { verifyRuntimeGatewayEnvelope } from '../server/runtime-gateway-security.mjs';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { request as httpRequest } from 'node:http';
import { ContentRepository } from '../server/repositories/content-repository.mjs';

const manifest = { company_id: 'company', project_id: 'project', publication_id: 'run-1', snapshot_hash: 'a'.repeat(64), policy_version: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', policy: {}, providers: [] };

function request(overrides = {}) {
  const body = Buffer.from('{"answers":{"email":"pessoa@example.test"}}');
  const envelope = { method: 'POST', path: '/api/public/forms/acme/lp/submissions', publicationId: manifest.publication_id, environment: manifest.environment, timestamp: 1_700_000_000, nonce: 'nonce-123456789012', body };
  const key = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: manifest.publication_id, snapshotHash: manifest.snapshot_hash, environment: manifest.environment });
  return { body, headers: { 'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': envelope.publicationId, 'x-alva-runtime-environment': envelope.environment, 'x-alva-runtime-timestamp': String(envelope.timestamp), 'x-alva-runtime-nonce': envelope.nonce, 'x-alva-runtime-signature': signRuntimeRequest(envelope, key) }, ...overrides };
}

test('Studio aceita apenas a Function assinada, valida manifesto/host/escopo e grava o replay', async () => {
  const claims = [];
  const repository = {
    async currentForOrigin({ publicationId, origin }) { return publicationId === manifest.publication_id && origin === manifest.origin ? manifest : null; },
    async claimNonce({ publicationId, nonce, expiresAt }) { claims.push({ publicationId, nonce, expiresAt }); return claims.length === 1; },
  };
  const accepted = await verifyRuntimeGatewayEnvelope({ repository, rootSecret: 'root-secret-only-at-studio', method: 'POST', path: '/api/public/forms/acme/lp/submissions', now: 1_700_000_001, ...request() });
  assert.equal(accepted.manifest.publicationId, manifest.publication_id);
  assert.equal(claims[0].publicationId, manifest.publication_id);
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ repository, rootSecret: 'root-secret-only-at-studio', method: 'POST', path: '/api/public/forms/acme/lp/submissions', now: 1_700_000_001, ...request() }), /replay|assinatura/i);
});

test('Studio rejeita acesso direto, host, publicação, ambiente e assinatura falsos', async () => {
  const repository = { async currentForOrigin({ publicationId, origin }) { return publicationId === manifest.publication_id && origin === manifest.origin ? manifest : null; }, async claimNonce() { return true; } };
  const base = { repository, rootSecret: 'root-secret-only-at-studio', method: 'POST', path: '/api/public/forms/acme/lp/submissions', now: 1_700_000_001 };
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ ...base, ...request({ headers: {} }) }), /gateway/i);
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ ...base, ...request({ headers: { ...request().headers, 'x-alva-public-host': 'other.example.test' } }) }), /host|manifesto/i);
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ ...base, ...request({ headers: { ...request().headers, 'x-alva-publication-id': 'run-2' } }) }), /manifesto|publicação/i);
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ ...base, ...request({ headers: { ...request().headers, 'x-alva-runtime-environment': 'preview' } }) }), /manifesto|escopo/i);
  await assert.rejects(() => verifyRuntimeGatewayEnvelope({ ...base, ...request({ headers: { ...request().headers, 'x-alva-runtime-signature': '0'.repeat(64) } }) }), /assinatura/i);
});

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

test('HTTP público bloqueia acesso direto e aceita somente loader/consent pela Function assinada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('gateway-http@alva.test','hash','Gateway') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Gateway','gateway') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Runtime','runtime',$2) RETURNING id", [company.id, user.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1,$2,'owner',now())", [company.id, user.id]);
  await database.query("INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status) VALUES ($1,$2,'production','lp.example.test',true,'verified')", [company.id, project.id]);
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const form = await content.createForm({ companyId: company.id, projectId: project.id, actorId: user.id, name: 'Contato', route: '/contato', draftSchema: { headerElements: [], steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }], completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' }, webhook: '' } });
  await content.publishForm({ companyId: company.id, projectId: project.id, actorId: user.id, formId: form.id });
  const manifestInput = buildRuntimeManifest({ publicationId: 'run-http', snapshotHash: 'b'.repeat(64), origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production' });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: company.id, projectId: project.id, manifest: manifestInput });
  const app = createApp({ database, publicOrigin: 'https://studio.example.test', runtimeFlags: { pixels: true, nvsRuntime: false }, runtimeHmacSecret: 'root-secret-only-at-studio' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await http(base, '/_alva/runtime.js?publicationId=run-http', { headers: { Host: 'studio.example.test' } })).status, 403);
  const key = derivePublicationRuntimeKey('root-secret-only-at-studio', { publicationId: 'run-http', snapshotHash: manifestInput.snapshotHash, environment: 'production' });
  const signed = (method, path, body = Buffer.alloc(0), nonce = 'nonce-http-123456') => {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
    'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': 'run-http', 'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(timestamp), 'x-alva-runtime-nonce': nonce,
    'x-alva-runtime-signature': signRuntimeRequest({ method, path, publicationId: 'run-http', environment: 'production', timestamp, nonce, body }, key),
    };
  };
  const loader = await http(base, '/_alva/runtime.js?publicationId=run-http', { headers: { Host: 'studio.example.test', ...signed('GET', '/_alva/runtime.js', Buffer.alloc(0), 'nonce-loader-12345') } });
  assert.equal(loader.status, 200, loader.text);
  assert.match(loader.text, /processamento limitado/i);
  const current = await http(base, '/_alva/consent?publicationId=run-http', { headers: { Host: 'studio.example.test', ...signed('GET', '/_alva/consent', Buffer.alloc(0), 'nonce-consent-1234') } });
  assert.equal(current.status, 200, current.text);
  assert.equal(JSON.parse(current.text).state, 'pending');
  const cookie = current.headers['set-cookie'][0].split(';')[0];
  const grantedBody = Buffer.from('{"action":"grant","state":"forged","hash":"forged"}');
  const granted = await http(base, '/_alva/consent?publicationId=run-http', { method: 'POST', body: grantedBody, headers: { Host: 'studio.example.test', Cookie: cookie, 'Content-Type': 'application/json', ...signed('POST', '/_alva/consent', grantedBody, 'nonce-grant-1234567') } });
  assert.equal(granted.status, 200, granted.text);
  assert.deepEqual(JSON.parse(granted.text), { state: 'granted' });
  const formBody = Buffer.from('{"answers":{"email":"lead@example.test"}}');
  const submitted = await http(base, '/api/public/forms/contato/submissions', { method: 'POST', body: formBody, headers: { Host: 'studio.example.test', Cookie: cookie, Origin: 'https://lp.example.test', 'Content-Type': 'application/json', ...signed('POST', '/api/public/forms/contato/submissions', formBody, 'nonce-form-123456789') } });
  assert.equal(submitted.status, 200, submitted.text);
  assert.match(submitted.text, /Obrigado!/);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions')).rows[0].count, 1);
});
