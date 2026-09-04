import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const scrypt = promisify(scryptCallback);

async function legacyPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return JSON.stringify({ salt, hash });
}

async function start(t, database, options = {}) {
  const server = createApp({ database, sessionOptions: { sessionTTL: 60_000, ...options } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

function client(base, initialCookie = '') {
  let cookie = initialCookie;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: base,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return { request, cookie: () => cookie };
}

async function seed(database) {
  const password = 'senha-legada-segura';
  const alice = (await database.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('alice@alva.test', $1, 'Alice') RETURNING id`,
    [await legacyPassword(password)],
  )).rows[0];
  const bob = (await database.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('bob@alva.test', $1, 'Bob') RETURNING id`,
    [await legacyPassword(password)],
  )).rows[0];
  const analyst = (await database.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('analista@alva.test', $1, 'Analista') RETURNING id`,
    [await legacyPassword(password)],
  )).rows[0];
  const companyA = (await database.query("INSERT INTO companies (name, slug) VALUES ('Alva A', 'alva-a') RETURNING id")).rows[0];
  const companyB = (await database.query("INSERT INTO companies (name, slug) VALUES ('Alva B', 'alva-b') RETURNING id")).rows[0];
  await database.query(
    `INSERT INTO company_memberships (company_id, user_id, role, joined_at)
     VALUES ($1, $2, 'owner', now()), ($3, $2, 'owner', now()), ($1, $4, 'analyst', now())`,
    [companyA.id, alice.id, companyB.id, analyst.id],
  );
  const projectA = (await database.query(
    "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto A', 'projeto-a', $2) RETURNING id",
    [companyA.id, alice.id],
  )).rows[0];
  const projectB = (await database.query(
    "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto B', 'projeto-b', $2) RETURNING id",
    [companyB.id, alice.id],
  )).rows[0];
  const analystMembership = (await database.query(
    'SELECT id FROM company_memberships WHERE company_id = $1 AND user_id = $2', [companyA.id, analyst.id],
  )).rows[0];
  await database.query(
    'INSERT INTO project_grants (company_id, membership_id, project_id) VALUES ($1, $2, $3)',
    [companyA.id, analystMembership.id, projectA.id],
  );
  return { password, alice, bob, analyst, companyA, companyB, projectA, projectB };
}

test('sessão persistente troca contexto explicitamente e isola projetos por empresa', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const first = await start(t, database);
  const alice = client(first.base);

  const login = await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  assert.equal(login.status, 200, await login.text());
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(alice.cookie(), /^alva_session=[A-Za-z0-9_-]{43}$/);
  const tokenHash = (await database.query('SELECT token_hash FROM sessions WHERE user_id = $1', [records.alice.id])).rows[0].token_hash;
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(tokenHash.includes(alice.cookie().slice('alva_session='.length)), false);
  assert.match((await database.query('SELECT password_hash FROM users WHERE id = $1', [records.alice.id])).rows[0].password_hash, /^scrypt-v1\$/);
  const initial = await (await alice.request('/api/session')).json();
  assert.deepEqual(initial.user, { id: records.alice.id, email: 'alice@alva.test', displayName: 'Alice' });
  assert.deepEqual(initial.companies.map((company) => company.id), [records.companyA.id, records.companyB.id]);
  assert.equal(initial.currentCompanyId, records.companyA.id);
  assert.equal(initial.currentProjectId, records.projectA.id);

  await new Promise((resolve) => first.server.close(resolve));
  const restarted = await start(t, database);
  const afterRestart = await (await fetch(restarted.base + '/api/session', { headers: { Cookie: alice.cookie() } })).json();
  assert.equal(afterRestart.authenticated, true);
  assert.equal(afterRestart.currentProjectId, records.projectA.id);

  const resumed = client(restarted.base, alice.cookie());
  assert.equal((await resumed.request('/api/session', 'PATCH', { companyId: records.companyB.id, projectId: records.projectB.id })).status, 200);
  const switched = await (await resumed.request('/api/session')).json();
  assert.equal(switched.currentCompanyId, records.companyB.id);
  assert.equal(switched.currentProjectId, records.projectB.id);
  assert.equal((await resumed.request(`/api/projects/${records.projectA.id}`)).status, 404);
  assert.equal((await resumed.request(`/api/projects/${records.projectB.id}`)).status, 200);
  await database.close();
});

test('APIs do projeto exigem sessão, ocultam recursos cruzados e aplicam capacidade', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  const analyst = client(app.base);

  assert.equal((await alice.request('/api/projects')).status, 401);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const create = await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Landing principal', route: '/lp', editorState: { pages: [] }, renderedHtml: '<main>LP</main>',
  });
  assert.equal(create.status, 201);
  const page = await create.json();
  assert.equal(page.projectId, records.projectA.id);
  assert.deepEqual(page.editorState, { pages: [] });
  assert.equal((await alice.request(`/api/projects/${records.projectB.id}/pages`)).status, 404);
  assert.equal((await alice.request('/api/pages')).status, 200);
  assert.equal((await alice.request('/api/pages', 'POST', { name: 'Nunca', project: {} })).status, 400);

  await analyst.request('/api/login', 'POST', { email: 'analista@alva.test', password: records.password });
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/pages`)).status, 200);
  assert.equal(
    (await analyst.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
      name: 'Proibida', route: '/proibida', editorState: {}, renderedHtml: '',
    })).status,
    403,
  );
  await database.close();
});

test('expiração, senha e remoção de membro revogam sessões persistentes', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const original = alice.cookie();

  await database.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [records.alice.id]);
  assert.equal((await (await alice.request('/api/session')).json()).authenticated, false);
  assert.equal((await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password })).status, 200);

  assert.equal(
    (await alice.request('/api/account', 'PUT', {
      name: 'Alice Nova', email: 'alice@alva.test', currentPassword: records.password, newPassword: 'senha-nova-segura',
    })).status,
    200,
  );
  assert.equal((await fetch(app.base + '/api/session', { headers: { Cookie: original } })).status, 200);
  assert.equal((await (await fetch(app.base + '/api/session', { headers: { Cookie: original } })).json()).authenticated, false);

  const relogin = await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: 'senha-nova-segura' });
  assert.equal(relogin.status, 200);
  await database.query(
    "UPDATE company_memberships SET status = 'removed' WHERE company_id = $1 AND user_id = $2",
    [records.companyA.id, records.alice.id],
  );
  assert.equal((await (await alice.request('/api/session')).json()).authenticated, false);
  await database.close();
});
