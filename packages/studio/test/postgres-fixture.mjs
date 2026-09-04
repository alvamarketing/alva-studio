import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';

const exec = promisify(execFile);

async function docker(...args) {
  return exec('docker', args, { encoding: 'utf8' });
}

async function waitForPostgres(containerId, connectionString, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await docker('exec', containerId, 'pg_isready', '--username=studio', '--dbname=studio_test');
      const client = new Client({ connectionString });
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

export async function postgresFixture(t) {
  const password = randomUUID();
  const { stdout } = await docker(
    'run',
    '--detach',
    '--rm',
    '--env',
    'POSTGRES_USER=studio',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_DB=studio_test',
    '--publish',
    '127.0.0.1::5432',
    'postgres:alpine',
  );
  const containerId = stdout.trim();
  t.after(async () => {
    await docker('rm', '--force', containerId).catch(() => {});
  });
  const { stdout: portOutput } = await docker('port', containerId, '5432/tcp');
  const port = portOutput.trim().match(/:(\d+)$/)?.[1];
  if (!port) throw new Error('Não foi possível descobrir a porta PostgreSQL de teste.');
  const connectionString = `postgresql://studio:${password}@127.0.0.1:${port}/studio_test`;
  await waitForPostgres(containerId, connectionString);
  return { connectionString };
}
