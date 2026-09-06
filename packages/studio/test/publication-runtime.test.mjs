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

test('loader usa a chave de consentimento completa e descreve processamento limitado', () => {
  const base = { publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', providers: [{ provider: 'meta', id: '123' }] };
  const source = createRuntimeLoader(base);
  const variants = [{ ...base, publicationId: 'pub-2' }, { ...base, snapshotHash: 'b'.repeat(64) }, { ...base, policyVersion: 2 }, { ...base, origin: 'https://new.example.test', domain: 'new.example.test' }, { ...base, domain: 'new.example.test' }, { ...base, environment: 'preview' }];
  for (const variant of variants) assert.notEqual(source, createRuntimeLoader(variant));
  assert.match(source, /identificadores pseudônimos de atribuição/i);
  assert.match(source, /processamento limitado/i);
  assert.equal(source.includes('accepted'), false);
});

function runtimeDom(state) {
  const attributes = new Map();
  const scripts = [];
  const nodes = [];
  const document = {
    documentElement: { getAttribute: (name) => attributes.get(name) || null, setAttribute: (name, value) => attributes.set(name, value) },
    createElement: () => {
      const listeners = new Map();
      const node = { dataset: {}, append: () => {}, remove: () => {}, setAttribute: () => {}, addEventListener: (name, listener) => listeners.set(name, listener) };
      nodes.push(node);
      return node;
    },
    head: { appendChild: (node) => scripts.push({ src: node.src, provider: node.dataset.alvaRuntimeProvider, metaQueue: window.fbq?.queue?.map((entry) => [...entry]), dataLayer: window.dataLayer?.slice(), tiktok: window.ttq && { queue: window.ttq.slice(), i: window.ttq._i, t: window.ttq._t, o: window.ttq._o }, linkedin: { id: window._linkedin_partner_id, ids: window._linkedin_data_partner_ids?.slice() }, taboola: window._tfa?.slice() }) },
    body: { appendChild: () => {} },
    querySelectorAll: () => [],
  };
  const window = {};
  const fetch = async () => ({ ok: true, json: async () => ({ state }) });
  return { window, document, fetch, scripts, attributes, nodes };
}

async function runLoader({ provider, id, state = 'granted' }) {
  const dom = runtimeDom(state);
  const source = createRuntimeLoader({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', providers: [{ provider, id }] });
  new Function('window', 'document', 'fetch', source)(dom.window, dom.document, dom.fetch);
  await new Promise((resolve) => setImmediate(resolve));
  return dom;
}

test('bootstraps dos cinco providers preparam contratos antes do SDK e só rodam uma vez após grant', async () => {
  const cases = [
    { provider: 'meta', id: '123', verify: ({ window, scripts }) => { assert.deepEqual(scripts[0].metaQueue, [['init', '123'], ['track', 'PageView']]); assert.equal(scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js'); assert.equal(typeof window.fbq, 'function'); } },
    { provider: 'ga4', id: 'G-ABCD1234', verify: ({ scripts }) => { assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234'); assert.equal(scripts[0].dataLayer[1][0], 'config'); assert.equal(scripts[0].dataLayer[1][1], 'G-ABCD1234'); } },
    { provider: 'tiktok', id: 'pixel_1', verify: ({ scripts }) => { const capture = scripts[0].tiktok; assert.equal(scripts[0].src, 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=pixel_1&lib=ttq'); assert.deepEqual(capture.queue, [['load', 'pixel_1'], ['page']]); assert.ok(capture.i.pixel_1); assert.equal(typeof capture.t.pixel_1, 'number'); assert.deepEqual(capture.o.pixel_1, {}); } },
    { provider: 'linkedin', id: '456', verify: ({ scripts }) => { assert.equal(scripts[0].src, 'https://snap.licdn.com/li.lms-analytics/insight.min.js'); assert.equal(scripts[0].linkedin.id, '456'); assert.deepEqual(scripts[0].linkedin.ids, ['456']); } },
    { provider: 'taboola', id: 'tab_1', verify: ({ scripts }) => { assert.equal(scripts[0].src, 'https://cdn.taboola.com/libtrc/unip/loader.js'); assert.deepEqual(scripts[0].taboola, [{ notify: 'page_view', id: 'tab_1' }]); } },
  ];
  for (const item of cases) {
    const dom = await runLoader(item);
    assert.equal(dom.scripts.length, 1, item.provider);
    assert.equal(dom.attributes.get('data-alva-runtime-loaded'), 'true');
    item.verify(dom);
  }
  const blocked = await runLoader({ provider: 'tiktok', id: 'pixel_1', state: 'pending' });
  assert.equal(blocked.scripts.length, 0);
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
    const stored = await repository.current({ companyId: company.id, projectId: project.id, environment: 'production' });
    assert.equal(stored.publication_id, 'pub-1');
    assert.equal(stored.policy_version, 1);
    assert.equal(stored.domain, 'lp.example.test');
    assert.equal((await repository.currentForOrigin({ publicationId: 'pub-1', origin: 'https://lp.example.test' })).publication_id, 'pub-1');
    assert.equal(await repository.currentForOrigin({ publicationId: 'pub-1', origin: 'https://other.example.test' }), null);
    await repository.recordConsent({ manifest: { ...manifest, companyId: company.id, projectId: project.id }, subjectId: 'visitor-opaque-1', state: 'granted' });
    assert.equal((await repository.currentConsent({ manifest: { ...manifest, companyId: company.id, projectId: project.id }, subjectId: 'visitor-opaque-1' })).state, 'granted');
    assert.equal((await repository.currentConsent({ manifest: { ...manifest, companyId: company.id, projectId: project.id, policyVersion: 2 }, subjectId: 'visitor-opaque-1' })), null);
    await repository.recordConsent({ manifest: { ...manifest, companyId: company.id, projectId: project.id }, subjectId: 'visitor-opaque-1', state: 'denied' });
    assert.equal((await repository.currentConsent({ manifest: { ...manifest, companyId: company.id, projectId: project.id }, subjectId: 'visitor-opaque-1' })).state, 'denied');
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
