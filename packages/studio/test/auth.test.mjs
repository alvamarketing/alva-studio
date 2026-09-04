import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
const owner = { name: 'Tai', email: 'tai@example.com', password: 'long-test-password' };
async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'alva-auth-'));
  const server = createApp({ dataDir, authOptions: { token: null, teamId: null }, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const request = async (path, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return r;
  };
  return { request, dataDir, base, getCookie: () => cookie };
}
test('bootstrap protege APIs, cria só um dono e persiste senha derivada', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('/api/session')).json(), {
    setupRequired: true,
    authenticated: false,
    owner: null,
  });
  assert.equal((await f.request('/api/pages')).status, 401);
  assert.equal((await f.request('/api/setup', 'POST', owner, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('/api/setup', 'POST', owner, { Origin: '' })).status, 403);
  const rs = await Promise.all([f.request('/api/setup', 'POST', owner), f.request('/api/setup', 'POST', owner)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  const success = rs.find((r) => r.status === 201);
  assert.match(success.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const file = await readFile(join(f.dataDir, 'owner.json'), 'utf8');
  assert.ok(!file.includes(owner.password));
  assert.equal((await stat(join(f.dataDir, 'owner.json'))).mode & 0o777, 0o600);
  assert.equal((await (await f.request('/api/session')).json()).authenticated, true);
});
test('login, logout, troca de conta e expiração invalidam sessões', async (t) => {
  let time = 1000;
  const f = await fixture(t, { authOptions: { now: () => time, sessionTTL: 60000, token: null } });
  await f.request('/api/setup', 'POST', owner);
  const first = f.getCookie();
  await f.request('/api/logout', 'POST', {});
  assert.equal((await f.request('/api/pages', 'GET', undefined, { Cookie: first })).status, 401);
  assert.equal((await f.request('/api/login', 'POST', { ...owner, password: 'incorrect' })).status, 401);
  assert.equal((await f.request('/api/login', 'POST', owner)).status, 200);
  const previous = f.getCookie();
  assert.equal(
    (
      await f.request('/api/account', 'PUT', {
        name: 'Novo',
        email: 'new@example.com',
        currentPassword: owner.password,
        newPassword: 'changed-password-123',
      })
    ).status,
    200,
  );
  assert.equal((await f.request('/api/pages', 'GET', undefined, { Cookie: previous })).status, 401);
  assert.equal((await f.request('/api/login', 'POST', owner)).status, 401);
  time += 60001;
  assert.equal((await f.request('/api/pages')).status, 401);
  assert.equal(
    (await f.request('/api/login', 'POST', { email: 'new@example.com', password: 'changed-password-123' })).status,
    200,
  );
});
test('limite de tentativas tem janela finita', async (t) => {
  let time = 0;
  const f = await fixture(t, { authOptions: { now: () => time, token: null } });
  for (let i = 0; i < 12; i++) assert.equal((await f.request('/api/login', 'POST', owner)).status, 401);
  assert.equal((await f.request('/api/login', 'POST', owner)).status, 429);
  time += 900001;
  assert.equal((await f.request('/api/login', 'POST', owner)).status, 401);
});
test('token Vercel cifrado, mascarado, persistido e desconectável', async (t) => {
  const f = await fixture(t);
  await f.request('/api/setup', 'POST', owner);
  const secret = 'private-vercel-test-token';
  let r = await f.request('/api/settings/vercel', 'PUT', { token: secret, teamId: 'team_123' });
  assert.deepEqual(await r.json(), {
    vercel: { connected: true, tokenConfigured: true, teamId: 'team_123', source: 'saved' },
  });
  assert.ok(!(await readFile(join(f.dataDir, 'owner.json'), 'utf8')).includes(secret));
  assert.equal((await stat(join(f.dataDir, 'secret.key'))).mode & 0o777, 0o600);
  const { Auth } = await import('../server/auth.mjs');
  assert.equal((await new Auth(f.dataDir).credentials()).token, secret);
  r = await f.request('/api/settings/vercel', 'PUT', { token: '', teamId: '' });
  assert.equal((await r.json()).vercel.connected, true);
  r = await f.request('/api/settings/vercel', 'PUT', { disconnect: true });
  assert.equal((await r.json()).vercel.connected, false);
});
test('PUBLIC_ORIGIN rejeita bootstrap remoto e configuração insegura', async (t) => {
  assert.throws(() => createApp({ publicOrigin: 'http://example.com' }), /HTTPS/);
  const f = await fixture(t, { publicOrigin: 'https://studio.example.com' });
  assert.equal(
    (await f.request('/api/setup', 'POST', owner, { Host: 'studio.example.com', Origin: 'https://studio.example.com' }))
      .status,
    403,
  );
});
test('todas as rotas de página e credenciais exigem sessão', async (t) => {
  const f = await fixture(t);
  for (const [path, method] of [
    ['/api/config', 'GET'],
    ['/api/settings', 'GET'],
    ['/api/settings/vercel', 'PUT'],
    ['/api/settings/vercel/test', 'POST'],
    ['/api/account', 'PUT'],
    ['/api/pages', 'POST'],
    ['/api/pages/id/publish', 'POST'],
    ['/api/pages/id/status', 'GET'],
    ['/api/pages/id/domain', 'POST'],
  ]) {
    assert.equal((await f.request(path, method, method === 'GET' ? undefined : {})).status, 401, path);
  }
});

test('segredo Vercel sem chave não derruba arquivos e páginas e pode ser substituído', async (t) => {
  const f = await fixture(t);
  await f.request('/api/setup', 'POST', owner);
  await f.request('/api/settings/vercel', 'PUT', { token: 'old-encrypted-token', teamId: 'team_old' });
  await unlink(join(f.dataDir, 'secret.key'));
  assert.equal((await f.request('/')).status, 200);
  assert.equal((await f.request('/app.js')).status, 200);
  assert.equal((await f.request('/api/pages')).status, 200);
  const replacement = await f.request('/api/settings/vercel', 'PUT', {
    token: 'replacement-token', teamId: 'team_new',
  });
  assert.equal(replacement.status, 200);
  assert.deepEqual((await replacement.json()).vercel, {
    connected: true, tokenConfigured: true, teamId: 'team_new', source: 'saved',
  });
});

test('segredo Vercel corrompido pode ser desconectado sem decifração', async (t) => {
  const f = await fixture(t);
  await f.request('/api/setup', 'POST', owner);
  await f.request('/api/settings/vercel', 'PUT', { token: 'encrypted-token', teamId: 'team_old' });
  await writeFile(join(f.dataDir, 'secret.key'), Buffer.alloc(32, 7));
  const response = await f.request('/api/settings/vercel', 'PUT', { disconnect: true });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).vercel, {
    connected: false, tokenConfigured: false, teamId: '', source: null,
  });
});

test('setup assume lock antigo apenas quando o processo registrado morreu', async (t) => {
  const time = 1_000_000;
  const dir = await mkdtemp(join(tmpdir(), 'alva-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { Auth } = await import('../server/auth.mjs');
  const auth = new Auth(dir, { now: () => time, setupLockTTL: 1000, token: null });
  await writeFile(join(dir, 'setup.lock'), JSON.stringify({ pid: 2_147_483_647, createdAt: time - 1001 }), { mode: 0o600 });
  assert.deepEqual(await auth.setup(owner), { name: owner.name, email: owner.email });
  await assert.rejects(() => stat(join(dir, 'setup.lock')), { code: 'ENOENT' });
});

test('setup preserva lock antigo se o processo registrado ainda vive', async (t) => {
  const time = 1_000_000;
  const dir = await mkdtemp(join(tmpdir(), 'alva-lock-live-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { Auth } = await import('../server/auth.mjs');
  const auth = new Auth(dir, { now: () => time, setupLockTTL: 1000, token: null });
  await writeFile(join(dir, 'setup.lock'), JSON.stringify({ pid: process.pid, createdAt: time - 1001 }), { mode: 0o600 });
  await assert.rejects(() => auth.setup(owner), (error) => error.status === 409);
  assert.equal((await stat(join(dir, 'setup.lock'))).isFile(), true);
});
