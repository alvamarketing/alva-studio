import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresFixture } from './postgres-fixture.mjs';
import { AnalyticsRepository } from '../server/repositories/analytics-repository.mjs';
import { curvaDeRetencao } from '../server/vsl-retention.mjs';

// A pergunta que a VSL precisa responder é onde as pessoas param de assistir. Os eventos
// já chegavam — início, marcos de 25 em 25, conclusão e clique no CTA — e ninguém
// conseguia ver. Sem a curva, o vídeo é publicado no escuro.

test('a curva mostra quantos sobraram em cada marco, a partir de quem começou', () => {
  const curva = curvaDeRetencao([
    { eventName: 'vsl_start', total: 100 },
    { eventName: 'vsl_progress', milestone: 25, total: 80 },
    { eventName: 'vsl_progress', milestone: 50, total: 55 },
    { eventName: 'vsl_progress', milestone: 75, total: 30 },
    { eventName: 'vsl_complete', total: 22 },
  ]);
  assert.deepEqual(curva.pontos.map((p) => [p.marco, p.espectadores, p.retencao]), [
    [0, 100, 100],
    [25, 80, 80],
    [50, 55, 55],
    [75, 30, 30],
    [100, 22, 22],
  ]);
});

test('o marco sem ninguém aparece zerado, em vez de sumir da curva', () => {
  const curva = curvaDeRetencao([
    { eventName: 'vsl_start', total: 10 },
    { eventName: 'vsl_progress', milestone: 25, total: 4 },
  ]);
  assert.deepEqual(curva.pontos.map((p) => p.marco), [0, 25, 50, 75, 100]);
  assert.equal(curva.pontos.at(-1).espectadores, 0);
});

test('a maior desistência é apontada, que é o que se olha primeiro', () => {
  const curva = curvaDeRetencao([
    { eventName: 'vsl_start', total: 100 },
    { eventName: 'vsl_progress', milestone: 25, total: 90 },
    { eventName: 'vsl_progress', milestone: 50, total: 40 },
    { eventName: 'vsl_progress', milestone: 75, total: 35 },
    { eventName: 'vsl_complete', total: 30 },
  ]);
  assert.equal(curva.maiorQueda.de, 25, 'a perda foi entre 25% e 50%');
  assert.equal(curva.maiorQueda.para, 50);
  assert.equal(curva.maiorQueda.perdidos, 50);
});

test('sem ninguém tendo começado, não há curva nem divisão por zero', () => {
  const curva = curvaDeRetencao([]);
  assert.equal(curva.inicios, 0);
  assert.equal(curva.pontos.every((p) => p.retencao === 0), true);
  assert.equal(curva.maiorQueda, null);
});

test('quem clicou no CTA é contado à parte, não como retenção', () => {
  const curva = curvaDeRetencao([
    { eventName: 'vsl_start', total: 50 },
    { eventName: 'vsl_cta_click', total: 7 },
  ]);
  assert.equal(curva.cliquesNoCta, 7);
  assert.equal(curva.conversao, 14, '7 de 50 é 14%');
  assert.ok(!curva.pontos.some((p) => p.marco === 'cta'));
});

test('o repositório separa a retenção por VSL, não mistura o projeto todo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());

  const empresa = (await database.query(`INSERT INTO companies (name, slug) VALUES ('Alva', 'alva-ret') RETURNING id`)).rows[0].id;
  const dono = (await database.query(`INSERT INTO users (email, password_hash, display_name) VALUES ('r@alva.test','x','R') RETURNING id`)).rows[0].id;
  const projeto = (await database.query(`INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'P','p-ret',$2) RETURNING id`, [empresa, dono])).rows[0].id;
  const site = (await database.query(
    `INSERT INTO analytics_websites (company_id, project_id, tracker_public_id) VALUES ($1,$2,$3)
     ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id
     RETURNING id`,
    [empresa, projeto, 'trk-' + randomUUID().slice(0, 8)],
  )).rows[0].id;

  const repo = new AnalyticsRepository(database);
  const registrar = (publicId, tipo, valor) => repo.ingest({
    websiteId: site, companyId: empresa, projectId: projeto, visitorHash: 'v' + Math.random(),
    event: { type: 'custom', eventName: tipo, urlPath: '/vsl', eventData: { publicId, versionNumber: 1, ...(valor === undefined ? {} : { value: valor }) } },
  });

  await registrar('vsl-a', 'vsl_start');
  await registrar('vsl-a', 'vsl_start');
  await registrar('vsl-a', 'vsl_progress', 25);
  await registrar('vsl-b', 'vsl_start');

  const porVsl = await repo.vslRetention({ companyId: empresa, projectId: projeto, from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) });
  const a = porVsl.find((linha) => linha.publicId === 'vsl-a');
  const b = porVsl.find((linha) => linha.publicId === 'vsl-b');
  assert.equal(a.inicios, 2);
  assert.equal(b.inicios, 1, 'cada VSL tem a própria curva');
});

test('a rota de retenção existe e exige permissão de analytics', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../server/project-api.mjs', import.meta.url), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('const vslRetention = path.match'), fonte.indexOf('const analyticsSummary'));
  assert.match(bloco, /vsl-retention/);
  assert.match(bloco, /authorize\(context, 'analytics\.read', projectId\)/, 'quem não pode ver analytics não vê retenção');
  assert.match(bloco, /analytics\.vslRetention/);
});
