import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresFixture } from './postgres-fixture.mjs';

const MIGRACOES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db', 'migrations');

// Migrar um banco vazio não prova nada sobre uma migração que renomeia e limpa: o caminho
// que interessa é o de quem já tinha dados. Aqui o banco é levado até a 022, recebe o
// estado antigo — bindings de dois motores externos, fila endereçada ao gateway — e só
// então a 023 entra.
async function bancoAntesDa023(t, connectionString) {
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const anteriores = await mkdtemp(path.join(tmpdir(), 'alva-migracoes-'));
  for (const arquivo of (await readdir(MIGRACOES)).filter((nome) => nome < '023')) {
    await copyFile(path.join(MIGRACOES, arquivo), path.join(anteriores, arquivo));
  }
  const database = createDatabase({ connectionString });
  t.after(() => database.close());
  await migrate(database, { migrationsPath: anteriores });
  return { database, migrate };
}

async function estadoAntigo(database) {
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('023@alva.test', 'hash', 'Pessoa') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Migração', 'migracao-023') RETURNING id")).rows[0];
  const project = (await database.query(
    "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', 'projeto-023', $2) RETURNING id",
    [company.id, user.id],
  )).rows[0];
  await database.query('SELECT enqueue_tracking_provisioning_for_project($1, $2)', [company.id, project.id]);
  await database.query(
    "UPDATE tracking_bindings SET status = 'ready', encrypted_remote_reference = 'segredo-selado-no-escopo-antigo', provision_attempt_count = 2 WHERE company_id = $1",
    [company.id],
  );
  await database.query(
    `INSERT INTO nvs_commercial_outbox (company_id, project_id, environment, property_id, tracking_event_id, event_name, payload, status)
     VALUES ($1, $2, 'production', 'nvs_prop', 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', 'lead', '{}'::jsonb, 'queued')`,
    [company.id, project.id],
  );
  return { company, project };
}

test('a 023 renomeia a fila e apaga o nome antigo de tabela, índices e constraints', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { database, migrate } = await bancoAntesDa023(t, connectionString);
  await estadoAntigo(database);
  await migrate(database);

  const tabelas = (await database.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%outbox%'",
  )).rows.map((linha) => linha.tablename);
  assert.ok(tabelas.includes('conversions_outbox'), `esperava conversions_outbox, veio ${tabelas}`);
  assert.equal(tabelas.includes('nvs_commercial_outbox'), false, 'o nome antigo não pode sobreviver');

  // Renomear a tabela não renomeia o que pende dela: sem isso o nome morto voltaria em
  // cada erro de restrição que o banco escrevesse.
  const nomes = (await database.query(
    `SELECT indexname AS nome FROM pg_indexes WHERE schemaname='public' AND tablename='conversions_outbox'
     UNION ALL
     SELECT conname FROM pg_constraint WHERE conrelid='conversions_outbox'::regclass`,
  )).rows.map((linha) => linha.nome);
  assert.ok(nomes.includes('conversions_outbox_due'));
  assert.ok(nomes.includes('conversions_outbox_project'));
  assert.deepEqual(nomes.filter((nome) => nome.includes('nvs')), [], `sobrou nome antigo: ${nomes}`);
});

test('a 023 deixa um motor só, sem binding de Umami e sem segredo que ninguém consegue abrir', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { database, migrate } = await bancoAntesDa023(t, connectionString);
  const { company } = await estadoAntigo(database);
  await migrate(database);

  const bindings = (await database.query(
    'SELECT engine, environment, status, encrypted_remote_reference, provision_attempt_count FROM tracking_bindings WHERE company_id = $1 ORDER BY environment',
    [company.id],
  )).rows;
  assert.deepEqual(bindings.map((linha) => [linha.environment, linha.engine]), [['preview', 'conversions'], ['production', 'conversions']]);

  // A referência remota era cifrada com o nome do motor como dado autenticado. Renomear o
  // motor e manter o ciphertext deixaria um segredo impossível de abrir, e a falha só
  // apareceria na primeira conversão. Zerar manda o binding provisionar de novo.
  assert.deepEqual(bindings.map((linha) => linha.encrypted_remote_reference), [null, null]);
  assert.deepEqual(bindings.map((linha) => [linha.status, linha.provision_attempt_count]), [['pending', 0], ['pending', 0]]);
  const jobs = (await database.query("SELECT status, attempt_count FROM tracking_provision_jobs WHERE company_id = $1", [company.id])).rows;
  assert.deepEqual(jobs.map((linha) => [linha.status, linha.attempt_count]), [['queued', 0], ['queued', 0]]);

  await assert.rejects(
    () => database.query("INSERT INTO tracking_bindings (company_id, project_id, environment, engine) SELECT company_id, project_id, 'preview', 'umami' FROM tracking_bindings LIMIT 1"),
    /engine_check/,
    'o motor do Umami não pode voltar a ser aceito',
  );
});

test('a 023 troca o destino do gateway pelo destino de verdade e não deixa entrega órfã', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { database, migrate } = await bancoAntesDa023(t, connectionString);
  const { company, project } = await estadoAntigo(database);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM nvs_commercial_outbox')).rows[0].n, 1);
  await migrate(database);

  // A linha endereçada ao gateway não tem mais destino que exista — o serviço que a
  // consumia saiu do projeto. Ela é trabalho de fila, não registro de negócio.
  assert.equal((await database.query('SELECT count(*)::int AS n FROM conversions_outbox')).rows[0].n, 0);

  const inserir = (destino) => database.query(
    `INSERT INTO conversions_outbox (company_id, project_id, environment, property_id, tracking_event_id, event_name, destination, payload)
     VALUES ($1, $2, 'production', 'alva_prop', 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', 'lead', $3, '{}'::jsonb)`,
    [company.id, project.id, destino],
  );
  await inserir('meta');
  await inserir('tiktok');
  await assert.rejects(() => inserir('nvs'), /destination_check/, 'o gateway não pode voltar a ser um destino');
  // A identidade da entrega inclui o destino: o mesmo evento cabe uma vez por plataforma.
  await assert.rejects(() => inserir('meta'), /conversions_outbox_identity_key|duplicate key/);
});

test('projeto novo nasce pedindo apenas o motor de conversões', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { database, migrate } = await bancoAntesDa023(t, connectionString);
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('depois@alva.test', 'hash', 'Pessoa') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Depois', 'depois-023') RETURNING id")).rows[0];
  const project = (await database.query(
    "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', 'projeto-depois', $2) RETURNING id",
    [company.id, user.id],
  )).rows[0];
  await database.query('SELECT enqueue_tracking_provisioning_for_project($1, $2)', [company.id, project.id]);
  const bindings = (await database.query(
    'SELECT environment, engine FROM tracking_bindings WHERE company_id = $1 ORDER BY environment', [company.id],
  )).rows;
  assert.deepEqual(bindings.map((linha) => [linha.environment, linha.engine]), [['preview', 'conversions'], ['production', 'conversions']]);
});
