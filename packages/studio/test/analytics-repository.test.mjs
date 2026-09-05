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

async function createWebsite(database, { companyId, projectId }, trackerPublicId, environment = 'production') {
  return row(
    database,
    'INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, $3, $4) RETURNING id',
    [companyId, projectId, trackerPublicId, environment],
  );
}

test('resolveWebsite resolve o tracker público sem vazar outra empresa e devolve null para id inexistente', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const first = await seedCompany(database, { email: 'resolve-a@alva.test', companyName: 'Resolve A', slug: 'resolve-a' });
    const firstProject = await seedProjectFor(database, first.company, first.user, { name: 'Projeto A', slug: 'projeto-a' });
    const second = await seedCompany(database, { email: 'resolve-b@alva.test', companyName: 'Resolve B', slug: 'resolve-b' });
    const secondProject = await seedProjectFor(database, second.company, second.user, { name: 'Projeto B', slug: 'projeto-b' });
    const websiteA = await createWebsite(database, { companyId: first.company.id, projectId: firstProject.id }, 'tracker-repo-a');
    const websiteB = await createWebsite(database, { companyId: second.company.id, projectId: secondProject.id }, 'tracker-repo-b');

    const repo = new AnalyticsRepository(database);

    assert.deepEqual(await repo.resolveWebsite({ trackerPublicId: 'tracker-repo-a' }), {
      websiteId: websiteA.id,
      companyId: first.company.id,
      projectId: firstProject.id,
      companySlug: 'resolve-a',
      projectSlug: 'projeto-a',
    });
    assert.deepEqual(await repo.resolveWebsite({ trackerPublicId: 'tracker-repo-b' }), {
      websiteId: websiteB.id,
      companyId: second.company.id,
      projectId: secondProject.id,
      companySlug: 'resolve-b',
      projectSlug: 'projeto-b',
    });
    assert.equal(await repo.resolveWebsite({ trackerPublicId: 'tracker-inexistente' }), null);
    assert.equal(await repo.resolveWebsite({ trackerPublicId: '' }), null);
  } finally {
    await database.close();
  }
});

test('resolveWebsite devolve companySlug/projectSlug num único JOIN, e o site de uma empresa nunca aparece no summary de outra', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const alva = await seedCompany(database, { email: 'slug-alva@alva.test', companyName: 'Slug Alva', slug: 'slug-alva' });
    const projectAlva = await seedProjectFor(database, alva.company, alva.user, { name: 'Projeto Alva', slug: 'projeto-alva-slug' });
    const outra = await seedCompany(database, { email: 'slug-outra@alva.test', companyName: 'Slug Outra', slug: 'slug-outra' });
    const projectOutra = await seedProjectFor(database, outra.company, outra.user, { name: 'Projeto Outra', slug: 'projeto-outra-slug' });
    const websiteAlva = await createWebsite(database, { companyId: alva.company.id, projectId: projectAlva.id }, 'tracker-slug-alva');
    const websiteOutra = await createWebsite(database, { companyId: outra.company.id, projectId: projectOutra.id }, 'tracker-slug-outra');

    const repo = new AnalyticsRepository(database);
    const now = new Date();
    await repo.ingest({ websiteId: websiteOutra.id, companyId: outra.company.id, projectId: projectOutra.id, visitorHash: 'v-outra', event: { type: 'pageview', urlPath: '/', at: now } });

    const resolved = await repo.resolveWebsite({ trackerPublicId: 'tracker-slug-outra' });
    assert.equal(resolved.companySlug, 'slug-outra');
    assert.equal(resolved.projectSlug, 'projeto-outra-slug');

    const summaryAlva = await repo.summary({
      companyId: alva.company.id, projectId: projectAlva.id, actorId: alva.user.id,
      from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000),
    });
    assert.equal(summaryAlva.totalEvents, 0, 'evento ingerido no website da outra empresa não pode aparecer aqui');
    void websiteAlva;
  } finally {
    await database.close();
  }
});

test('summary conta somente eventos do próprio projeto e nunca de outro projeto ou de outra empresa', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const owner = await seedCompany(database, { email: 'summary-owner@alva.test', companyName: 'Summary Owner', slug: 'summary-owner' });
    const projectA = await seedProjectFor(database, owner.company, owner.user, { name: 'Projeto A', slug: 'projeto-a' });
    const projectB = await seedProjectFor(database, owner.company, owner.user, { name: 'Projeto B', slug: 'projeto-b' });
    const otherCompany = await seedCompany(database, { email: 'summary-other@alva.test', companyName: 'Summary Other', slug: 'summary-other' });
    const projectC = await seedProjectFor(database, otherCompany.company, otherCompany.user, { name: 'Projeto C', slug: 'projeto-c' });

    const websiteA = await createWebsite(database, { companyId: owner.company.id, projectId: projectA.id }, 'tracker-summary-a');
    const websiteB = await createWebsite(database, { companyId: owner.company.id, projectId: projectB.id }, 'tracker-summary-b');
    const websiteC = await createWebsite(database, { companyId: otherCompany.company.id, projectId: projectC.id }, 'tracker-summary-c');

    const repo = new AnalyticsRepository(database);
    const now = new Date();
    await repo.ingest({ websiteId: websiteA.id, companyId: owner.company.id, projectId: projectA.id, visitorHash: 'visitor-a', event: { type: 'pageview', urlPath: '/', at: now } });
    await repo.ingest({ websiteId: websiteB.id, companyId: owner.company.id, projectId: projectB.id, visitorHash: 'visitor-b', event: { type: 'pageview', urlPath: '/', at: now } });
    await repo.ingest({ websiteId: websiteC.id, companyId: otherCompany.company.id, projectId: projectC.id, visitorHash: 'visitor-c', event: { type: 'pageview', urlPath: '/', at: now } });

    const summary = await repo.summary({
      companyId: owner.company.id,
      projectId: projectA.id,
      actorId: owner.user.id,
      from: new Date(now.getTime() - 60_000),
      to: new Date(now.getTime() + 60_000),
    });
    assert.equal(summary.totalEvents, 1);
    assert.equal(summary.pageviews, 1);
  } finally {
    await database.close();
  }
});

test('summary inclui dailyVisits: série diária dos últimos 7 dias terminando em "to", com zero preenchido', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'daily@alva.test', companyName: 'Daily', slug: 'daily' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto-daily' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-daily');
    const repo = new AnalyticsRepository(database);
    const to = new Date('2026-03-10T00:00:00Z');
    const threeDaysAgo = new Date(to.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);

    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'v1', event: { type: 'pageview', urlPath: '/', at: sixDaysAgo } });
    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'v1', event: { type: 'pageview', urlPath: '/', at: threeDaysAgo } });
    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'v2', event: { type: 'pageview', urlPath: '/', at: threeDaysAgo } });

    const summary = await repo.summary({ companyId: seed.company.id, projectId: project.id, actorId: seed.user.id, from: new Date(0), to });
    assert.equal(summary.dailyVisits.length, 7, 'sempre 7 dias, mesmo sem evento em todos eles');
    assert.equal(summary.dailyVisits[0].date, sixDaysAgo.toISOString().slice(0, 10));
    assert.equal(summary.dailyVisits[0].total, 1);
    assert.equal(summary.dailyVisits[3].date, threeDaysAgo.toISOString().slice(0, 10));
    assert.equal(summary.dailyVisits[3].total, 2);
    assert.equal(summary.dailyVisits[6].date, to.toISOString().slice(0, 10));
    assert.equal(summary.dailyVisits[6].total, 0, 'dia sem evento vem zerado, não ausente');
    assert.equal(summary.dailyVisits.filter((day) => day.total === 0).length, 5, 'os outros 5 dias sem evento também vêm zerados');
  } finally {
    await database.close();
  }
});

test('summary inclui funnel: origem mais comum, top 2 rotas e total de conversões, isolado por projeto', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'funnel@alva.test', companyName: 'Funnel', slug: 'funnel' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto-funnel' });
    const outro = await seedProjectFor(database, seed.company, seed.user, { name: 'Outro', slug: 'projeto-funnel-outro' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-funnel');
    const websiteOutro = await createWebsite(database, { companyId: seed.company.id, projectId: outro.id }, 'tracker-funnel-outro');
    const repo = new AnalyticsRepository(database);
    const now = new Date('2026-03-10T12:00:00Z');

    const first = await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'fv1', event: { type: 'pageview', urlPath: '/imobiliarias', at: now } });
    await database.query("UPDATE analytics_sessions SET utm_source = 'meta' WHERE id = $1", [first.sessionId]);
    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'fv1', event: { type: 'pageview', urlPath: '/diagnostico', at: now } });
    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'fv1', event: { type: 'custom', eventName: 'form_submit_attempt', urlPath: '/diagnostico', at: now } });
    await repo.ingest({ websiteId: websiteOutro.id, companyId: seed.company.id, projectId: outro.id, visitorHash: 'fv2', event: { type: 'custom', eventName: 'form_submit_attempt', urlPath: '/outra-rota', at: now } });

    const summary = await repo.summary({ companyId: seed.company.id, projectId: project.id, actorId: seed.user.id, from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() + 60_000) });
    assert.equal(summary.funnel.length, 4);
    assert.equal(summary.funnel[0].label, 'meta');
    assert.deepEqual(new Set(summary.funnel.slice(1, 3).map((step) => step.label)), new Set(['/imobiliarias', '/diagnostico']));
    assert.equal(summary.funnel[3].label, 'Lead');
    assert.equal(summary.funnel[3].total, 1, 'conversão do outro projeto não pode entrar aqui');
  } finally {
    await database.close();
  }
});

test('ingest nunca persiste IP ou user agent crus em analytics_sessions ou analytics_events', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'pii-db@alva.test', companyName: 'Pii Db', slug: 'pii-db' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto-pii-db' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-pii-db');
    const repo = new AnalyticsRepository(database);
    const rawIp = '203.0.113.77';
    const rawUserAgent = 'Mozilla/5.0 (MinhaImpressaoDigitalUnica/9.9.9)';
    const visitorHash = repo.visitorHash({ websiteId: website.id, address: rawIp, userAgent: rawUserAgent });

    await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash, event: { type: 'pageview', urlPath: '/', at: new Date() } });

    const sessionRow = await database.query('SELECT row_to_json(analytics_sessions) AS row FROM analytics_sessions WHERE company_id = $1', [seed.company.id]);
    const eventRow = await database.query('SELECT row_to_json(analytics_events) AS row FROM analytics_events WHERE company_id = $1', [seed.company.id]);
    const serialized = JSON.stringify(sessionRow.rows.map((r) => r.row)) + JSON.stringify(eventRow.rows.map((r) => r.row));
    assert.ok(!serialized.includes(rawIp), 'IP cru não pode aparecer em nenhuma coluna');
    assert.ok(!serialized.includes(rawUserAgent), 'user agent cru não pode aparecer em nenhuma coluna');
    assert.equal(sessionRow.rows[0].row.visitor_hash, visitorHash, 'só o hash deve ficar gravado');
  } finally {
    await database.close();
  }
});

test('summary responde 404 para projeto inexistente e para ator sem nenhuma relação com a empresa', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const owner = await seedCompany(database, { email: '404-owner@alva.test', companyName: '404 Owner', slug: '404-owner' });
    const project = await seedProjectFor(database, owner.company, owner.user, { name: 'Projeto', slug: 'projeto' });
    const outsider = await seedCompany(database, { email: '404-outsider@alva.test', companyName: '404 Outsider', slug: '404-outsider' });
    const repo = new AnalyticsRepository(database);
    const range = { from: new Date(0), to: new Date() };

    await assert.rejects(
      () => repo.summary({ companyId: owner.company.id, projectId: randomUUID(), actorId: owner.user.id, ...range }),
      (error) => error.status === 404,
      'projeto inexistente deveria responder 404',
    );

    await assert.rejects(
      () => repo.summary({ companyId: owner.company.id, projectId: project.id, actorId: outsider.user.id, ...range }),
      (error) => error.status === 404,
      'ator sem membership na empresa deveria responder 404',
    );
  } finally {
    await database.close();
  }
});

test('duas visitas do mesmo visitante a 10 minutos ficam na mesma sessão', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'sessao-perto@alva.test', companyName: 'Sessão Perto', slug: 'sessao-perto' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-sessao-perto');
    const repo = new AnalyticsRepository(database);
    const start = new Date('2026-01-01T12:00:00Z');

    const first = await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'visitante-perto', event: { type: 'pageview', urlPath: '/', at: start } });
    const second = await repo.ingest({
      websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'visitante-perto',
      event: { type: 'pageview', urlPath: '/segunda', at: new Date(start.getTime() + 10 * 60_000) },
    });

    assert.equal(second.sessionId, first.sessionId);
  } finally {
    await database.close();
  }
});

test('duas visitas do mesmo visitante a 31 minutos abrem sessões diferentes', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'sessao-longe@alva.test', companyName: 'Sessão Longe', slug: 'sessao-longe' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-sessao-longe');
    const repo = new AnalyticsRepository(database);
    const start = new Date('2026-01-01T12:00:00Z');

    const first = await repo.ingest({ websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'visitante-longe', event: { type: 'pageview', urlPath: '/', at: start } });
    const second = await repo.ingest({
      websiteId: website.id, companyId: seed.company.id, projectId: project.id, visitorHash: 'visitante-longe',
      event: { type: 'pageview', urlPath: '/segunda', at: new Date(start.getTime() + 31 * 60_000) },
    });

    assert.notEqual(second.sessionId, first.sessionId);
  } finally {
    await database.close();
  }
});

test('visitorHash muda para o mesmo IP e user agent em dias diferentes e não é uma consulta ao banco', () => {
  const repo = new AnalyticsRepository({ query: async () => { throw new Error('visitorHash não deveria consultar o banco'); } });
  const day1 = repo.visitorHash({ websiteId: 'site-1', address: '203.0.113.9', userAgent: 'UA-Test/1.0', at: new Date('2026-01-01T00:00:00Z') });
  const day2 = repo.visitorHash({ websiteId: 'site-1', address: '203.0.113.9', userAgent: 'UA-Test/1.0', at: new Date('2026-01-02T00:00:00Z') });
  const sameDayAgain = repo.visitorHash({ websiteId: 'site-1', address: '203.0.113.9', userAgent: 'UA-Test/1.0', at: new Date('2026-01-01T23:59:00Z') });

  assert.notEqual(day1, day2);
  assert.equal(day1, sameDayAgain);
  assert.equal(typeof day1, 'string');
  assert.equal(day1.length, 64);
});

test('purgeExpired remove evento com mais de 90 dias e preserva agregado de 24 meses', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedCompany(database, { email: 'purge@alva.test', companyName: 'Purge', slug: 'purge' });
    const project = await seedProjectFor(database, seed.company, seed.user, { name: 'Projeto', slug: 'projeto' });
    const website = await createWebsite(database, { companyId: seed.company.id, projectId: project.id }, 'tracker-purge');

    const oldEventAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await database.query(
      "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path) VALUES ($1, $2, $3, $4, 'pageview', '/')",
      [seed.company.id, project.id, website.id, oldEventAt],
    );
    const recent = await row(
      database,
      "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path) VALUES ($1, $2, $3, now(), 'pageview', '/') RETURNING id",
      [seed.company.id, project.id, website.id],
    );

    const oldRollupDate = new Date();
    oldRollupDate.setUTCMonth(oldRollupDate.getUTCMonth() - 24);
    const rollup = await row(
      database,
      "INSERT INTO analytics_daily_rollup (company_id, project_id, website_id, rollup_date, event_type, event_count) VALUES ($1, $2, $3, $4, 'pageview', 3) RETURNING id",
      [seed.company.id, project.id, website.id, oldRollupDate.toISOString().slice(0, 10)],
    );

    const repo = new AnalyticsRepository(database);
    const result = await repo.purgeExpired({ eventDays: 90, rollupMonths: 25, limit: 500 });
    assert.equal(result.removidos, 1);

    const remainingEvents = await database.query('SELECT id FROM analytics_events WHERE company_id = $1', [seed.company.id]);
    assert.deepEqual(remainingEvents.rows.map((current) => current.id), [recent.id]);

    const remainingRollup = await database.query('SELECT id FROM analytics_daily_rollup WHERE id = $1', [rollup.id]);
    assert.equal(remainingRollup.rowCount, 1);
  } finally {
    await database.close();
  }
});
