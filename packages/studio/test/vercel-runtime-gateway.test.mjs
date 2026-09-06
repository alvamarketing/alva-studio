import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicationRuntimeKey, forwardRuntimeGatewayRequest, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';

const scope = { publicationId: 'run-1', snapshotHash: 'a'.repeat(64), environment: 'production' };

test('gateway da Vercel preserva corpo e cookie, assina o request e não recebe o segredo raiz', async () => {
  const requests = [];
  const derivedKey = derivePublicationRuntimeKey('root-secret-only-at-studio', scope);
  const result = await forwardRuntimeGatewayRequest({
    method: 'POST',
    path: '/api/public/forms/acme/lp/captura/submissions',
    host: 'lp.example.test',
    headers: { cookie: 'alva_runtime_consent=subject-1234567890; other=1', origin: 'https://lp.example.test', 'content-type': 'application/json' },
    body: Buffer.from('{"answers":{"email":"pessoa@example.test"}}'),
    publicationId: scope.publicationId,
    environment: scope.environment,
    derivedKey,
    gatewayOrigin: 'https://studio.example.test',
    now: () => 1_700_000_000,
    nonce: () => 'nonce-123456789012',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response('ok', { status: 201, headers: { 'content-type': 'text/html', 'set-cookie': 'alva_runtime_consent=subject-1234567890; HttpOnly; Path=/' } });
    },
  });
  assert.equal(result.status, 201);
  assert.equal(Buffer.from(result.body).toString(), 'ok');
  assert.equal(requests[0].url, 'https://studio.example.test/api/public/forms/acme/lp/captura/submissions');
  assert.equal(Buffer.from(requests[0].init.body).toString(), '{"answers":{"email":"pessoa@example.test"}}');
  assert.equal(requests[0].init.headers.cookie, 'alva_runtime_consent=subject-1234567890; other=1');
  assert.equal(requests[0].init.headers['x-alva-public-host'], 'lp.example.test');
  assert.equal(requests[0].init.headers['x-alva-publication-id'], scope.publicationId);
  assert.match(requests[0].init.headers['x-alva-runtime-signature'], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(requests[0]).includes('root-secret-only-at-studio'), false);
  assert.deepEqual(result.headers['set-cookie'], ['alva_runtime_consent=subject-1234567890; HttpOnly; Path=/']);
});

test('artefatos da Function roteiam runtime e formulários por uma única fronteira e não alteram o snapshot', () => {
  const snapshotFiles = [{ file: 'index.html', data: '<html><head></head><body>Olá</body></html>' }, { file: 'contato/index.html', data: '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; connect-src \'self\'; form-action https://studio.example.test"><body>Contato</body>' }];
  const artifacts = runtimeGatewayArtifacts(snapshotFiles, {
    publicationId: scope.publicationId,
    snapshotHash: scope.snapshotHash,
    environment: scope.environment,
    runtimeOrigin: 'https://studio.example.test',
    runtimeHmacSecret: 'root-secret-only-at-studio',
    providers: [{ provider: 'meta', id: '123' }],
  });
  assert.deepEqual(snapshotFiles, [{ file: 'index.html', data: '<html><head></head><body>Olá</body></html>' }, { file: 'contato/index.html', data: '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; connect-src \'self\'; form-action https://studio.example.test"><body>Contato</body>' }]);
  const names = artifacts.files.map((file) => file.file).sort();
  assert.deepEqual(names, ['api/_alva/[...path].js', 'api/_alva/gateway.cjs', 'contato/index.html', 'index.html', 'vercel.json']);
  const config = JSON.parse(artifacts.files.find((file) => file.file === 'vercel.json').data);
  assert.deepEqual(config.rewrites.map((rewrite) => rewrite.destination), ['/api/_alva/runtime/:path*', '/api/_alva/forms/:path*']);
  const source = artifacts.files.find((file) => file.file === 'api/_alva/gateway.cjs').data;
  assert.match(source, /PUBLICATION_RUNTIME_DERIVED_KEY/);
  assert.match(source, /ALVA_RUNTIME_GATEWAY_ORIGIN/);
  assert.equal(source.includes('PUBLICATION_RUNTIME_HMAC_SECRET'), false);
  assert.equal(source.includes('root-secret-only-at-studio'), false);
  assert.equal(artifacts.runtimeEnv.PUBLICATION_RUNTIME_DERIVED_KEY, derivePublicationRuntimeKey('root-secret-only-at-studio', scope));
  assert.equal(artifacts.runtimeEnv.ALVA_RUNTIME_PUBLICATION_ID, scope.publicationId);
  const page = artifacts.files.find((file) => file.file === 'index.html').data;
  const form = artifacts.files.find((file) => file.file === 'contato/index.html').data;
  assert.match(page, /Content-Security-Policy/); assert.match(page, /nonce="[A-Za-z0-9_-]+"/); assert.match(page, /connect\.facebook\.net/);
  assert.match(form, /form-action 'self'/); assert.match(form, /connect\.facebook\.net/);
});

test('CSP separa script e coleta por provider e preserva contratos de landing e formulário', () => {
  const providers = [
    ['meta', '123', 'https://connect.facebook.net', 'https://www.facebook.com'],
    ['ga4', 'G-ABCD1234', 'https://www.googletagmanager.com', 'https://*.google-analytics.com'],
    ['tiktok', 'pixel_1', 'https://analytics.tiktok.com', 'https://analytics.tiktok.com'],
    ['linkedin', '456', 'https://snap.licdn.com', 'https://px.ads.linkedin.com'],
    ['taboola', 'tab_1', 'https://cdn.taboola.com', 'https://trc.taboola.com'],
  ];
  for (const [provider, id, scriptHost, connectHost] of providers) {
    const artifacts = runtimeGatewayArtifacts([{ file: 'index.html', data: '<html><head></head><body><iframe src="https://video.example.test/vsl"></iframe></body></html>' }, { file: 'form/index.html', data: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; frame-src https://video.example.test; style-src \'self\'; font-src https://fonts.gstatic.com; img-src \'self\' data:; script-src \'self\'; connect-src \'self\'; form-action https://studio.example.test"><body>Form</body>' }], { ...scope, runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'root-secret-only-at-studio', providers: [{ provider, id }] });
    const page = artifacts.files.find((file) => file.file === 'index.html').data;
    const form = artifacts.files.find((file) => file.file === 'form/index.html').data;
    assert.match(page, new RegExp(`script-src[^;]*${scriptHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), provider);
    assert.match(page, new RegExp(`connect-src[^;]*${connectHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), provider);
    assert.match(page, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
    assert.match(page, /font-src https:\/\/fonts\.gstatic\.com/);
    assert.match(page, /img-src 'self' data: https:/);
    assert.match(page, /media-src https:/);
    assert.match(page, /frame-src https:/);
    assert.match(page, /form-action 'self'/);
    assert.equal(page.includes('evil.example.test'), false);
    assert.match(form, /frame-src https:\/\/video\.example\.test/);
    assert.match(form, /style-src 'self'/);
    assert.match(form, /font-src https:\/\/fonts\.gstatic\.com/);
    assert.match(form, new RegExp(`script-src[^;]*${scriptHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), provider);
    assert.match(form, new RegExp(`connect-src[^;]*${connectHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), provider);
  }
});

test('gateway recusa rota, host ou escopo inválido antes de qualquer request interno', async () => {
  let calls = 0;
  const base = { publicationId: scope.publicationId, environment: scope.environment, derivedKey: 'key', gatewayOrigin: 'https://studio.example.test', fetchImpl: async () => { calls += 1; return new Response('ok'); } };
  await assert.rejects(() => forwardRuntimeGatewayRequest({ ...base, method: 'POST', path: '/api/private/users', host: 'lp.example.test' }), /rota/i);
  await assert.rejects(() => forwardRuntimeGatewayRequest({ ...base, method: 'POST', path: '/api/public/forms/x/submissions', host: 'evil.test\nheader: nope' }), /host/i);
  await assert.rejects(() => forwardRuntimeGatewayRequest({ ...base, method: 'POST', path: '/api/public/forms/x/submissions', host: 'lp.example.test', environment: 'development' }), /escopo/i);
  assert.equal(calls, 0);
});

test('runtime transforma todos os click IDs da landing em cookie HttpOnly assinado e o Studio só aceita a allowlist', async () => {
  const derivedKey = derivePublicationRuntimeKey('root-secret-only-at-studio', scope);
  const result = await forwardRuntimeGatewayRequest({ method: 'GET', path: '/_alva/runtime.js', host: 'lp.example.test', headers: { referer: 'https://lp.example.test/?fbc=a&fbp=b&gclid=c&gbraid=d&wbraid=e&ttclid=f&li_fat_id=g&tblci=h&unknown=no' }, publicationId: scope.publicationId, environment: scope.environment, derivedKey, gatewayOrigin: 'https://studio.example.test', now: () => 1_700_000_000, nonce: () => 'nonce-attribution-123', fetchImpl: async () => new Response('runtime') });
  const cookie = result.headers['set-cookie'][0];
  assert.match(cookie, /^alva_runtime_attribution=/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(cookie.includes('unknown'), false);
});
