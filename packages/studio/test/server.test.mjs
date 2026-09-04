import { test } from 'node:test';
import { get } from 'node:http';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'alva-http-'));
  const server = createApp({ dataDir, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tai', email: 'tai@example.com', password: 'test-password-123' }),
  });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const request = (path, options = {}) =>
    fetch(base + path, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } });
  return { base, request };
}
test('API cria, edita, duplica e exclui páginas isoladas', async (t) => {
  const { base, request } = await setup(t);
  const send = (path, method, body) =>
    request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r = await send('/api/pages', 'POST', { name: 'LP Alva' });
  assert.equal(r.status, 201);
  const page = await r.json();
  r = await send('/api/pages/' + page.id, 'PUT', { revision: 0, project: { pages: [] }, html: '<h1>Teste</h1>' });
  assert.equal((await r.json()).revision, 1);
  r = await send('/api/pages/' + page.id + '/duplicate', 'POST', {});
  assert.equal(r.status, 201);
  const copy = await r.json();
  assert.notEqual(copy.id, page.id);
  r = await send('/api/pages/' + copy.id, 'DELETE', {});
  assert.equal(r.status, 200);
  assert.equal((await (await request('/api/pages')).json()).length, 1);
});
test('bloqueia origem externa, corpo indevido e hostname arbitrário', async (t) => {
  const { base, request } = await setup(t);
  let r = await request('/api/pages', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 403);
  r = await request('/api/pages', { method: 'POST', body: '{}' });
  assert.equal(r.status, 415);
  const status = await new Promise((resolve, reject) => {
    get(base + '/api/pages', { headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
});
test('configuração indica desconexão e não inclui credenciais', async (t) => {
  const { base, request } = await setup(t);
  const result = await (await request('/api/config')).json();
  assert.deepEqual(result, { vercelConnected: false });
});

test('locale português é executável no navegador sem CommonJS', async (t) => {
  const { base, request } = await setup(t);
  const response = await fetch(base + '/vendor/pt.js');
  assert.equal(response.status, 200);
  const context = { window: {} };
  runInNewContext(await response.text(), context);
  assert.ok(context.window.alvaLocale.assetManager);
});

test('controlador de aparência é entregue como módulo do Studio', async (t) => {
  const { base } = await setup(t);
  const response = await fetch(base + '/ui-preferences.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/javascript/);
  assert.match(await response.text(), /createUIPreferences/);
});

test('formulários dinâmicos têm administração protegida e execução pública', async (t) => {
  const webhooks = [];
  const { base, request } = await setup(t, {
    webhookFetch: async (url, options) => {
      webhooks.push({ url, payload: JSON.parse(options.body) });
      return { ok: true };
    },
  });
  const send = (path, method, body) =>
    request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await send('/api/forms', 'POST', { name: 'Diagnóstico de Vendas' });
  assert.equal(response.status, 201);
  let form = await response.json();
  response = await send('/api/forms/' + form.id, 'PUT', {
    revision: form.revision,
    webhook: 'https://example.com/inlead',
    steps: [{ id: 'email', type: 'email', title: 'Qual é o seu e-mail?', required: true }],
  });
  form = await response.json();

  response = await fetch(base + '/f/' + form.slug);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Qual é o seu e-mail\?/);

  response = await fetch(base + '/api/public/forms/' + form.id + '/submit', {
    method: 'POST',
    headers: { Origin: 'https://formulario.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'pessoa@example.com', campo_falso: 'ignorar' }),
    redirect: 'manual',
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Obrigado!/);
  assert.equal(webhooks.length, 1);
  assert.equal(webhooks[0].payload.answers.email, 'pessoa@example.com');
  assert.equal(webhooks[0].payload.answers.campo_falso, undefined);

  const submissions = await (await request('/api/forms/' + form.id + '/submissions')).json();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].answers.email, 'pessoa@example.com');
  assert.equal((await fetch(base + '/api/forms')).status, 401);
});
