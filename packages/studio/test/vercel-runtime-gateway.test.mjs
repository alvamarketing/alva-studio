import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { gatewayPublicado } from './gateway-publicado.mjs';

const scope = { publicationId: 'run-1', snapshotHash: 'a'.repeat(64), environment: 'production' };

// O módulo publicado, com a raiz de segredo que só o Studio conhece. A Vercel recebe só a
// chave derivada (`runtimeEnv`).
async function publicado({ fetchImpl, env = {} }) {
  const artefato = runtimeGatewayArtifacts([], { ...scope, runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'root-secret-only-at-studio' });
  return { artefato, gateway: await gatewayPublicado({ artefato, dominio: 'lp.example.test', fetchImpl, env: { ...artefato.runtimeEnv, ...env } }) };
}

test('gateway da Vercel preserva corpo e cookie, assina o request e não recebe o segredo raiz', async () => {
  const requests = [];
  const { artefato, gateway } = await publicado({
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response('ok', { status: 201, headers: { 'content-type': 'text/html', 'set-cookie': 'alva_runtime_consent=subject-1234567890; HttpOnly; Path=/' } });
    },
  });
  const result = await gateway({
    method: 'POST',
    path: '/api/public/pages/captures/11111111-1111-4111-8111-111111111111/submissions',
    headers: { cookie: 'alva_runtime_consent=subject-1234567890; other=1', origin: 'https://lp.example.test', 'content-type': 'application/json' },
    body: Buffer.from('{"answers":{"email":"pessoa@example.test"}}'),
  });
  assert.equal(JSON.stringify(artefato.runtimeEnv).includes('root-secret-only-at-studio'), false);
  assert.equal(result.status, 201);
  assert.equal(Buffer.from(result.body).toString(), 'ok');
  assert.equal(requests[0].url, 'https://studio.example.test/api/public/pages/captures/11111111-1111-4111-8111-111111111111/submissions');
  assert.equal(Buffer.from(requests[0].init.body).toString(), '{"answers":{"email":"pessoa@example.test"}}');
  assert.equal(requests[0].init.headers.cookie, 'alva_runtime_consent=subject-1234567890; other=1');
  assert.equal(requests[0].init.headers['x-alva-public-host'], 'lp.example.test');
  assert.equal(requests[0].init.headers['x-alva-publication-id'], scope.publicationId);
  assert.match(requests[0].init.headers['x-alva-runtime-signature'], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(requests[0]).includes('root-secret-only-at-studio'), false);
  assert.deepEqual(result.headers['set-cookie'], ['alva_runtime_consent=subject-1234567890; HttpOnly; Path=/']);
});

test('artefatos da Function roteiam runtime e capturas por uma única fronteira e não alteram o snapshot', () => {
  const snapshotFiles = [{ file: 'index.html', data: '<html><head></head><body><form action="https://studio.example.test/api/public/pages/acme/campanha/captures/11111111-1111-4111-8111-111111111111/submissions"></form>Olá</body></html>' }, { file: 'contato/index.html', data: '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; connect-src \'self\'; form-action https://studio.example.test"><body>Contato</body>' }];
  const artifacts = runtimeGatewayArtifacts(snapshotFiles, {
    publicationId: scope.publicationId,
    snapshotHash: scope.snapshotHash,
    environment: scope.environment,
    runtimeOrigin: 'https://studio.example.test',
    runtimeHmacSecret: 'root-secret-only-at-studio',
    providers: [{ provider: 'meta', id: '123' }],
  });
  assert.deepEqual(snapshotFiles, [{ file: 'index.html', data: '<html><head></head><body><form action="https://studio.example.test/api/public/pages/acme/campanha/captures/11111111-1111-4111-8111-111111111111/submissions"></form>Olá</body></html>' }, { file: 'contato/index.html', data: '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; connect-src \'self\'; form-action https://studio.example.test"><body>Contato</body>' }]);
  const names = artifacts.files.map((file) => file.file).sort();
  assert.deepEqual(names, ['api/_alva/[...path].js', 'api/_alva/gateway.cjs', 'contato/index.html', 'index.html', 'vercel.json']);
  const config = JSON.parse(artifacts.files.find((file) => file.file === 'vercel.json').data);
  assert.deepEqual(config.rewrites.map((rewrite) => rewrite.destination), ['/api/_alva/runtime/:path*', '/api/_alva/pages/:path*']);
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
  assert.match(page, /action="\/api\/public\/pages\/captures\/11111111-1111-4111-8111-111111111111\/submissions"/);
  assert.doesNotMatch(page, /pages\/acme\/campanha/);
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
  const fetchImpl = async () => { calls += 1; return new Response('ok'); };
  const { gateway } = await publicado({ fetchImpl });
  const rota = await gateway({ method: 'POST', path: '/api/_alva/private/users' });
  assert.deepEqual([rota.status, rota.text], [404, 'Rota não encontrada.']);
  // O envio do formulário antigo não tem mais rota no gateway.
  for (const antigo of ['/api/public/forms/x/submissions', '/api/_alva/forms/x/submissions']) {
    const resposta = await gateway({ method: 'POST', path: antigo });
    assert.deepEqual([resposta.status, resposta.text], [404, 'Rota não encontrada.'], antigo);
  }
  const host = await gateway({ method: 'POST', path: '/api/public/pages/x/submissions', headers: { host: 'evil.test\nheader: nope' } });
  assert.deepEqual([host.status, host.text], [400, 'Host inválido.']);
  const { gateway: foraDoEscopo } = await publicado({ fetchImpl, env: { ALVA_RUNTIME_ENVIRONMENT: 'development' } });
  const escopo = await foraDoEscopo({ method: 'POST', path: '/api/public/pages/x/submissions' });
  assert.deepEqual([escopo.status, escopo.text], [500, 'Runtime indisponível.']);
  assert.equal(calls, 0);
});

test('runtime transforma todos os click IDs da landing em cookie HttpOnly assinado e o Studio só aceita a allowlist', async () => {
  const { gateway } = await publicado({ fetchImpl: async () => new Response('runtime') });
  const result = await gateway({ method: 'GET', path: `/_alva/runtime.js?publicationId=${scope.publicationId}`, headers: { referer: 'https://lp.example.test/?fbc=a&fbp=b&gclid=c&gbraid=d&wbraid=e&ttclid=f&li_fat_id=g&tblci=h&unknown=no' } });
  const cookie = result.headers['set-cookie'][0];
  assert.match(cookie, /^alva_runtime_attribution=/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(cookie.includes('unknown'), false);
});
