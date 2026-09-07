import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function start(t, database) {
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}

async function request(base, cookie, path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const nextCookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
  return { response, cookie: nextCookie };
}

test('prévia autenticada renderiza rascunho e conclui localmente sem POST, lead ou tracker', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const base = await start(t, database);
  let auth = await request(base, '', '/api/setup', 'POST', { name: 'Preview', email: 'preview@alva.test', password: 'senha-preview-segura' });
  assert.equal(auth.response.status, 201);
  const cookie = auth.cookie;
  const created = await request(base, cookie, '/api/forms', 'POST', {
    name: 'Quiz rascunho',
    draftSchema: {
      headerElements: [],
      steps: [{ id: 'email', title: 'E-mail', elements: [{ id: 'email', type: 'email', title: 'Seu e-mail', required: true }] }],
      completion: { title: 'Prévia concluída', message: 'Sem envio.' },
    },
  });
  assert.equal(created.response.status, 201);
  const form = await created.response.json();

  const preview = await request(base, cookie, `/api/forms/${form.id}/preview`);
  assert.equal(preview.response.status, 200);
  const payload = await preview.response.json();
  assert.equal(Object.keys(payload).sort().join(','), 'html');
  assert.match(payload.html, /Prévia: respostas não são enviadas/);
  assert.doesNotMatch(payload.html, /tracker\.js|api\/public\/collect/);
  assert.doesNotMatch(payload.html, /fetch\(/);

  const htmlPreview = await request(base, cookie, `/api/forms/${form.id}/preview?format=html`);
  assert.equal(htmlPreview.response.status, 200);
  assert.match(htmlPreview.response.headers.get('content-type'), /^text\/html/);
  assert.equal(htmlPreview.response.headers.get('cache-control'), 'no-store');
  assert.equal(htmlPreview.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(htmlPreview.response.headers.get('x-content-type-options'), 'nosniff');
  const html = await htmlPreview.response.text();
  assert.match(html, /Prévia: respostas não são enviadas/);
  const csp = htmlPreview.response.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-src https:/);
  assert.match(csp, /frame-ancestors 'self'/);
  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.match(nonce || '', /^[a-z0-9]+$/i);
  assert.match(html, new RegExp(`<script nonce="${nonce}">`));
  assert.doesNotMatch(html, /tracker\.js|api\/public\/collect/);

  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  let fetchCalls = 0;
  const dom = new JSDOM(payload.html, {
    runScripts: 'dangerously',
    url: `${base}/api/forms/${form.id}/preview`,
    beforeParse(window) {
      window.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
      window.fetch = async () => { fetchCalls += 1; throw new Error('preview não deve fazer POST'); };
    },
  });
  const input = dom.window.document.querySelector('input[name="email"]');
  input.value = 'lead@example.test';
  dom.window.document.querySelector('.next').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.match(dom.window.document.body.textContent, /Prévia concluída/);
  dom.window.close();

  const other = await request(base, cookie, '/api/projects', 'POST', { name: 'Outro projeto', slug: 'outro-projeto' });
  assert.equal(other.response.status, 201);
  const otherProject = await other.response.json();
  const switched = await request(base, cookie, '/api/session', 'PATCH', { companyId: form.companyId, projectId: otherProject.id });
  assert.equal(switched.response.status, 200);
  const denied = await request(base, cookie, `/api/forms/${form.id}/preview`);
  assert.equal(denied.response.status, 404);
  const deniedHtml = await request(base, cookie, `/api/forms/${form.id}/preview?format=html`);
  assert.equal(deniedHtml.response.status, 404);
  const unauthenticatedHtml = await request(base, '', `/api/forms/${form.id}/preview?format=html`);
  assert.equal(unauthenticatedHtml.response.status, 401);
  await database.close();
});
