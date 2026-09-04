import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresFixture } from './postgres-fixture.mjs';

const expectedTables = [
  'users',
  'companies',
  'company_memberships',
  'project_grants',
  'sessions',
  'projects',
  'pages',
  'page_versions',
  'forms',
  'form_versions',
  'form_submissions',
  'project_domains',
  'project_integrations',
  'company_secrets',
  'deployment_runs',
  'audit_events',
];

test('migrador cria as tabelas SaaS e pode ser executado duas vezes', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  try {
    await migrate(database);
    await migrate(database);

    const { rows } = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = new Set(rows.map(({ table_name: tableName }) => tableName));
    for (const tableName of expectedTables) assert.ok(tableNames.has(tableName), `faltou a tabela ${tableName}`);
  } finally {
    await database.close();
  }
});

test('migrador interrompe uma versão já aplicada quando o arquivo muda', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const migrationsPath = await mkdtemp(join(tmpdir(), 'alva-migrations-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(migrationsPath, { recursive: true, force: true })));
  const migrationPath = join(migrationsPath, '001_example.sql');

  try {
    await writeFile(migrationPath, 'CREATE TABLE example_rows (id integer PRIMARY KEY);');
    await migrate(database, { migrationsPath });
    await writeFile(migrationPath, 'CREATE TABLE example_rows (id bigint PRIMARY KEY);');

    await assert.rejects(() => migrate(database, { migrationsPath }), /checksum/i);
  } finally {
    await database.close();
  }
});
