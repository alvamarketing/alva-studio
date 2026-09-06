import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.mjs';
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
  const { publicOrigin, authOptions, sessionOptions = {}, dnsLookup, webhookFetch } = options;
  const server = createApp({
    database,
    publicOrigin,
    authOptions,
    dnsLookup,
    webhookFetch,
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

test('leads do projeto paginam, isolam formulários e exportam CSV', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const content = new ContentRepository(database);
  const schema = {
    headerElements: [],
    steps: [{ id: 'dados', elements: [
      { id: 'nome', type: 'short_text', title: 'Nome', required: true },
      { id: 'email', type: 'email', title: 'E-mail', required: true },
    ] }],
    completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' }, webhook: '',
  };
  const form = await content.createForm({
    companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id,
    name: 'Contato', route: '/contato', draftSchema: schema,
  });
  const published = await content.publishForm({
    companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, formId: form.id, lockVersion: 0,
  });
  const otherForm = await content.createForm({
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.alice.id,
    name: 'Outro projeto', route: '/outro', draftSchema: schema,
  });
  await content.publishForm({
    companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.alice.id, formId: otherForm.id, lockVersion: 0,
  });
  await database.query(
    `INSERT INTO form_submissions (id, company_id, project_id, form_id, form_version_id, answers, submitted_at)
     VALUES
       ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, $5::jsonb, '2026-09-05T10:00:00.000Z'),
       ('00000000-0000-4000-8000-000000000002', $1, $2, $3, $4, $6::jsonb, '2026-09-05T11:00:00.000Z')`,
    [records.companyA.id, records.projectA.id, form.id, published.id,
      JSON.stringify({ nome: 'Primeira', email: 'primeira@alva.test', legado: '=1+1' }),
      JSON.stringify({ nome: 'Segunda', email: 'segunda@alva.test' })],
  );
  const app = await start(t, database);
  const analyst = client(app.base);
  const alice = client(app.base);
  await analyst.request('/api/login', 'POST', { email: 'analista@alva.test', password: records.password });
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const first = await analyst.request(`/api/projects/${records.projectA.id}/leads?limit=1`);
  const firstText = await first.text();
  assert.equal(first.status, 200, firstText);
  const page = JSON.parse(firstText);
  assert.deepEqual(page.items.map((item) => ({ formId: item.formId, formName: item.formName, answers: item.answers, webhookStatus: item.webhookStatus })), [{
    formId: form.id, formName: 'Contato', answers: { nome: 'Segunda', email: 'segunda@alva.test' }, webhookStatus: 'pending',
  }]);
  assert.equal(page.items[0].submittedAt, '2026-09-05T11:00:00.000Z');
  assert.match(page.nextCursor, /^[A-Za-z0-9_-]+$/);
  const second = await analyst.request(`/api/projects/${records.projectA.id}/leads?cursor=${encodeURIComponent(page.nextCursor)}&limit=100`);
  const secondText = await second.text();
  assert.equal(second.status, 200, secondText);
  assert.deepEqual(JSON.parse(secondText).items.map((item) => item.answers.nome), ['Primeira']);
  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads?cursor=invalido`)).status, 400);
  assert.equal((await alice.request(`/api/projects/${records.projectA.id}/leads?formId=${otherForm.id}`)).status, 404);

  assert.equal((await analyst.request(`/api/projects/${records.projectA.id}/leads.csv`)).status, 400);
  const csv = await analyst.request(`/api/projects/${records.projectA.id}/leads.csv?formId=${form.id}`);
  const csvText = Buffer.from(await csv.arrayBuffer()).toString('utf8');
  assert.equal(csv.status, 200, csvText);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(csv.headers.get('content-disposition'), /^attachment;/);
  assert.match(csvText, /^\uFEFFRecebida em,Formulário,Nome,E-mail,legado\r\n/m);
  assert.match(csvText, /\r\n2026-09-05T11:00:00.000Z,Contato,Segunda/);
  assert.match(await (await analyst.request(`/api/projects/${records.projectA.id}/leads.csv?formId=${form.id}`)).text(), /'=1\+1/);
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
  const formCreated = await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
    name: 'Formulário protegido', route: '/formulario-protegido', draftSchema: {
      headerElements: [],
      steps: [{ id: 'nome', type: 'short_text', title: 'Nome', required: true }],
      completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
      webhook: '',
    },
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

test('formulário SaaS mantém rascunho, publica explicitamente em rota pública isolada e persiste respostas', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const deliveryPayloads = [];
  let failDelivery = false;
  const app = await start(t, database, {
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    webhookFetch: async (_url, options) => {
      deliveryPayloads.push(JSON.parse(options.body));
      return { ok: !failDelivery };
    },
  });
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
  assert.equal(form.publishedVersionId, null, 'salvar no editor não publica o rascunho');
  const draftPublic = await fetch(`${app.base}${form.publicPath}`);
  assert.equal(draftPublic.status, 404, await draftPublic.text());
  const published = await alice.request(`/api/forms/${form.id}/publish`, 'POST', { revision: form.revision });
  assert.equal(published.status, 201);
  form = await published.json();
  assert.ok(form.publishedVersionId);
  const publicPage = await fetch(`${app.base}${form.publicPath}`);
  const publicHtml = await publicPage.text();
  assert.equal(publicPage.status, 200, publicHtml);
  assert.equal((await fetch(`${app.base}/f/${form.slug}`)).status, 404);
  assert.match(publicHtml, new RegExp(form.publicPath.replace('/f/', '/api/public/forms/') + '/submissions'));
  const submitted = await fetch(`${app.base}${form.publicPath.replace('/f/', '/api/public/forms/')}/submissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { email: 'lead@alva.test' } }),
  });
  const completionHtml = await submitted.text();
  assert.equal(submitted.status, 200, completionHtml);
  assert.match(completionHtml, /Recebemos/);
  assert.equal(submitted.headers.get('x-webhook-delivery'), 'queued', 'a resposta ao visitante não pode esperar a entrega do webhook');
  assert.equal(deliveryPayloads.length, 0, 'a entrega é processada pelo worker, não durante a submissão');
  const lead = await database.query(
    `SELECT event.event_name, event.tracking_event_id, data.data_value AS form_id
       FROM analytics_events event
       JOIN analytics_event_data data ON data.event_id = event.id AND data.company_id = event.company_id AND data.project_id = event.project_id
      WHERE event.company_id = $1 AND event.project_id = $2 AND event.event_name = 'lead'`,
    [records.companyA.id, records.projectA.id],
  );
  const submissionTracking = await database.query('SELECT tracking_event_id FROM form_submissions WHERE form_id = $1', [form.id]);
  assert.deepEqual(lead.rows, [{ event_name: 'lead', tracking_event_id: submissionTracking.rows[0].tracking_event_id, form_id: form.id }]);
  const queuedCount = await database.query("SELECT count(*)::int AS count FROM webhook_deliveries WHERE status = 'pending'");
  assert.equal(queuedCount.rows[0].count, 1);

  await app.server.webhookWorker.runOnce();
  assert.equal(deliveryPayloads.length, 1);
  assert.equal(deliveryPayloads[0].event, 'form.submitted');
  assert.equal(deliveryPayloads[0].companyId, records.companyA.id);
  assert.equal(deliveryPayloads[0].projectId, records.projectA.id);
  assert.equal(deliveryPayloads[0].formId, form.id);
  assert.deepEqual(deliveryPayloads[0].answers, { email: 'lead@alva.test' });
  assert.match(deliveryPayloads[0].eventId, /^[0-9a-f-]{36}$/);
  assert.equal((await fetch(`${app.base}${form.publicPath.replace('/f/', '/api/public/forms/')}/submissions`, {
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
  const deliveredRow = await database.query(
    "SELECT status, attempt_count FROM webhook_deliveries WHERE company_id = $1 AND project_id = $2 AND submission_id = (SELECT id FROM form_submissions WHERE form_id = $3 AND answers->>'email' = 'lead@alva.test')",
    [records.companyA.id, records.projectA.id, form.id],
  );
  assert.equal(deliveredRow.rows[0].status, 'delivered');
  assert.equal(deliveredRow.rows[0].attempt_count, 0, 'sucesso na primeira tentativa não incrementa o contador de retries');
  const attemptAudit = await database.query('SELECT outcome, attempt_number FROM webhook_delivery_attempts');
  assert.deepEqual(attemptAudit.rows, [{ outcome: 'delivered', attempt_number: 1 }]);

  failDelivery = true;
  const failed = await fetch(`${app.base}${form.publicPath.replace('/f/', '/api/public/forms/')}/submissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: { email: 'falhou@alva.test' } }),
  });
  const failedHtml = await failed.text();
  assert.equal(failed.status, 200, failedHtml);
  assert.match(failedHtml, /Recebemos/);
  assert.equal(failed.headers.get('x-webhook-delivery'), 'queued');
  await app.server.webhookWorker.runOnce();
  const failedRow = await database.query(
    "SELECT status, attempt_count, next_attempt_at > now() AS reagendada FROM webhook_deliveries WHERE submission_id = (SELECT id FROM form_submissions WHERE form_id = $1 AND answers->>'email' = 'falhou@alva.test')",
    [form.id],
  );
  assert.equal(failedRow.rows[0].status, 'pending', 'uma falha antes de esgotar as tentativas volta para a fila, não fica travada como falha definitiva');
  assert.equal(failedRow.rows[0].attempt_count, 1);
  assert.equal(failedRow.rows[0].reagendada, true);
  const secondAttemptWithoutDue = await app.server.webhookWorker.runOnce();
  assert.equal(secondAttemptWithoutDue.processed, 0, 'não reivindica de novo antes do horário de retry agendado');
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

test('formulários SaaS validam o schema antes de criar, atualizar e publicar', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  for (const draftSchema of [{}, { headerElements: [], completion: {}, webhook: '' }, { steps: 'inválidas' }]) {
    const rejected = await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
      name: 'Schema inválido', route: '/schema-invalido', draftSchema,
    });
    assert.equal(rejected.status, 400, await rejected.text());
  }
  assert.equal((await database.query('SELECT count(*)::int AS count FROM forms')).rows[0].count, 0);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM project_routes WHERE content_type = 'form'")).rows[0].count, 0);

  const richSchema = {
    headerElements: [
      { id: 'marca', type: 'logo', title: 'Alva', mediaUrl: 'https://example.test/logo.svg', altText: 'Alva', width: 144 },
      { id: 'progresso', type: 'progress', title: 'Progresso', showValue: true },
    ],
    steps: [{
      id: 'inicio', title: 'Comece', motion: 'zoom-in', autoAdvance: false, timer: 0,
      elements: [
        { id: 'contexto', type: 'statement', title: 'Conte sobre você', description: 'Leva menos de um minuto.' },
        { id: 'email', type: 'email', title: 'Seu e-mail', required: true, placeholder: 'voce@empresa.com' },
        { id: 'perfil', type: 'image_choice', title: 'Seu perfil', required: true, options: [
          { label: 'Empresa', imageUrl: 'https://example.test/empresa.jpg', icon: 'business' },
          { label: 'Profissional', imageUrl: '', icon: 'person' },
        ] },
      ],
    }],
    completion: { title: 'Recebemos', message: 'Entraremos em contato.' },
    webhook: '',
  };
  const createdResponse = await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
    name: 'Schema rico', route: '/schema-rico', draftSchema: richSchema,
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.draftSchema.steps[0].elements[2].options[0].label, 'Empresa');

  const invalidUpdate = await alice.request(`/api/forms/${created.id}`, 'PUT', {
    revision: created.lockVersion,
    draftSchema: { steps: 'não-é-lista' },
  });
  assert.equal(invalidUpdate.status, 400, await invalidUpdate.text());
  const afterInvalidUpdate = (await database.query(
    'SELECT draft_schema, lock_version FROM forms WHERE id = $1', [created.id],
  )).rows[0];
  assert.deepEqual(afterInvalidUpdate.draft_schema, created.draftSchema);
  assert.equal(afterInvalidUpdate.lock_version, created.lockVersion);

  for (const draftSchema of [null, 'não é objeto', []]) {
    const current = await (await alice.request(`/api/forms/${created.id}`)).json();
    const rejected = await alice.request(`/api/forms/${created.id}`, 'PUT', {
      revision: current.revision,
      draftSchema,
    });
    assert.equal(rejected.status, 400, `draftSchema ${JSON.stringify(draftSchema)}: ${await rejected.text()}`);
  }

  await database.query("UPDATE forms SET draft_schema = '{}'::jsonb WHERE id = $1", [created.id]);
  const invalidPublish = await alice.request(`/api/forms/${created.id}/publish`, 'POST', { revision: created.lockVersion });
  assert.equal(invalidPublish.status, 400, await invalidPublish.text());
  assert.equal((await database.query('SELECT count(*)::int AS count FROM form_versions WHERE form_id = $1', [created.id])).rows[0].count, 0);
  assert.equal((await database.query('SELECT published_version_id FROM forms WHERE id = $1', [created.id])).rows[0].published_version_id, null);

  await database.query('UPDATE forms SET draft_schema = $2::jsonb WHERE id = $1', [created.id, JSON.stringify(richSchema)]);
  const published = await alice.request(`/api/forms/${created.id}/publish`, 'POST', { revision: created.lockVersion });
  assert.equal(published.status, 201);
  const publicPage = await fetch(`${app.base}${(await published.json()).publicPath}`);
  const publicHtml = await publicPage.text();
  assert.equal(publicPage.status, 200, publicHtml);
  assert.match(publicHtml, /Conte sobre você/);
  await database.close();
});

test('rotas públicas de formulário aceitam raiz, um caractere e múltiplos segmentos em GET e POST', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });

  const cases = [
    { route: '/', publicPath: '/f/alva-a/projeto-a/', submissionPath: '/api/public/forms/alva-a/projeto-a/submissions' },
    { route: '/a', publicPath: '/f/alva-a/projeto-a/a', submissionPath: '/api/public/forms/alva-a/projeto-a/a/submissions' },
    { route: '/x/y', publicPath: '/f/alva-a/projeto-a/x/y', submissionPath: '/api/public/forms/alva-a/projeto-a/x/y/submissions' },
  ];
  for (const [index, item] of cases.entries()) {
    const created = await (await alice.request('/api/forms', 'POST', {
      name: `Rota ${index}`, route: item.route,
    })).json();
    const draft = await (await alice.request(`/api/forms/${created.id}`, 'PUT', {
      revision: created.revision,
      steps: [{ id: `email-${index}`, type: 'email', title: 'E-mail', required: true }],
    })).json();
    const response = await alice.request(`/api/forms/${created.id}/publish`, 'POST', { revision: draft.revision });
    assert.equal(response.status, 201);
    const published = await response.json();
    assert.equal(published.publicPath, item.publicPath);
    const page = await fetch(app.base + item.publicPath);
    const pageHtml = await page.text();
    assert.equal(page.status, 200, pageHtml);
    assert.match(pageHtml, new RegExp(item.submissionPath.replaceAll('/', '\\/')));
    const submitted = await fetch(app.base + item.submissionPath, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { [`email-${index}`]: `lead-${index}@alva.test` } }),
    });
    assert.equal(submitted.status, 200, await submitted.text());
  }
  assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions')).rows[0].count, 3);
  await database.close();
});

test('aliases sem a fronteira do prefixo público não recebem isenção de origem', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  await database.query("UPDATE companies SET slug = 'empresa' WHERE id = $1", [records.companyA.id]);
  await database.query("UPDATE projects SET slug = 'projeto' WHERE id = $1", [records.projectA.id]);

  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const created = await (await alice.request('/api/forms', 'POST', { name: 'Contato', slug: 'contato' })).json();
  const draft = await (await alice.request(`/api/forms/${created.id}`, 'PUT', {
    revision: created.revision,
    steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }],
  })).json();
  assert.equal((await alice.request(`/api/forms/${created.id}/publish`, 'POST', { revision: draft.revision })).status, 201);

  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'formularios.local.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id],
  );
  const domainApp = await start(t, database, { publicOrigin: 'https://studio.local' });
  const externalOrigin = 'https://externo.test';
  const [projectAlias, domainAlias] = await Promise.all([
    fetch(`${app.base}/api/public/formsempresa/projeto/contato/submissions`, {
      method: 'POST',
      headers: { Origin: externalOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { email: 'namespace@alva.test' } }),
    }),
    publicRequest(domainApp.base, '/api/public/formscontato/submissions', 'formularios.local.test', {
      method: 'POST',
      headers: { Origin: externalOrigin },
      body: { answers: { email: 'dominio@alva.test' } },
    }),
  ]);

  assert.deepEqual([projectAlias.status, domainAlias.status], [403, 403]);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions')).rows[0].count, 0);
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

test('rotas públicas não colidem entre projetos e domínio resolve o projeto conectado', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database, { dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  await database.query("UPDATE projects SET slug = 'projeto-compartilhado' WHERE id = $1", [records.projectB.id]);

  const createPublished = async (name) => {
    const created = await (await alice.request('/api/forms', 'POST', { name, slug: 'contato' })).json();
    const draft = await (await alice.request(`/api/forms/${created.id}`, 'PUT', {
      revision: created.revision,
      steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }],
    })).json();
    const published = await alice.request(`/api/forms/${created.id}/publish`, 'POST', { revision: draft.revision });
    assert.equal(published.status, 201);
    return published.json();
  };

  const formA = await createPublished('Contato A');
  await alice.request('/api/session', 'PATCH', { companyId: records.companyB.id, projectId: records.projectB.id });
  const formB = await createPublished('Contato B');
  assert.equal(formA.publicPath, '/f/alva-a/projeto-a/contato');
  assert.equal(formB.publicPath, '/f/alva-b/projeto-compartilhado/contato');
  assert.equal((await fetch(`${app.base}${formA.publicPath}`)).status, 200);
  const bPage = await fetch(`${app.base}${formB.publicPath}`);
  assert.equal(bPage.status, 200);
  assert.match(await bPage.text(), /Contato B/);
  assert.equal((await fetch(`${app.base}/f/contato`)).status, 404);

  const domainApp = await start(t, database, { publicOrigin: 'https://studio.local' });
  const rejectedDomains = [
    { domain: 'nao-canonico.local.test', environment: 'production', canonical: false, verification: 'verified' },
    { domain: 'pendente.local.test', environment: 'production', canonical: true, verification: 'pending' },
    { domain: 'preview.local.test', environment: 'preview', canonical: true, verification: 'verified' },
  ];
  for (const candidate of rejectedDomains) {
    await database.query(
      `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [records.companyA.id, records.projectA.id, candidate.environment, candidate.domain, candidate.canonical, candidate.verification],
    );
    assert.equal((await publicRequest(domainApp.base, '/f/contato', candidate.domain)).status, 404);
    await database.query('DELETE FROM project_domains WHERE domain = $1', [candidate.domain]);
  }

  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', 'a.local.test', true, 'verified'),
            ($3, $4, 'production', 'b.local.test', true, 'verified')`,
    [records.companyA.id, records.projectA.id, records.companyB.id, records.projectB.id],
  );
  const domainPage = await publicRequest(domainApp.base, '/f/contato', 'a.local.test');
  assert.equal(domainPage.status, 200);
  assert.match(domainPage.text, /Contato A/);
  const secondDomainPage = await publicRequest(domainApp.base, '/f/contato', 'b.local.test');
  assert.equal(secondDomainPage.status, 200);
  assert.match(secondDomainPage.text, /Contato B/);
  const publicSubmission = await publicRequest(domainApp.base, '/api/public/forms/contato/submissions', 'b.local.test', {
    method: 'POST', body: { answers: { email: 'lead@empresa-b.test' } },
  });
  assert.equal(publicSubmission.status, 200);
  assert.equal((await publicRequest(domainApp.base, '/f/contato', 'desconhecido.local.test')).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/api/public/forms/contato/submissions', 'desconhecido.local.test', {
    method: 'POST', body: { answers: { email: 'lead@desconhecido.test' } },
  })).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/api/config', 'a.local.test')).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/setup', 'a.local.test', { method: 'POST', body: {} })).status, 403);
  assert.equal((await publicRequest(domainApp.base, '/api/login', 'a.local.test', { method: 'POST', body: {} })).status, 403);

  await database.query("UPDATE projects SET status = 'archived' WHERE id = $1", [records.projectB.id]);
  assert.equal((await fetch(`${app.base}${formB.publicPath}`)).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/f/contato', 'b.local.test')).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/api/public/forms/contato/submissions', 'b.local.test', {
    method: 'POST', body: { answers: { email: 'lead@arquivado.test' } },
  })).status, 404);

  await database.query("UPDATE companies SET status = 'archived' WHERE id = $1", [records.companyA.id]);
  assert.equal((await fetch(`${app.base}${formA.publicPath}`)).status, 404);
  assert.equal((await publicRequest(domainApp.base, '/f/contato', 'a.local.test')).status, 404);
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

  const form = await (await alice.request('/api/forms', 'POST', { name: 'Contato seguro' })).json();
  const page = await (await alice.request('/api/pages', 'POST', { name: 'Página segura' })).json();
  assert.equal((await editora.request(`/api/pages/${page.id}/domain`, 'POST', {})).status, 403);
  const savedDraft = await editora.request(`/api/forms/${form.id}`, 'PUT', {
    revision: form.revision, name: 'Contato salvo pela editora', steps: [{ id: 'nome', type: 'short_text', title: 'Nome', required: true }],
  });
  assert.equal(savedDraft.status, 200);
  assert.equal((await savedDraft.json()).publishedVersionId, null);
  assert.equal((await editora.request(`/api/forms/${form.id}/publish`, 'POST', { revision: 1 })).status, 403);
  assert.equal((await editora.request('/api/forms', 'POST', { name: 'Webhook proibido', draftSchema: { webhook: 'https://example.test/hook' } })).status, 403);
  assert.equal((await editora.request(`/api/forms/${form.id}`, 'PUT', { revision: 1, webhook: 'https://example.test/hook' })).status, 403);
  assert.equal((await editora.request(`/api/pages/${page.id}`, 'PUT', {
    revision: page.revision, project: {}, html: '', domain: 'editor.local.test',
  })).status, 403);

  const editorForm = await (await editora.request(`/api/forms/${form.id}`)).json();
  assert.equal((await editora.request(`/api/forms/${form.id}`, 'PUT', {
    revision: editorForm.revision, name: 'Conteúdo real da editora', headerElements: editorForm.headerElements,
    steps: editorForm.steps, completion: editorForm.completion, webhook: editorForm.webhook,
  })).status, 200);
  const editorPage = await (await editora.request(`/api/pages/${page.id}`)).json();
  assert.equal((await editora.request(`/api/pages/${page.id}`, 'PUT', {
    revision: editorPage.revision, project: { pages: ['editada'] }, html: '<main>editada</main>',
    domain: editorPage.domain, webhook: editorPage.webhook,
  })).status, 200);
  assert.equal((await alice.request(`/api/forms/${form.id}`, 'PUT', { revision: 2, webhook: 'http://inseguro.test/hook' })).status, 400);
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
  const form = await (await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
    name: 'Formulário publicado', route: '/contato', draftSchema: {
      headerElements: [],
      steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }],
      completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
      webhook: '',
    },
  })).json();
  await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: page.id });
  await content.publishForm({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, formId: form.id });
  await content.submitPublicFormForProject({
    companySlug: 'alva-a', projectSlug: 'projeto-a', route: '/contato', input: { answers: { email: 'lead@alva.test' } },
  });
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
  const form = await (await alice.request(`/api/projects/${records.projectA.id}/forms`, 'POST', {
    name: 'Contato publicado', route: '/contato', draftSchema: {
      headerElements: [],
      steps: [{ id: 'email', type: 'email', title: 'E-mail', required: true }],
      completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
      webhook: '',
    },
  })).json();
  await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, pageId: publishedPage.id });
  await content.publishForm({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.alice.id, formId: form.id });
  await content.submitPublicFormForProject({
    companySlug: 'alva-a', projectSlug: 'projeto-a', route: '/contato', input: { answers: { email: 'lead@alva.test' } },
  });
  await database.query("UPDATE pages SET updated_at = now() - interval '3 minutes' WHERE id = $1", [publishedPage.id]);
  await database.query("UPDATE pages SET updated_at = now() - interval '2 minutes' WHERE id = $1", [draftPage.id]);
  await database.query("UPDATE forms SET updated_at = now() - interval '1 minute' WHERE id = $1", [form.id]);
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
  assert.deepEqual(overview.counts, { pages: 2, forms: 1, publishedPages: 1, publishedForms: 1, submissions: 1 });
  assert.deepEqual(overview.content.map(({ id, kind, name, route, published, submissionCount }) => ({ id, kind, name, route, published, submissionCount })), [
    { id: form.id, kind: 'form', name: 'Contato publicado', route: '/contato', published: true, submissionCount: 1 },
    { id: draftPage.id, kind: 'page', name: 'Página em rascunho', route: '/rascunho', published: false, submissionCount: 0 },
    { id: publishedPage.id, kind: 'page', name: 'Página publicada', route: '/publicada', published: true, submissionCount: 0 },
  ]);
  assert.ok(overview.content.every((item) => typeof item.updatedAt === 'string'));
  assert.deepEqual(overview.domain, { domain: 'studio.alva.test', verificationStatus: 'verified' });
  assert.deepEqual(overview.integrations, { vercel: 'configured', analytics: 'pending', agents: 'pending' });

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
  assert.deepEqual(overview.integrations, { vercel: 'configured', analytics: 'pending', agents: 'configured' });
  assert.deepEqual(overview.runtime, {
    analytics: false,
    conversions: false,
    pixels: false,
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
  assert.deepEqual(emptyPayload.integrations, { vercel: 'pending', analytics: 'pending', agents: 'pending' });
  await database.close();
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

test('resposta pública do formulário emite CSP-Report-Only com nonce e sem unsafe-inline em script-src', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const records = await seed(database);
  const app = await start(t, database);
  const alice = client(app.base);
  await alice.request('/api/login', 'POST', { email: 'alice@alva.test', password: records.password });
  const created = await alice.request('/api/forms', 'POST', { name: 'CSP público' });
  let form = await created.json();
  form = await (await alice.request(`/api/forms/${form.id}`, 'PUT', {
    revision: form.revision,
    headerElements: [],
    steps: [{ id: 'inicio', title: 'Comece', elements: [{ id: 'email', type: 'email', title: 'E-mail', required: true }] }],
    completion: { title: 'Recebemos', message: 'Obrigado.' },
  })).json();
  form = await (await alice.request(`/api/forms/${form.id}/publish`, 'POST', { revision: form.revision })).json();

  const publicPage = await fetch(`${app.base}${form.publicPath}`);
  assert.equal(publicPage.status, 200);
  assert.match(await publicPage.clone().text(), /<script src="\/tracker\.js" data-alva-tracker="[a-f0-9]{32}" nonce="[^"]+"><\/script>/);
  const csp = publicPage.headers.get('content-security-policy-report-only');
  assert.ok(csp, 'deveria emitir Content-Security-Policy-Report-Only');
  const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src'));
  assert.match(scriptSrc, /'nonce-[^']+'/);
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
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
  const app = await start(t, database);
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
