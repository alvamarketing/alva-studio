import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRuntimeManifest, consentKey, createRuntimeLoader, signRuntimeRequest, verifyRuntimeRequest, ReplayStore } from '../server/publication-runtime.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

test('manifesto de runtime é público, estável e só aceita produção para consentimento', () => {
  const manifest = buildRuntimeManifest({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), version: 3, policyVersion: 2, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', providers: [{ provider: 'meta', id: '123' }, { provider: 'ga4', id: 'G-ABCD1234' }] });
  assert.deepEqual(manifest, {
    publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), version: 3, policyVersion: 2, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production',
    consent: { required: true, scope: 'publication' },
    providers: [{ provider: 'ga4', id: 'G-ABCD1234' }, { provider: 'meta', id: '123' }],
  });
  assert.throws(() => buildRuntimeManifest({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), origin: 'https://preview.example.test', environment: 'preview', providers: ['meta'] }), /produção/);
  const variants = [
    { ...manifest, publicationId: 'pub-2' }, { ...manifest, snapshotHash: 'b'.repeat(64) },
    { ...manifest, policyVersion: 3 }, { ...manifest, origin: 'https://other.example.test', domain: 'other.example.test' },
    { ...manifest, domain: 'other.example.test' }, { ...manifest, environment: 'preview' },
  ];
  for (const variant of variants) assert.notEqual(consentKey(manifest), consentKey(variant));
});

test('assinatura exige timestamp/nonce, rejeita replay e não expõe segredo', async () => {
  const secret = 'runtime-secret';
  const request = { method: 'POST', path: '/_alva/event', publicationId: 'pub-1', environment: 'production', timestamp: 1_700_000_000, nonce: 'nonce-123456789012', body: JSON.stringify({ name: 'pageview' }) };
  const signature = signRuntimeRequest(request, secret);
  assert.match(signature, /^[a-f0-9]{64}$/);
  const store = new ReplayStore({ now: () => 1_700_000_010 });
  assert.equal(await verifyRuntimeRequest(request, signature, secret, { now: 1_700_000_010, replay: store }), true);
  assert.equal(await verifyRuntimeRequest(request, signature, secret, { now: 1_700_000_010, replay: store }), false);
  assert.equal(signRuntimeRequest(request, secret).includes(secret), false);
  assert.equal(await verifyRuntimeRequest({ ...request, timestamp: 1_600_000_000, nonce: 'nonce-2' }, signature, secret, { now: 1_700_000_010, replay: new ReplayStore({ now: () => 1_700_000_010 }) }), false);
  for (const field of ['method', 'path', 'environment']) assert.equal(await verifyRuntimeRequest({ ...request, [field]: field === 'method' ? 'GET' : field === 'path' ? '/_alva/consent' : 'preview' }, signature, secret, { now: 1_700_000_010, replay: new ReplayStore({ now: () => 1_700_000_010 }) }), false);
  assert.equal(await verifyRuntimeRequest({ ...request, body: '{}' }, signature, secret, { now: 1_700_000_010, replay: new ReplayStore({ now: () => 1_700_000_010 }) }), false);
});

test('loader é acessível, carrega providers uma vez e só depois de consentimento', () => {
  const source = createRuntimeLoader({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), providers: [{ provider: 'meta', id: '123' }, { provider: 'ga4', id: 'G-ABCD1234' }] });
  assert.match(source, /aria-label/);
  assert.match(source, /consent/);
  assert.match(source, /data-alva-runtime-loaded/);
  assert.equal(source.includes('connect.facebook.net') && source.includes('googletagmanager.com'), true);
  assert.equal(source.includes('analytics.tiktok.com'), false);
  assert.equal(source.includes('access_token'), false);
  assert.match(source, /Aceitar medição/); assert.match(source, /Recusar medição/); assert.match(source, /Revogar medição/);
  assert.equal(createHash('sha256').update(source).digest('hex').length, 64);
});

test('repositório isola manifesto por empresa/projeto/ambiente e revoga publicação', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('runtime@alva.test','hash','Runtime') RETURNING id")).rows[0];
    const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Runtime','runtime') RETURNING id")).rows[0];
    const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Projeto','runtime',$2) RETURNING id", [company.id, user.id])).rows[0];
    const { PublicationRuntimeRepository } = await import('../server/repositories/publication-runtime-repository.mjs');
    const repository = new PublicationRuntimeRepository(database);
    const manifest = buildRuntimeManifest({ publicationId: 'pub-1', snapshotHash: 'b'.repeat(64), origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', providers: [{ provider: 'meta', id: '123' }] });
    await repository.saveManifest({ companyId: company.id, projectId: project.id, manifest });
    const projectTwo = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Projeto dois','runtime-dois',$2) RETURNING id", [company.id, user.id])).rows[0];
    await assert.rejects(() => repository.saveManifest({ companyId: company.id, projectId: projectTwo.id, manifest }), /duplicate|unique|constraint/i);
    assert.equal((await repository.current({ companyId: company.id, projectId: project.id, environment: 'production' })).publication_id, 'pub-1');
    assert.equal(await repository.current({ companyId: company.id, projectId: project.id, environment: 'preview' }), null);
    assert.equal(await repository.claimNonce({ publicationId: 'pub-1', nonce: 'n1', expiresAt: new Date(Date.now() + 60_000) }), true);
    assert.equal(await repository.claimNonce({ publicationId: 'pub-1', nonce: 'n1', expiresAt: new Date(Date.now() + 60_000) }), false);
    assert.equal(await repository.claimNonce({ publicationId: 'pub-1', nonce: 'n-expired', expiresAt: new Date(Date.now() - 60_000) }), true);
    assert.equal(await repository.claimNonce({ publicationId: 'pub-1', nonce: 'n-expired', expiresAt: new Date(Date.now() + 60_000) }), true);
    const concurrent = await Promise.all([
      repository.claimNonce({ publicationId: 'pub-1', nonce: 'n-concurrent-123456', expiresAt: new Date(Date.now() + 60_000) }),
      repository.claimNonce({ publicationId: 'pub-1', nonce: 'n-concurrent-123456', expiresAt: new Date(Date.now() + 60_000) }),
    ]);
    assert.deepEqual(concurrent.sort(), [false, true]);
    assert.equal((await repository.revoke({ companyId: company.id, projectId: project.id, environment: 'production', publicationId: 'pub-1' })).publication_id, 'pub-1');
    assert.equal(await repository.current({ companyId: company.id, projectId: project.id, environment: 'production' }), null);
  } finally { await database.close(); }
});
