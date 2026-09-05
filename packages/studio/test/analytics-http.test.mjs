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
  const server = createApp({ database, sessionOptions: { sessionTTL: 60_000 }, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function client(base) {
  let cookie = '';
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return { request };
}

async function row(database, query, values = []) {
  return (await database.query(query, values)).rows[0];
}

async function seedCompany(database, { email, companyName, slug, password }) {
  const user = await row(
    database,
    'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
    [email, password ? await legacyPassword(password) : await legacyPassword('senha-nao-usada-neste-teste'), 'Pessoa'],
  );
  const company = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [companyName, slug]);
  await database.query(
    "INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())",
    [company.id, user.id],
  );
  return { user, company };
}

async function seedProjectFor(database, company, user, { name, slug }) {
  return row(
    database,
    'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [company.id, name, slug, user.id],
  );
}

async function createWebsite(database, { companyId, projectId }, trackerPublicId, environment = 'production') {
  return row(
    database,
    'INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, $3, $4) RETURNING id',
    [companyId, projectId, trackerPublicId, environment],
  );
}

async function seedPublishedDomain(database, { companyId, projectId }, domain) {
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'production', $3, true, 'verified')`,
    [companyId, projectId, domain],
  );
}

test('limita por IP antes de ler o corpo: a terceira chamada rápida do mesmo IP recebe 429', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const app = await start(t, database, { collectLimiterOptions: { maxPerMinutePerIp: 2 } });
  const post = () => fetch(`${app.base}/api/public/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const first = await post();
  const second = await post();
  const third = await post();
  assert.notEqual(first.status, 429);
  assert.notEqual(second.status, 429);
  assert.equal(third.status, 429, await third.text());
  await database.close();
});

test('POST sem Origin é permitido, como já ocorre nas submissões de formulário', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const seed = await seedCompany(database, { email: 'sem-origem@alva.test', companyName: 'Sem Origem', slug: 'sem-origem' });
  const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
  await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'trk-sem-origem');
  const app = await start(t, database);
  const response = await fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackerPublicId: 'trk-sem-origem', event_name: 'pageview' }),
  });
  assert.equal(response.status, 204, await response.text());
  await database.close();
});

test('corpo acima de 128 KB é recusado com 413 antes de tentar interpretar o JSON', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const app = await start(t, database);
  const response = await fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'a'.repeat(130 * 1024),
  });
  assert.equal(response.status, 413, await response.text());
  await database.close();
});

test('tracker não encontrado e origem não autorizada respondem com o mesmo status, sem oráculo 404-vs-403', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const seed = await seedCompany(database, { email: 'oraculo@alva.test', companyName: 'Oráculo', slug: 'oraculo' });
  const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
  await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'trk-oraculo');
  await seedPublishedDomain(database, { companyId: seed.company.id, projectId: project.id }, 'painel.oraculo.test');
  const app = await start(t, database);

  const send = (trackerPublicId, origin) => fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ trackerPublicId, event_name: 'pageview' }),
  });

  const trackerInexistente = await send('trk-nao-existe', 'https://atacante.example.test');
  const origemErrada = await send('trk-oraculo', 'https://atacante.example.test');
  assert.equal(trackerInexistente.status, origemErrada.status, 'os dois motivos de falha precisam ser indistinguíveis pelo status');
  assert.equal(trackerInexistente.status, 403);
  const [textoInexistente, textoErrado] = await Promise.all([trackerInexistente.text(), origemErrada.text()]);
  assert.equal(textoInexistente, textoErrado, 'a mensagem também não pode diferenciar os dois casos');

  const origemCorreta = await send('trk-oraculo', 'https://painel.oraculo.test');
  assert.equal(origemCorreta.status, 204, await origemCorreta.text());
  await database.close();
});

test('isolamento na fronteira HTTP: o tracker de uma empresa nunca grava evento na outra', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const alva = await seedCompany(database, { email: 'http-alva@alva.test', companyName: 'HTTP Alva', slug: 'http-alva' });
  const projectAlva = await seedProjectFor(database, alva.company, alva.user, { name: 'Projeto Alva', slug: 'projeto-alva' });
  await createWebsite(database, { companyId: alva.company.id, projectId: projectAlva.id }, 'trk-http-alva');
  const outra = await seedCompany(database, { email: 'http-outra@alva.test', companyName: 'HTTP Outra', slug: 'http-outra' });
  const projectOutra = await seedProjectFor(database, outra.company, outra.user, { name: 'Projeto Outra', slug: 'projeto-outra' });
  await createWebsite(database, { companyId: outra.company.id, projectId: projectOutra.id }, 'trk-http-outra');
  const app = await start(t, database);

  const post = (trackerPublicId) => fetch(`${app.base}/api/public/collect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackerPublicId, event_name: 'pageview' }),
  });
  assert.equal((await post('trk-http-alva')).status, 204);

  const eventosAlva = await database.query('SELECT id FROM analytics_events WHERE company_id = $1', [alva.company.id]);
  const eventosOutra = await database.query('SELECT id FROM analytics_events WHERE company_id = $1', [outra.company.id]);
  assert.equal(eventosAlva.rowCount, 1);
  assert.equal(eventosOutra.rowCount, 0, 'evento do tracker da Alva não pode aparecer na empresa Outra');
  await database.close();
});

test('nenhum IP ou user-agent cru chega a ser persistido', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const seed = await seedCompany(database, { email: 'sem-pii@alva.test', companyName: 'Sem PII', slug: 'sem-pii' });
  const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
  await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'trk-sem-pii');
  const app = await start(t, database);
  const userAgent = 'AgenteDeTesteBemDistintoXYZ/9.9';
  const response = await fetch(`${app.base}/api/public/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
    body: JSON.stringify({ trackerPublicId: 'trk-sem-pii', event_name: 'pageview' }),
  });
  assert.equal(response.status, 204, await response.text());

  const sessions = await database.query('SELECT * FROM analytics_sessions WHERE company_id = $1', [seed.company.id]);
  const events = await database.query('SELECT * FROM analytics_events WHERE company_id = $1', [seed.company.id]);
  const dump = JSON.stringify([...sessions.rows, ...events.rows]);
  assert.equal(dump.includes(userAgent), false, 'user agent cru não pode ser persistido');
  assert.equal(dump.includes('127.0.0.1'), false, 'IP cru não pode ser persistido');
  await database.close();
});

test('página pública da VSL inclui o script do tracker do projeto e a CSP correta', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const senha = 'senha-vsl-tracker-123';
  const seed = await seedCompany(database, { email: 'vsl-tracker@alva.test', companyName: 'VSL Tracker', slug: 'vsl-tracker', password: senha });
  const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
  await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'trk-vsl-pagina');
  const app = await start(t, database);
  const alice = client(app.base);
  const login = await alice.request('/api/login', 'POST', { email: 'vsl-tracker@alva.test', password: senha });
  assert.equal(login.status, 200, await login.text());

  const created = await alice.request(`/api/projects/${project.id}/videos`, 'POST', {
    name: 'VSL com tracker', sourceUrl: 'https://cdn.example.test/video.mp4',
  });
  const video = await created.json();
  assert.equal(created.status, 201, JSON.stringify(video));
  const published = await alice.request(`/api/projects/${project.id}/videos/${video.id}/publish`, 'POST', { lockVersion: video.lockVersion });
  const publicVideo = await published.json();
  assert.equal(published.status, 201, JSON.stringify(publicVideo));

  const response = await fetch(`${app.base}/v/${publicVideo.publicId}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<script src="\/tracker\.js" data-alva-tracker="trk-vsl-pagina"><\/script>/);
  const csp = response.headers.get('content-security-policy');
  const connectSrc = csp.split('; ').find((directive) => directive.startsWith('connect-src'));
  assert.match(connectSrc, new RegExp(app.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(csp, /(^|; )script-src 'self'(;|$)/);
  await database.close();
});
