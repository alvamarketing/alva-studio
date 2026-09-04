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
  const { publicOrigin, authOptions, sessionOptions = {} } = options;
  const server = createApp({
    database,
    publicOrigin,
    authOptions,
    sessionOptions: { sessionTTL: 60_000, ...sessionOptions },
  });
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
  assert.equal((await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Nunca', route: '/nunca', project: {}, editorState: {}, renderedHtml: '',
  })).status, 400);

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

test('a borda SaaS ignora identificadores de escopo enviados no corpo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const created = await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Escopo protegido', route: '/escopo-protegido', editorState: {}, renderedHtml: '',
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.bob.id,
  });
  assert.equal(created.status, 201);
  const page = await created.json();
  assert.equal(page.companyId, records.companyA.id);
  assert.equal(page.projectId, records.projectA.id);
  const persisted = await database.query('SELECT company_id, project_id, created_by FROM pages WHERE id = $1', [page.id]);
  assert.deepEqual(persisted.rows[0], {
    company_id: records.companyA.id,
    project_id: records.projectA.id,
    created_by: records.alice.id,
  });
  const updated = await alice.request(`/api/pages/${page.id}`, 'PUT', {
    name: 'Escopo ainda protegido', revision: page.lockVersion, project: { pages: ['atualizada'] }, html: '<main>ok</main>',
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.bob.id,
  });
  assert.equal(updated.status, 200);
  const afterUpdate = await database.query('SELECT company_id, project_id, created_by FROM pages WHERE id = $1', [page.id]);
  assert.deepEqual(afterUpdate.rows[0], persisted.rows[0]);
  const projectUpdate = await alice.request(`/api/projects/${records.projectA.id}`, 'PUT', {
    name: 'Projeto A protegido', slug: 'projeto-a-protegido', companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.bob.id,
  });
  assert.equal(projectUpdate.status, 200);
  assert.equal((await database.query('SELECT company_id FROM projects WHERE id = $1', [records.projectA.id])).rows[0].company_id, records.companyA.id);
  const formCreated = await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
    name: 'Formulário protegido', route: '/formulario-protegido', draftSchema: { steps: [] },
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.bob.id,
  });
  assert.equal(formCreated.status, 201);
  const form = await formCreated.json();
  const formUpdated = await alice.request(`/api/forms/${form.id}`, 'PUT', {
    revision: form.lockVersion, webhook: 'https://example.test/webhook',
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.bob.id,
  });
  assert.equal(formUpdated.status, 200);
  assert.deepEqual((await database.query(
    'SELECT company_id, project_id, created_by FROM forms WHERE id = $1', [form.id],
  )).rows[0], {
    company_id: records.companyA.id,
    project_id: records.projectA.id,
    created_by: records.alice.id,
  });
  await database.close();
});

test('setup SaaS permanece local, é limitado e serializa a primeira conta', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const app = await start(t, database);
  const first = client(app.base);
  const second = client(app.base);
  const setup = { name: 'Primeira conta', email: 'primeira@alva.test', password: 'senha-inicial-segura' };
  const raced = await Promise.all([
    first.request('/api/setup', 'POST', setup),
    second.request('/api/setup', 'POST', setup),
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1);
  await database.close();
});

test('setup público é bloqueado e login SaaS compartilha o limitador existente', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  await seed(database);
  const app = await start(t, database, { publicOrigin: 'https://studio.alva.test' });
  const publicSetup = await fetch(`${app.base}/api/setup`, {
    method: 'POST',
    headers: {
      Host: 'studio.alva.test', Origin: 'https://studio.alva.test', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Bloqueado', email: 'bloqueado@alva.test', password: 'senha-inicial-segura' }),
  });
  assert.equal(publicSetup.status, 403);
  await database.close();

  const { connectionString: limitedConnection } = await postgresFixture(t);
  const limitedDatabase = createDatabase({ connectionString: limitedConnection });
  await migrate(limitedDatabase);
  await seed(limitedDatabase);
  const limitedApp = await start(t, limitedDatabase);
  const unknown = client(limitedApp.base);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.equal((await unknown.request('/api/login', 'POST', {
      email: 'ausente@alva.test', password: 'senha-inicial-segura',
    })).status, 401);
  }
  assert.equal((await unknown.request('/api/login', 'POST', {
    email: 'ausente@alva.test', password: 'senha-inicial-segura',
  })).status, 429);
  await limitedDatabase.close();
});

test('rotas legadas continuam o fluxo do painel sem usar Auth local nem segredo global', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  assert.deepEqual(await (await alice.request('/api/config')).json(), { vercelConnected: false, pending: true });
  assert.equal((await alice.request('/api/settings')).status, 200);
  assert.equal((await alice.request('/api/settings/vercel', 'PUT', { token: 'nao-persistir' })).status, 409);

  const created = await alice.request('/api/pages', 'POST', { name: 'Página atual', template: 'services' });
  assert.equal(created.status, 201);
  let page = await created.json();
  assert.equal(page.projectId, records.projectA.id);
  assert.deepEqual(page.project, {});
  page = await (await alice.request(`/api/pages/${page.id}`, 'PUT', {
    revision: page.revision, project: { pages: [] }, html: '<main>Atualizada</main>', name: 'Página atualizada',
  })).json();
  assert.equal(page.revision, 1);
  assert.deepEqual(page.project, { pages: [] });
  assert.equal(page.html, '<main>Atualizada</main>');
  const copied = await alice.request(`/api/pages/${page.id}/duplicate`, 'POST', {});
  assert.equal(copied.status, 201);
  assert.notEqual((await copied.json()).id, page.id);
  assert.equal((await alice.request(`/api/pages/${page.id}/publish`, 'POST', { revision: page.revision })).status, 409);
  assert.equal((await alice.request(`/api/pages/${page.id}/status`)).status, 409);
  assert.equal((await alice.request(`/api/pages/${page.id}/domain`, 'POST', {})).status, 409);

  const formCreated = await alice.request('/api/forms', 'POST', { name: 'Formulário atual' });
  assert.equal(formCreated.status, 201);
  let form = await formCreated.json();
  assert.ok(Array.isArray(form.steps));
  form = await (await alice.request(`/api/forms/${form.id}`, 'PUT', {
    revision: form.revision, steps: [{ id: 'nome', type: 'short_text', title: 'Seu nome', required: true }],
  })).json();
  assert.equal(form.revision, 1);
  assert.equal(form.steps[0].id, 'nome');
  assert.equal((await alice.request(`/api/forms/${form.id}/duplicate`, 'POST', {})).status, 201);
  assert.deepEqual(await (await alice.request(`/api/forms/${form.id}/submissions`)).json(), []);
  assert.equal((await alice.request(`/api/forms/${form.id}`, 'DELETE', {})).status, 200);
  await database.close();
});

test('formulário SaaS publicado usa slug público, persiste respostas e mantém configurações', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const created = await alice.request('/api/forms', 'POST', { name: 'Diagnóstico público' });
  assert.equal(created.status, 201);
  let form = await created.json();
  assert.equal(form.slug.startsWith('/'), false);
  form = await (await alice.request(`/api/forms/${form.id}`, 'PUT', {
    revision: form.revision,
    headerElements: [],
    steps: [{
      id: 'inicio', title: 'Comece', motion: 'fade-up', elements: [
        { id: 'email', type: 'email', title: 'Seu e-mail', required: true, placeholder: 'voce@empresa.com' },
      ],
    }],
    completion: { title: 'Recebemos', message: 'Logo entraremos em contato.' },
    webhook: 'https://hooks.example.test/receber',
  })).json();
  assert.equal(form.webhook, 'https://hooks.example.test/receber');
  const publicPage = await fetch(`${app.base}/f/${form.slug}`);
  const publicHtml = await publicPage.text();
  assert.equal(publicPage.status, 200, publicHtml);
  assert.match(publicHtml, new RegExp(`/api/public/forms/${form.slug}/submissions`));
  const submitted = await fetch(`${app.base}/api/public/forms/${form.slug}/submissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { email: 'lead@alva.test' } }),
  });
  const completionHtml = await submitted.text();
  assert.equal(submitted.status, 200, completionHtml);
  assert.match(completionHtml, /Recebemos/);
  assert.equal((await fetch(`${app.base}/api/public/forms/${form.slug}/submissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: {} }),
  })).status, 400);
  const listed = await (await alice.request('/api/forms')).json();
  assert.equal(listed.find((row) => row.id === form.id).submissionCount, 1);
  const persisted = await database.query(
    'SELECT company_id, project_id, form_id, form_version_id, answers FROM form_submissions WHERE form_id = $1', [form.id],
  );
  assert.deepEqual(persisted.rows[0].answers, { email: 'lead@alva.test' });
  assert.equal(persisted.rows[0].company_id, records.companyA.id);
  assert.equal(persisted.rows[0].project_id, records.projectA.id);
  assert.equal(persisted.rows[0].form_version_id, form.publishedVersionId);
  const duplicate = await alice.request(`/api/forms/${form.id}/duplicate`, 'POST', {});
  assert.equal(duplicate.status, 201);
  assert.equal((await duplicate.json()).webhook, '');

  const page = await (await alice.request('/api/pages', 'POST', { name: 'Página com ajustes' })).json();
  const savedPage = await alice.request(`/api/pages/${page.id}`, 'PUT', {
    revision: page.revision, project: {}, html: '', domain: 'lp.alva.test', webhook: 'https://hooks.example.test/pagina',
  });
  assert.equal(savedPage.status, 200);
  assert.equal((await savedPage.json()).domain, 'lp.alva.test');
  const reloadedPage = await (await alice.request(`/api/pages/${page.id}`)).json();
  assert.equal(reloadedPage.domain, 'lp.alva.test');
  assert.equal(reloadedPage.webhook, 'https://hooks.example.test/pagina');
  assert.equal((await alice.request('/api/settings/vercel', 'PUT', { token: 'nao-salvar' })).status, 409);
  await database.close();
});

test('expiração e remoção revogam sessões; atualização preserva contexto e troca de senha recria sessão', async (t) => {
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

  const beforeUpdate = alice.cookie();
  const update = await alice.request('/api/account', 'PUT', {
    name: 'Alice Atualizada', email: 'alice-atualizada@alva.test', currentPassword: records.password,
  });
  assert.equal(update.status, 200);
  assert.equal(alice.cookie(), beforeUpdate);
  const afterUpdate = await (await alice.request('/api/session')).json();
  assert.equal(afterUpdate.user.email, 'alice-atualizada@alva.test');
  assert.equal(afterUpdate.currentCompanyId, records.companyA.id);
  assert.equal(afterUpdate.currentProjectId, records.projectA.id);

  assert.equal(
    (await alice.request('/api/account', 'PUT', {
      name: 'Alice Nova', email: 'alice-atualizada@alva.test', currentPassword: records.password, newPassword: 'senha-nova-segura',
    })).status,
    200,
  );
  assert.notEqual(alice.cookie(), beforeUpdate);
  const afterPassword = await (await alice.request('/api/session')).json();
  assert.equal(afterPassword.currentCompanyId, records.companyA.id);
  assert.equal(afterPassword.currentProjectId, records.projectA.id);
  assert.equal((await fetch(app.base + '/api/session', { headers: { Cookie: original } })).status, 200);
  assert.equal((await (await fetch(app.base + '/api/session', { headers: { Cookie: original } })).json()).authenticated, false);

  const relogin = await alice.request('/api/login', 'POST', { email: 'alice-atualizada@alva.test', password: 'senha-nova-segura' });
  assert.equal(relogin.status, 200);
  await database.query(
    "UPDATE company_memberships SET status = 'removed' WHERE company_id = $1 AND user_id = $2",
    [records.companyA.id, records.alice.id],
  );
  assert.equal((await (await alice.request('/api/session')).json()).authenticated, false);
  await database.close();
});
