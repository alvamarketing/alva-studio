import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresFixture } from './postgres-fixture.mjs';
import { AnalyticsRepository } from '../server/repositories/analytics-repository.mjs';

async function migratedDatabase(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}
const row = async (database, query, values = []) => (await database.query(query, values)).rows[0];

async function cenario(database) {
  const marca = randomUUID().slice(0, 8);
  const user = await row(database, "INSERT INTO users (email, password_hash, display_name) VALUES ($1,'hash','Pessoa') RETURNING id", [`cobertura-${marca}@alva.test`]);
  const company = await row(database, "INSERT INTO companies (name, slug) VALUES ($1,$2) RETURNING id", ['Cobertura', `cobertura-${marca}`]);
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1,$2,'owner',now())", [company.id, user.id]);
  const project = await row(database, "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Projeto',$2,$3) RETURNING id", [company.id, `projeto-${marca}`, user.id]);
  const website = await row(database,
    `INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1,$2,$3,'production')
     ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id RETURNING id`,
    [company.id, project.id, `tracker-${marca}`]);
  return { user, company, project, website };
}

// duas sessões: uma com 3 páginas e 120s, outra com 1 página (rejeição) e 30s
async function popular(database, { company, project, website }, base) {
  const sessoes = [
    { hash: 'v1', device: 'desktop', country: 'BR', city: 'São Paulo', segundos: 120, paginas: ['/', '/precos', '/obrigado'] },
    { hash: 'v2', device: 'mobile', country: 'PT', city: 'Lisboa', segundos: 30, paginas: ['/'] },
  ];
  for (const s of sessoes) {
    const inicio = new Date(base.getTime() + 1000);
    const sessao = await row(database,
      `INSERT INTO analytics_sessions (company_id,project_id,website_id,visitor_hash,first_seen_at,last_seen_at,device,browser,os,country,city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Chrome','Windows',$8,$9) RETURNING id`,
      [company.id, project.id, website.id, s.hash, inicio, new Date(inicio.getTime() + s.segundos * 1000), s.device, s.country, s.city]);
    for (const [i, path] of s.paginas.entries()) {
      await database.query(
        `INSERT INTO analytics_events (company_id,project_id,website_id,session_id,event_at,event_type,url_path,tracking_event_id)
         VALUES ($1,$2,$3,$4,$5,'pageview',$6,gen_random_uuid())`,
        [company.id, project.id, website.id, sessao.id, new Date(inicio.getTime() + i * 1000), path]);
    }
  }
}

test('o resumo mede visitas, rejeição e tempo total a partir das sessões', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const resumo = await new AnalyticsRepository(database).summary({
      companyId: ctx.company.id, projectId: ctx.project.id, actorId: ctx.user.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    });
    assert.equal(resumo.visits, 2);
    assert.equal(resumo.bounces, 1, 'a sessão de uma página só é rejeição');
    assert.equal(resumo.totalTime, 150, 'soma dos segundos das duas sessões');
  } finally { await database.close(); }
});

test('o resumo descreve o público por país, cidade e dispositivo', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const resumo = await new AnalyticsRepository(database).summary({
      companyId: ctx.company.id, projectId: ctx.project.id, actorId: ctx.user.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    });
    assert.deepEqual(resumo.audience.countries, [{ value: 'BR', total: 1 }, { value: 'PT', total: 1 }]);
    assert.deepEqual(resumo.audience.cities, [{ value: 'Lisboa', total: 1 }, { value: 'São Paulo', total: 1 }]);
    assert.deepEqual(resumo.audience.devices, [{ value: 'desktop', total: 1 }, { value: 'mobile', total: 1 }]);
  } finally { await database.close(); }
});

test('o resumo aponta por onde as visitas entram e saem', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const resumo = await new AnalyticsRepository(database).summary({
      companyId: ctx.company.id, projectId: ctx.project.id, actorId: ctx.user.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    });
    assert.deepEqual(resumo.behavior.entries, [{ value: '/', total: 2 }]);
    assert.deepEqual(resumo.behavior.exits, [{ value: '/', total: 1 }, { value: '/obrigado', total: 1 }]);
  } finally { await database.close(); }
});

test('o repositório entrega os pageviews da jornada com sessão, rota e origem', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const eventos = await new AnalyticsRepository(database).journeyEvents({
      companyId: ctx.company.id, projectId: ctx.project.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    });
    assert.equal(eventos.length, 4, 'três páginas de uma sessão mais uma da outra');
    const primeiro = eventos[0];
    assert.equal(primeiro.eventType, 'pageview');
    assert.ok(primeiro.sessionId, 'a sessão é necessária para montar o caminho');
    assert.ok(primeiro.urlPath.startsWith('/'));
    assert.ok(Object.hasOwn(primeiro, 'utmSource') && Object.hasOwn(primeiro, 'referrerDomain'));
  } finally { await database.close(); }
});

test('a jornada inclui as ações executadas, com o nome do evento', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const sessao = (await database.query('SELECT id FROM analytics_sessions LIMIT 1')).rows[0];
    await database.query(
      `INSERT INTO analytics_events (company_id,project_id,website_id,session_id,event_at,event_type,url_path,event_name,tracking_event_id)
       VALUES ($1,$2,$3,$4,$5,'custom','/precos','lead',gen_random_uuid())`,
      [ctx.company.id, ctx.project.id, ctx.website.id, sessao.id, new Date(base.getTime() + 5000)]);
    const eventos = await new AnalyticsRepository(database).journeyEvents({
      companyId: ctx.company.id, projectId: ctx.project.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    });
    const acao = eventos.find((evento) => evento.eventType === 'custom');
    assert.ok(acao, 'a ação precisa vir junto dos pageviews');
    assert.equal(acao.eventName, 'lead', 'sem o nome do evento a ação some do mapa');
  } finally { await database.close(); }
});

test('a jornada do projeto vira grafo com nós, passagens e totais', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const ctx = await cenario(database);
    const base = new Date();
    await popular(database, ctx, base);
    const repo = new AnalyticsRepository(database);
    const { buildJourneyGraph } = await import('../server/analytics-journey.mjs');
    const grafo = buildJourneyGraph(await repo.journeyEvents({
      companyId: ctx.company.id, projectId: ctx.project.id,
      from: new Date(base.getTime() - 60_000), to: new Date(base.getTime() + 600_000),
    }));
    assert.equal(grafo.totals.sessions, 2);
    assert.equal(grafo.totals.pageviews, 4);
    assert.deepEqual(grafo.edges.map((e) => `${e.source}>${e.target}`).sort(), ['/>/precos', '/precos>/obrigado']);
  } finally { await database.close(); }
});
