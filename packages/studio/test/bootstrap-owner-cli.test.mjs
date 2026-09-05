import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const cliPath = fileURLToPath(new URL('../server/bootstrap-owner.mjs', import.meta.url));

function runCli({ env, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function counts(database) {
  const { rows } = await database.query(`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM companies)::int AS companies,
           (SELECT count(*) FROM company_memberships WHERE role = 'owner' AND status = 'active')::int AS owners,
           (SELECT count(*) FROM projects)::int AS projects
  `);
  return rows[0];
}

test('CLI cria a conta inicial lendo a senha do stdin, é idempotente e não vaza a senha', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const password = 'senha-cli-super-secreta';
  const env = {
    ...process.env,
    DATABASE_URL: connectionString,
    OWNER_NAME: 'Proprietário CLI',
    OWNER_EMAIL: 'cli@alva.test',
    OWNER_COMPANY_NAME: 'Alva CLI',
  };

  const first = await runCli({ env, input: password });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /cli@alva\.test/);
  assert.doesNotMatch(first.stdout, new RegExp(password));
  assert.doesNotMatch(first.stderr, new RegExp(password));

  const database = createDatabase({ connectionString });
  try {
    assert.deepEqual(await counts(database), { users: 1, companies: 1, owners: 1, projects: 1 });

    const second = await runCli({ env, input: password });
    assert.equal(second.code, 0, second.stderr);
    assert.doesNotMatch(second.stdout, new RegExp(password));
    assert.deepEqual(await counts(database), { users: 1, companies: 1, owners: 1, projects: 1 });
  } finally {
    await database.close();
  }
});

test('CLI falha com mensagem genérica quando DATABASE_URL está ausente, sem vazar segredos', async () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const result = await runCli({ env, input: 'qualquer-senha' });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /qualquer-senha/);
  assert.doesNotMatch(result.stderr, /postgres(ql)?:\/\//);
});
