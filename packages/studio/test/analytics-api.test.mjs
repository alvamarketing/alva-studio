import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';
import { AnalyticsRepository } from '../server/repositories/analytics-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function migratedDatabase(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}

async function row(database, query, values = []) {
  return (await database.query(query, values)).rows[0];
}

async function seedCompany(database, { email, companyName, slug }) {
  const user = await row(
    database,
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id",
    [email],
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

async function createWebsite(database, { companyId, projectId }, trackerPublicId) {
  return row(
    database,
    "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, $3, 'production') RETURNING id",
    [companyId, projectId, trackerPublicId],
  );
}

function fakeSessionService({ companyId, userId, projectId, role = 'owner' }) {
  return {
    require: async () => ({ companyId, user: { id: userId }, role, currentProjectId: projectId }),
    authorize: async (context, capability, requestedProjectId) => {
      if (requestedProjectId && requestedProjectId !== projectId) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
      if (capability && capability !== 'analytics.read') throw Object.assign(new Error('Sem permissão.'), { status: 403 });
    },
  };
}

async function request(api, req, path, method) {
  const result = [];
  await api({ req, res: {}, path, method, json: (data, status = 200) => { result.push({ data, status }); return result.at(-1); } });
  return result[0];
}

test('GET /api/projects/:id/analytics/summary responde 401 sem sessão', async () => {
  const api = createProjectApi({
    sessionService: { require: async () => { throw Object.assign(new Error('Entre na sua conta.'), { status: 401 }); } },
    body: async () => ({}),
  });
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-1/analytics/summary?from=2026-01-01&to=2026-01-02' }, '/api/projects/project-1/analytics/summary', 'GET'),
    (error) => error.status === 401,
  );
});

test('GET /api/projects/:id/analytics/summary responde 403 para papel sem analytics.read', async () => {
  const sessionService = {
    require: async () => ({ companyId: 'company-1', user: { id: 'user-1' }, role: 'analyst', currentProjectId: 'project-1' }),
    authorize: async (context, capability) => { if (capability === 'analytics.read') throw Object.assign(new Error('Sem permissão.'), { status: 403 }); },
  };
  const api = createProjectApi({ sessionService, body: async () => ({}) });
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-1/analytics/summary?from=2026-01-01&to=2026-01-02' }, '/api/projects/project-1/analytics/summary', 'GET'),
    (error) => error.status === 403,
  );
});

test('GET /api/projects/:id/analytics/summary responde 404 para projeto de outra empresa', async () => {
  const sessionService = fakeSessionService({ companyId: 'company-1', userId: 'user-1', projectId: 'project-1' });
  const api = createProjectApi({ sessionService, body: async () => ({}) });
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-de-outra-empresa/analytics/summary?from=2026-01-01&to=2026-01-02' }, '/api/projects/project-de-outra-empresa/analytics/summary', 'GET'),
    (error) => error.status === 404,
  );
});

test('GET /api/projects/:id/analytics/summary responde 400 para intervalo inválido', async () => {
  const sessionService = fakeSessionService({ companyId: 'company-1', userId: 'user-1', projectId: 'project-1' });
  const api = createProjectApi({
    sessionService, body: async () => ({}),
    analytics: { summary: async () => { throw new Error('não deveria consultar o repositório com intervalo inválido'); } },
  });
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-1/analytics/summary' }, '/api/projects/project-1/analytics/summary', 'GET'),
    (error) => error.status === 400,
    'sem from/to deveria ser 400',
  );
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-1/analytics/summary?from=2026-01-02&to=2026-01-01' }, '/api/projects/project-1/analytics/summary', 'GET'),
    (error) => error.status === 400,
    'from depois de to deveria ser 400',
  );
  await assert.rejects(
    () => request(api, { url: '/api/projects/project-1/analytics/summary?from=nao-e-data&to=2026-01-02' }, '/api/projects/project-1/analytics/summary', 'GET'),
    (error) => error.status === 400,
    'data ilegível deveria ser 400',
  );
});

test('resumo não contém visitor_hash, linha crua de evento nem campo de resposta de formulário, e ignora projeto irmão da mesma empresa', async (t) => {
  const database = await migratedDatabase(t);
  t.after(() => database.close());

  const owner = await seedCompany(database, { email: 'summary-api-owner@alva.test', companyName: 'Summary Api Owner', slug: 'summary-api-owner' });
  const projectA = await seedProjectFor(database, owner.company, owner.user, { name: 'Projeto A', slug: 'projeto-a-summary-api' });
  const projectB = await seedProjectFor(database, owner.company, owner.user, { name: 'Projeto B', slug: 'projeto-b-summary-api' });
  const websiteA = await createWebsite(database, { companyId: owner.company.id, projectId: projectA.id }, 'tracker-summary-api-a');
  const websiteB = await createWebsite(database, { companyId: owner.company.id, projectId: projectB.id }, 'tracker-summary-api-b');

  const analytics = new AnalyticsRepository(database);
  const now = new Date('2026-02-01T12:00:00Z');
  await analytics.ingest({ websiteId: websiteA.id, companyId: owner.company.id, projectId: projectA.id, visitorHash: 'visitor-a-1', event: { type: 'pageview', urlPath: '/', at: now } });
  await analytics.ingest({ websiteId: websiteA.id, companyId: owner.company.id, projectId: projectA.id, visitorHash: 'visitor-a-1', event: { type: 'custom', eventName: 'form_submit_attempt', urlPath: '/formulario', at: now } });
  await analytics.ingest({ websiteId: websiteB.id, companyId: owner.company.id, projectId: projectB.id, visitorHash: 'visitor-b-1', event: { type: 'pageview', urlPath: '/', at: now } });

  const sessionService = fakeSessionService({ companyId: owner.company.id, userId: owner.user.id, projectId: projectA.id });
  const api = createProjectApi({ sessionService, body: async () => ({}), analytics });

  const response = await request(
    api,
    { url: `/api/projects/${projectA.id}/analytics/summary?from=${encodeURIComponent('2026-02-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-02-02T00:00:00.000Z')}` },
    `/api/projects/${projectA.id}/analytics/summary`,
    'GET',
  );

  assert.equal(response.status, 200);
  const serialized = JSON.stringify(response.data);
  assert.ok(!serialized.includes('visitor_hash'), 'jamais deve expor visitor_hash');
  assert.ok(!serialized.includes('visitor-a-1'), 'jamais deve expor o hash cru do visitante');
  assert.ok(!('events' in response.data), 'jamais deve devolver linha de evento crua');
  assert.equal(response.data.totalEvents, 2, 'só deve contar eventos do projeto A, nunca do projeto B');
  assert.equal(response.data.pageviews, 1);
  assert.equal(response.data.conversions.some((item) => item.urlPath === '/formulario'), true);
  assert.equal(response.data.dailyVisits.length, 7, 'API repassa a série diária de 7 dias sem alterar o formato do repositório');
  assert.ok(Array.isArray(response.data.funnel) && response.data.funnel.every((step) => typeof step.label === 'string' && typeof step.total === 'number'), 'API repassa a jornada origem/rota(s)/conversão sem alterar a forma');
});
