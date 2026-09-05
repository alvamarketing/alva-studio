import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';

import { createDatabase } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

test('pool error handler logs idle client disconnection without leaking credentials', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const entries = [];
  const database = createDatabase({ connectionString, log: (line) => entries.push(line) });

  // Cria um cliente ocioso no pool
  await database.query('SELECT 1');

  // Termina clientes ociosos via backend separado
  const terminator = new Client({ connectionString });
  await terminator.connect();
  await terminator.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()'
  );
  await terminator.end();

  // Aguarda o evento de erro ser capturado (até 5s)
  let attempts = 0;
  while (entries.length === 0 && attempts < 50) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts += 1;
  }

  assert.ok(entries.length > 0, 'pool error deve ter sido logado');

  // Valida estrutura do log
  const entry = entries[0];
  const parsed = JSON.parse(entry);
  assert.equal(parsed.event, 'postgres.pool.error');
  assert.equal(parsed.level, 'error');
  assert.ok(parsed.message, 'mensagem de erro deve estar presente');
  assert.ok(parsed.code === null || typeof parsed.code === 'string', 'code deve ser null ou string');

  // Verifica que não vaza segredo
  const password = new URL(connectionString).password;
  assert.ok(password, 'deve existir senha na connection string de teste');
  assert.ok(!entry.includes(password), 'log não deve conter a senha');
  assert.ok(!entry.includes(connectionString), 'log não deve conter a connection string');

  // Pool deve continuar respondendo
  const result = await database.query('SELECT 1 AS ok');
  assert.equal(result.rows[0].ok, 1);

  await database.close();
});
