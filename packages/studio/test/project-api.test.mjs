import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.mjs';
import { overviewForRuntime } from '../server/project-api.mjs';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const scrypt = promisify(scryptCallback);

async function legacyPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return JSON.stringify({ salt, hash });
}

async function start(t, database, options = {}) {
  const { publicOrigin, authOptions, sessionOptions = {}, dnsLookup, webhookFetch, runtimeFlags } = options;
  const server = createApp({
    database,
    publicOrigin,
    authOptions,
    dnsLookup,
    webhookFetch,
    runtimeFlags,
    sessionOptions: { sessionTTL: 60_000, ...sessionOptions },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function publicRequest(base, path, host, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(base + path, {
      method,
      headers: { Host: host, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    }, (response) => {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { content += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text: content }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
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

function assertKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
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

test('leads do projeto paginam, isolam projetos e exportam CSV', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const content = new ContentRepository(database);
  const captureId = '00000000-0000-4000-8000-000000000099';
  const capturePage = await content.createPage({
    companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id,
    name: 'Landing de captura', route: '/captura', renderedHtml: '<main>captura</main>',
    editorState: { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': captureId, 'data-alva-capture-name': 'Diagnóstico' }, components: [
      { tagName: 'label', components: [{ content: 'E-mail antigo' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: true } }] },
    ] }] },
  });
  const pageVersion = await content.publishPage({
    companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: capturePage.id,
  });
  const otherPage = await content.createPage({
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.alice.id,
    name: 'Outro projeto', route: '/outro', renderedHtml: '<main>outro</main>', editorState: {},
  });
  await database.query(
    `INSERT INTO page_submissions (id, company_id, project_id, page_id, page_version_id, capture_id, answers, submitted_at)
     VALUES
       ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5, $6::jsonb, '2026-09-05T10:00:00.000Z'),
       ('00000000-0000-4000-8000-000000000002', $1, $2, $3, $4, $5, $7::jsonb, '2026-09-05T11:00:00.000Z'),
       ('00000000-0000-4000-8000-000000000003', $1, $2, $3, $4, $5, $8::jsonb, '2026-09-05T12:00:00.000Z')`,
    [records.companyA.id, records.projectA.id, capturePage.id, pageVersion.id, captureId,
      JSON.stringify({ email: 'primeira@alva.test', legado: '=1+1' }),
      JSON.stringify({ email: 'segunda@alva.test' }),
      JSON.stringify({ email: '=captura' })],
  );
  for (const [submissionId, status] of [['00000000-0000-4000-8000-000000000002', 'delivered'], ['00000000-0000-4000-8000-000000000001', 'dead']]) {
    await database.query(
      `INSERT INTO webhook_deliveries (company_id, project_id, source_kind, page_id, page_submission_id, url, event, status)
       VALUES ($1, $2, 'page', $3, $4, 'https://hooks.example.test/lead', '{}'::jsonb, $5)`,
      [records.companyA.id, records.projectA.id, capturePage.id, submissionId, status],
    );
  }
  const app = await start(t, database);
  const analyst = client(app.base);
  const alice = client(app.base);
  await analyst.request('/api/login', 'POST', { email: 'analista@alva.test', password: records.password });
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const first = await analyst.request(`/api/projects/${records.projectA.id}/leads?limit=1`);
  const firstText = await first.text();
  assert.equal(first.status, 200, firstText);
  const page = JSON.parse(firstText);
  assert.deepEqual(page.items.map((item) => ({ sourceKind: item.sourceKind, sourceId: item.sourceId, captureId: item.captureId, answers: item.answers })), [{
    sourceKind: 'page', sourceId: capturePage.id, captureId, answers: { email: '=captura' },
  }]);
  assert.deepEqual(page.items[0].fields, [{ id: 'email', type: 'email', title: 'E-mail antigo', required: true }]);
  assert.equal(page.items[0].submittedAt, '2026-09-05T12:00:00.000Z');
  assert.ok(page.sources.some((source) => source.sourceKind === 'page' && source.sourceId === capturePage.id && source.captureId === captureId));
  assert.ok(page.sources.every((source) => Object.keys(source).sort().join(',') === 'captureId,captureName,sourceId,sourceKind,sourceName,sourcePath'));
  assert.match(page.nextCursor, /^[A-Za-z0-9_-]+$/);
  const second = await analyst.request(`/api/projects/${records.projectA.id}/leads?cursor=${encodeURIComponent(page.nextCursor)}&limit=100`);
  const secondText = await second.text();
  assert.equal(second.status, 200, secondText);
  assert.deepEqual(JSON.parse(secondText).items.map((item) => item.answers.email), ['segunda@alva.test', 'primeira@alva.test']);
  assert.deepEqual(JSON.parse(secondText).items.map((item) => item.webhookStatus), ['delivered', 'failed']);
  const captureLeads = await analyst.request(`/api/projects/${records.projectA.id}/leads?sourceKind=page&sourceId=${capturePage.id}&captureId=${captureId}`);
  assert.deepEqual((await captureLeads.json()).items.map((item) => ({ id: item.id, webhookStatus: item.webhookStatus })), [
    { id: '00000000-0000-4000-8000-000000000003', webhookStatus: '' },
    { id: '00000000-0000-4000-8000-000000000002', webhookStatus: 'delivered' },
    { id: '00000000-0000-4000-8000-000000000001', webhookStatus: 'failed' },
  ]);
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads?sourceKind=page&sourceId=${capturePage.id}&captureId=${otherPage.id}`)).status, 404);
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads?cursor=invalido`)).status, 400);
  assert.equal((await alice.request(`/api/projects/${records.projectA.id}/leads?sourceKind=page&sourceId=${otherPage.id}`)).status, 404);
  // O filtro do formulário antigo não existe mais.
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads?sourceKind=form&sourceId=${capturePage.id}`)).status, 400);

  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads.csv`)).status, 400);
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads.csv?formId=${capturePage.id}`)).status, 400);
  const csv = await analyst.request(`/api/projects/${records.projectA.id}/leads.csv?sourceKind=page&sourceId=${capturePage.id}&captureId=${captureId}`);
  const csvText = Buffer.from(await csv.arrayBuffer()).toString('utf8');
  assert.equal(csv.status, 200, csvText);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(csv.headers.get('content-disposition'), /^attachment;/);
  assert.match(csvText, /^\uFEFFRecebida em,Formulário,Captura,E-mail antigo,legado\r\n/m);
  assert.match(csvText, /\r\n2026-09-05T11:00:00.000Z,Landing de captura,Diagnóstico,segunda@alva\.test/);
  assert.match(csvText, /'=1\+1/);
  assert.match(csvText, /'=captura/);
  await database.close();
});

test('a borda SaaS ignora identificadores de escopo enviados no corpo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database, { dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
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

  assert.equal((await alice.request('/api/forms', 'POST', { name: 'Formulário atual' })).status, 404);
  assert.equal((await alice.request('/api/forms')).status, 404);
  assert.equal((await alice.request(`/api/projects/${records.projectA.id}/forms`)).status, 404);
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

test('domínio do projeto não abre o painel nem o endereço do formulário antigo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'a.local.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id],
  );
  const app = await start(t, database);
  const domainApp = await start(t, database, { publicOrigin: 'https://studio.local' });
  assert.equal((await fetch(`${app.base}/f/alva-a/projeto-a/contato`)).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/f/contato', 'a.local.test')).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/public/forms/contato/submissions', 'a.local.test', {
    method: 'POST', body: { answers: { email: 'lead@alva.test' } },
  })).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/config', 'a.local.test')).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/setup', 'a.local.test', { method: 'POST', body: {} })).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/login', 'a.local.test', { method: 'POST', body: {} })).status, 403);
  await database.close();
});

test('integrações exigem capacidade própria e só exigem permissão quando seu valor muda', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const editor = (await database.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ('editor@alva.test', $1, 'Editora') RETURNING id`,
    [await legacyPassword(records.password)],
  )).rows[0];
  const membership = (await database.query(
    `INSERT INTO company_memberships (company_id, user_id, role, joined_at)
     VALUES ($1, $2, 'editor', now()) RETURNING id`, [records.companyA.id, editor.id],
  )).rows[0];
  await database.query(
    'INSERT INTO project_grants (company_id, membership_id, project_id) VALUES ($1, $2, $3)',
    [records.companyA.id, membership.id, records.projectA.id],
  );
  const app = await start(t, database);
  const alice = client(app.base);
  const editora = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  await editora.request('/api/login', 'POST', { email: 'editor@alva.test', password: records.password });
  assert.equal((await editora.request('/api/config')).status, 403);
  assert.equal((await editora.request('/api/settings')).status, 403);
  assert.equal((await editora.request('/api/settings/vercel', 'PUT', {})).status, 403);
  assert.equal((await editora.request('/api/settings/vercel/test', 'POST', {})).status, 403);

  const page = await (await alice.request('/api/pages', 'POST', { name: 'Página segura' })).json();
  assert.equal((await editora.request(`/api/pages/${page.id}/domain`, 'POST', {})).status, 403);
  assert.equal((await editora.request(`/api/pages/${page.id}/publish`, 'POST', { revision: page.revision })).status, 403);
  assert.equal((await editora.request(`/api/pages/${page.id}`, 'PUT', {
    revision: page.revision, project: {}, html: '', domain: 'editor.local.test',
  })).status, 403);
  assert.equal((await editora.request(`/api/pages/${page.id}`, 'PUT', {
    revision: page.revision, project: {}, html: '', webhook: 'https://example.test/hook',
  })).status, 403);

  const editorPage = await (await editora.request(`/api/pages/${page.id}`)).json();
  assert.equal((await editora.request(`/api/pages/${page.id}`, 'PUT', {
    revision: editorPage.revision, project: { pages: ['editada'] }, html: '<main>editada</main>',
    domain: editorPage.domain, webhook: editorPage.webhook,
  })).status, 200);
  const alicePage = await (await alice.request(`/api/pages/${page.id}`)).json();
  assert.equal((await alice.request(`/api/pages/${page.id}`, 'PUT', { revision: alicePage.revision, webhook: 'http://inseguro.test/hook' })).status, 400);
  await database.close();
});

test('overview de empresa reúne somente os projetos e contagens autorizados', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const content = new ContentRepository(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const page = await (await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Página publicada', route: '/publicada', editorState: {}, renderedHtml: '<main>Publicada</main>',
  })).json();
  const quiz = await (await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Quiz publicado', route: '/contato', kind: 'quiz', editorState: {}, renderedHtml: '<main>Quiz</main>',
  })).json();
  await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: page.id });
  const quizVersion = await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: quiz.id });
  await database.query(
    `INSERT INTO page_submissions (company_id, project_id, page_id, page_version_id, capture_id, answers)
     VALUES ($1, $2, $3, $4, gen_random_uuid(), '{"email":"lead@alva.test"}'::jsonb)`,
    [records.companyA.id, records.projectA.id, quiz.id, quizVersion.id],
  );
  const hiddenProject = await (await alice.request('/api/projects', 'POST', { name: 'Projeto restrito', slug: 'projeto-restrito' })).json();

  const ownerOverview = await alice.request(`/api/companies/${records.companyA.id}/overview`);
  assert.equal(ownerOverview.status, 200);
  const owner = await ownerOverview.json();
  assert.deepEqual(
    (({ id, name, slug, status }) => ({ id, name, slug, status }))(owner.company),
    { id: records.companyA.id, name: 'Alva A', slug: 'alva-a', status: 'active' },
  );
  assert.equal(typeof owner.company.createdAt, 'string');
  assert.equal(typeof owner.company.updatedAt, 'string');
  assert.equal(owner.role, 'owner');
  assertKeys(owner, ['company', 'role', 'counts', 'projects', 'members']);
  assertKeys(owner.company, ['id', 'name', 'slug', 'status', 'createdAt', 'updatedAt']);
  assert.deepEqual(owner.counts, { projects: 2, pages: 1, forms: 1, submissions: 1, members: 2 });
  assert.deepEqual(owner.projects.map(({ id, slug }) => ({ id, slug })), [
    { id: records.projectA.id, slug: 'projeto-a' },
    { id: hiddenProject.id, slug: 'projeto-restrito' },
  ]);
  assert.deepEqual(owner.members.map(({ email, role }) => ({ email, role })), [
    { email: 'alice@alva.test', role: 'owner' },
    { email: 'analista@alva.test', role: 'analyst' },
  ]);

  const editor = (await database.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ('editor-overview@alva.test', $1, 'Editora') RETURNING id`,
    [await legacyPassword(records.password)],
  )).rows[0];
  const editorMembership = (await database.query(
    `INSERT INTO company_memberships (company_id, user_id, role, joined_at)
     VALUES ($1, $2, 'editor', now()) RETURNING id`, [records.companyA.id, editor.id],
  )).rows[0];
  await database.query(
    'INSERT INTO project_grants (company_id, membership_id, project_id) VALUES ($1, $2, $3)',
    [records.companyA.id, editorMembership.id, records.projectA.id],
  );
  const editorClient = client(app.base);
  await editorClient.request('/api/login', 'POST', { email: 'editor-overview@alva.test', password: records.password });
  const editorOverview = await editorClient.request(`/api/companies/${records.companyA.id}/overview`);
  assert.equal(editorOverview.status, 200);
  const editorPayload = await editorOverview.json();
  assert.equal(editorPayload.role, 'editor');
  assert.deepEqual(editorPayload.counts, { projects: 1, pages: 1, forms: 1, submissions: 1, members: null });
  assert.deepEqual(editorPayload.projects.map((project) => project.id), [records.projectA.id]);
  assert.equal(editorPayload.members, null);

  assert.equal((await editorClient.request(`/api/companies/${records.companyB.id}/overview`)).status, 404);
  assert.equal((await editorClient.request(`/api/projects/${hiddenProject.id}/overview`)).status, 404);
  assert.equal((await alice.request(`/api/projects/${records.projectB.id}/overview`)).status, 404);
  await database.close();
});

test('overview de projeto expõe conteúdo real, domínio verificado e estados públicos de integração', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const content = new ContentRepository(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const publishedPage = await (await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Página publicada', route: '/publicada', editorState: {}, renderedHtml: '<main>Publicada</main>',
  })).json();
  const draftPage = await (await alice.request(`/api/projects/${records.projectA.id}/pages`, 'POST', {
    name: 'Página em rascunho', route: '/rascunho', editorState: {}, renderedHtml: '<main>Rascunho</main>',
  })).json();
  const publishedVersion = await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: publishedPage.id });
  await database.query(
    `INSERT INTO page_submissions (company_id, project_id, page_id, page_version_id, capture_id, answers)
     VALUES ($1, $2, $3, $4, gen_random_uuid(), '{"email":"lead@alva.test"}'::jsonb)`,
    [records.companyA.id, records.projectA.id, publishedPage.id, publishedVersion.id],
  );
  await database.query("UPDATE pages SET updated_at = now() - interval '3 minutes' WHERE id = $1", [publishedPage.id]);
  await database.query("UPDATE pages SET updated_at = now() - interval '2 minutes' WHERE id = $1", [draftPage.id]);
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'studio.alva.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id],
  );
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'pendente.alva.test', false, 'pending'),
            ($1, $2, 'preview', 'preview.alva.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id],
  );
  await database.query(
    `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration)
     VALUES ($1, $2, 'vercel', 'production', '{"connectionStatus":"configured","token":"não-expor"}'::jsonb),
            ($1, $2, 'analytics', 'production', '{}'::jsonb),
            ($1, $2, 'agents', 'production', '{"connectionStatus":"pending"}'::jsonb),
            ($1, $2, 'analytics', 'preview', '{"connectionStatus":"configured"}'::jsonb)`,
    [records.companyA.id, records.projectA.id],
  );
  await database.query(
    `INSERT INTO company_secrets (company_id, provider, secret_name, encrypted_value)
     VALUES ($1, 'vercel', 'token', 'segredo-nunca-exposto')`,
    [records.companyA.id],
  );

  const response = await alice.request(`/api/projects/${records.projectA.id}/overview`);
  assert.equal(response.status, 200);
  let overview = await response.json();
  assert.equal(overview.project.id, records.projectA.id);
  assert.deepEqual(overview.counts, { pages: 2, forms: 0, publishedPages: 1, publishedForms: 0, submissions: 1 });
  assert.deepEqual(overview.content.map(({ id, kind, name, route, published, submissionCount }) => ({ id, kind, name, route, published, submissionCount })), [
    { id: draftPage.id, kind: 'page', name: 'Página em rascunho', route: '/rascunho', published: false, submissionCount: 0 },
    { id: publishedPage.id, kind: 'page', name: 'Página publicada', route: '/publicada', published: true, submissionCount: 1 },
  ]);
  assert.ok(overview.content.every((item) => typeof item.updatedAt === 'string'));
  assert.deepEqual(overview.domain, { domain: 'studio.alva.test', verificationStatus: 'verified' });
  assert.deepEqual(overview.integrations, { vercel: 'configured', analytics: 'configured', agents: 'pending' });

  await database.query(
    `UPDATE project_integrations
     SET configuration = '{"connectionStatus":"configured","requiresReconnect":true}'::jsonb
     WHERE company_id = $1 AND project_id = $2 AND provider = 'agents' AND environment = 'production'`,
    [records.companyA.id, records.projectA.id],
  );
  const reconnectOverview = await alice.request(`/api/projects/${records.projectA.id}/overview`);
  assert.equal(reconnectOverview.status, 200);
  assert.equal((await reconnectOverview.json()).integrations.agents, 'pending');

  await database.query(
    `UPDATE project_integrations
     SET configuration = '{"connectionStatus":"configured"}'::jsonb
     WHERE company_id = $1 AND project_id = $2 AND provider IN ('analytics', 'agents') AND environment = 'production'`,
    [records.companyA.id, records.projectA.id],
  );
  const configuredOverview = await alice.request(`/api/projects/${records.projectA.id}/overview`);
  assert.equal(configuredOverview.status, 200);
  overview = await configuredOverview.json();
  assert.deepEqual(overview.integrations, { vercel: 'configured', analytics: 'configured', agents: 'configured' });
  assert.deepEqual(overview.runtime, {
    analytics: true,
    conversions: false,
    pixels: true,
    media: false,
    billing: false,
  });
  assertKeys(overview, ['project', 'counts', 'content', 'domain', 'integrations', 'runtime']);
  assertKeys(overview.project, ['id', 'companyId', 'name', 'slug', 'status', 'createdBy', 'createdAt', 'updatedAt']);
  assertKeys(overview.counts, ['pages', 'forms', 'publishedPages', 'publishedForms', 'submissions']);
  assert.ok(overview.content.every((item) => {
    assertKeys(item, ['id', 'kind', 'name', 'route', 'published', 'updatedAt', 'submissionCount']);
    return true;
  }));
  assertKeys(overview.domain, ['domain', 'verificationStatus']);
  assertKeys(overview.integrations, ['vercel', 'analytics', 'agents']);
  assertKeys(overview.runtime, ['analytics', 'conversions', 'pixels', 'media', 'billing']);
  assert.equal(JSON.stringify(overview).includes('configuration'), false);
  assert.equal(JSON.stringify(overview).includes('não-expor'), false);
  assert.equal(JSON.stringify(overview).includes('segredo-nunca-exposto'), false);
  assert.equal(JSON.stringify(overview).includes('lead@alva.test'), false);

  const empty = await (await alice.request('/api/projects', 'POST', { name: 'Projeto vazio', slug: 'projeto-vazio' })).json();
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'pendente-vazio.alva.test', true, 'pending'),
            ($1, $2, 'preview', 'preview-vazio.alva.test', true, 'verified')`,
    [records.companyA.id, empty.id],
  );
  await database.query(
    `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration)
     VALUES ($1, $2, 'vercel', 'preview', '{"connectionStatus":"configured"}'::jsonb)`,
    [records.companyA.id, empty.id],
  );
  const emptyOverview = await alice.request(`/api/projects/${empty.id}/overview`);
  assert.equal(emptyOverview.status, 200);
  const emptyPayload = await emptyOverview.json();
  assert.deepEqual(emptyPayload.counts, { pages: 0, forms: 0, publishedPages: 0, publishedForms: 0, submissions: 0 });
  assert.equal(emptyPayload.domain, null);
  assert.deepEqual(emptyPayload.integrations, { vercel: 'pending', analytics: 'configured', agents: 'pending' });
  await database.close();
});

test('overview remove VSLs do DTO quando mídia está desligada e preserva com mídia ligada', () => {
  const input = { counts: { pages: 1, videos: 2, publishedVideos: 1 }, content: [{ id: 'v1', kind: 'video', name: 'VSL secreta' }, { id: 'p1', kind: 'page', name: 'Página' }] };
  const disabled = overviewForRuntime(input, { mediaPipeline: false });
  assert.equal(disabled.counts.videos, undefined);
  assert.equal(disabled.counts.publishedVideos, undefined);
  assert.deepEqual(disabled.content, [{ id: 'p1', kind: 'page', name: 'Página' }]);
  const enabled = overviewForRuntime(input, { mediaPipeline: true });
  assert.deepEqual(enabled.counts, input.counts);
  assert.deepEqual(enabled.content, input.content);
});


test('coletor público ingere evento de origem publicada, recusa origem não publicada e não revela se o tracker existe', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  await database.query(
    "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id) VALUES ($1, $2, 'trk-collect-a') ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id",
    [records.companyA.id, records.projectA.id],
  );
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'painel.alva-a.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id],
  );

  const send = (origin, body) => fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });

  const ok = await send('https://painel.alva-a.test', { trackerPublicId: 'trk-collect-a', event_name: 'pageview', url_path: '/oferta' });
  assert.equal(ok.status, 204, await ok.text());
  assert.equal(await ok.text(), '');

  const eventRow = await database.query(
    'SELECT event_type, url_path FROM analytics_events WHERE company_id = $1 AND project_id = $2',
    [records.companyA.id, records.projectA.id],
  );
  assert.equal(eventRow.rowCount, 1);
  assert.equal(eventRow.rows[0].event_type, 'pageview');
  assert.equal(eventRow.rows[0].url_path, '/oferta');

  const formStep = await send('https://painel.alva-a.test', {
    trackerPublicId: 'trk-collect-a', event_name: 'form_step', url_path: '/oferta',
    event_data: { formId: 'form_123', screenId: 'qualificacao', stepIndex: 2 },
  });
  assert.equal(formStep.status, 204, await formStep.text());
  const eventData = await database.query(
    "SELECT data_key, data_value FROM analytics_event_data WHERE company_id = $1 ORDER BY data_key",
    [records.companyA.id],
  );
  assert.deepEqual(eventData.rows, [
    { data_key: 'form_id', data_value: 'form_123' },
    { data_key: 'screen_id', data_value: 'qualificacao' },
    { data_key: 'step_index', data_value: '2' },
  ]);

  const forbidden = await send('https://attacker.example.test', { trackerPublicId: 'trk-collect-a', event_name: 'pageview' });
  assert.equal(forbidden.status, 403, await forbidden.text());

  const missing = await send('https://painel.alva-a.test', { trackerPublicId: 'trk-inexistente', event_name: 'pageview' });
  assert.equal(missing.status, 403, await missing.text());
  await database.close();
});

test('OPTIONS do coletor responde 204 sem refletir origem arbitrária', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  await seed(database);
  const app = await start(t, database);
  const response = await fetch(`${app.base}/api/public/collect`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://qualquer-origem.example.test', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'preflight sem tracker não pode refletir origem arbitrária');
  await database.close();
});

test('coletor recusa corpo de mais de 64 KB com 413', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  await database.query(
    "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id) VALUES ($1, $2, 'trk-collect-grande') ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id",
    [records.companyA.id, records.projectA.id],
  );
  const bigBody = JSON.stringify({ trackerPublicId: 'trk-collect-grande', event_name: 'pageview', url_path: 'a'.repeat(70 * 1024) });
  const response = await fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bigBody,
  });
  assert.equal(response.status, 413, await response.text());
  await database.close();
});

test('laço de retenção do analytics remove eventos expirados via runOnce e pode ser parado ao fechar o servidor', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const website = (await database.query(
    "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id) VALUES ($1, $2, 'trk-retencao') ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id RETURNING id",
    [records.companyA.id, records.projectA.id],
  )).rows[0];
  await database.query(
    "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path) VALUES ($1, $2, $3, now() - interval '91 days', 'pageview', '/')",
    [records.companyA.id, records.projectA.id, website.id],
  );

  assert.ok(app.server.analyticsRetention, 'servidor deveria expor o laço de retenção, como webhookWorker');
  await app.server.analyticsRetention.runOnce();
  const remaining = await database.query('SELECT count(*)::int AS count FROM analytics_events WHERE company_id = $1', [records.companyA.id]);
  assert.equal(remaining.rows[0].count, 0);

  await new Promise((resolve) => app.server.close(resolve));
  assert.doesNotThrow(() => app.server.analyticsRetention.stop());
  await database.close();
});

test('CSP da VSL pública inclui a origem do próprio Studio em connect-src', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database, { runtimeFlags: { mediaPipeline: true } });
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const created = await alice.request(`/api/projects/${records.projectA.id}/videos`, 'POST', {
    name: 'VSL pública', sourceUrl: 'https://cdn.example.test/video.mp4',
  });
  const video = await created.json();
  assert.equal(created.status, 201, JSON.stringify(video));
  const published = await alice.request(`/api/projects/${records.projectA.id}/videos/${video.id}/publish`, 'POST', { lockVersion: video.lockVersion });
  const publicVideo = await published.json();
  assert.equal(published.status, 201, JSON.stringify(publicVideo));

  const response = await fetch(`${app.base}/v/${publicVideo.publicId}`);
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  const connectSrc = csp.split('; ').find((directive) => directive.startsWith('connect-src'));
  assert.match(connectSrc, new RegExp(app.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await database.close();
});

test('resumo de analytics do projeto responde 200 agora que o repositório está conectado ao createProjectApi', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const from = encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString());
  const to = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
  const response = await alice.request(`/api/projects/${records.projectA.id}/analytics/summary?from=${from}&to=${to}`);
  const summary = await response.json();
  assert.equal(response.status, 200, JSON.stringify(summary));
  assert.equal(typeof summary.totalEvents, 'number');
  await database.close();
});

test('validação de escala rejeita valores não finitos', () => {
  const schema = { steps: [{ id: 'avaliacao', type: 'scale', title: 'Avaliação', required: true, range: { min: 1, max: 5 } }] };
  assert.throws(() => validateFormAnswers(schema, { answers: { avaliacao: 'Infinity' } }), /escala/);
  assert.throws(() => validateFormAnswers(schema, { answers: { avaliacao: 'NaN' } }), /escala/);
  assert.deepEqual(validateFormAnswers(schema, { answers: { avaliacao: '3' } }), { avaliacao: '3' });
});

// Anexar imagem do computador no editor de landing: vai ao banco, volta num endereço
// público do Studio, e só aceita imagem de verdade.
test('imagem anexada no editor: enviada, servida pública e só de quem escreve no projeto', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  // O menor PNG válido: 1×1 transparente.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const enviada = await alice.request(`/api/projects/${records.projectA.id}/images`, 'POST', { dados: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(enviada.status, 201, await enviada.clone().text());
  const { url, tipo } = await enviada.json();
  assert.equal(tipo, 'image/png');
  const caminho = new URL(url, app.base).pathname;
  assert.match(caminho, /^\/i\/[0-9a-f-]{36}$/);
  // Pública: a página publicada, em outro domínio, carrega sem sessão.
  const servida = await fetch(app.base + caminho);
  assert.equal(servida.status, 200);
  assert.equal(servida.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await servida.arrayBuffer()), png);

  const svg = await alice.request(`/api/projects/${records.projectA.id}/images`, 'POST', { dados: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') });
  assert.equal(svg.status, 400, 'SVG pode carregar script e não é aceito');
  const deOutroProjeto = await alice.request(`/api/projects/${records.projectB.id}/images`, 'POST', { dados: png.toString('base64') });
  assert.ok([403, 404].includes(deOutroProjeto.status), `projeto de outra empresa: ${deOutroProjeto.status}`);
  await database.close();
});
