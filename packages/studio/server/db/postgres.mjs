import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const defaultMigrationsPath = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function createDatabase({ connectionString, log = console.error }) {
  if (typeof connectionString !== 'string' || !connectionString) throw new Error('Informe a conexão PostgreSQL.');
  const pool = new Pool({ connectionString });

  pool.on('error', (err) => {
    log(JSON.stringify({
      level: 'error',
      event: 'postgres.pool.error',
      message: err.message,
      code: err.code ?? null,
    }));
  });

  return {
    query: (...args) => pool.query(...args),
    close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function withTransaction(database, fn) {
  if (!database || typeof database.transaction !== 'function') throw new Error('Banco inválido para transação.');
  return database.transaction(fn);
}

async function migrationsFrom(migrationsPath) {
  const names = (await readdir(migrationsPath)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  return Promise.all(
    names.map(async (name) => ({
      version: name.slice(0, name.indexOf('_')),
      name,
      content: await readFile(join(migrationsPath, name), 'utf8'),
    })),
  );
}

export async function migrate(database, { migrationsPath = defaultMigrationsPath } = {}) {
  if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para migração.');
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(80) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const migrations = await migrationsFrom(migrationsPath);
  await withTransaction(database, async (client) => {
    await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    for (const migration of migrations) {
      const digest = checksum(migration.content);
      const applied = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [migration.version]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== digest)
          throw new Error(`Checksum da migração ${migration.version} não confere com a versão aplicada.`);
        continue;
      }
      await client.query(migration.content);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migration.version, digest]);
    }
  });
}
