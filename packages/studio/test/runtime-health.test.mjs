import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { startRuntimeWorker } from '../server/runtime-worker.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const exec = promisify(execFile);

async function request(server, path) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`);
}

test('health live responde sem depender do banco e readiness exige banco acessível', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'alva-runtime-health-'));
  const unavailable = createApp({ dataDir, database: { query: async () => { throw new Error('indisponível'); } } });
  await new Promise((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => unavailable.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const live = await request(unavailable, '/health/live');
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'live' });
  const ready = await request(unavailable, '/health/ready');
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'not_ready' });
});

test('health readiness confirma uma consulta ao banco sem expor detalhes', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'alva-runtime-ready-'));
  const calls = [];
  const app = createApp({ dataDir, database: { query: async (sql) => calls.push(sql) } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => app.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const ready = await request(app, '/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  assert.deepEqual(calls, ['SELECT 1']);
});

test('healthcheck do worker só aceita heartbeat recente de um processo identificado', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-worker-heartbeat-'));
  const heartbeatFile = join(directory, 'heartbeat.json');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = () => exec(process.execPath, ['packages/studio/server/runtime-worker-healthcheck.mjs'], {
    cwd: root,
    env: { ...process.env, WORKER_HEARTBEAT_FILE: heartbeatFile, WORKER_HEARTBEAT_MAX_AGE_MS: '1000' },
  });

  await assert.rejects(run());
  await writeFile(heartbeatFile, JSON.stringify({ role: 'webhook', at: new Date().toISOString() }));
  await run();
  await writeFile(heartbeatFile, JSON.stringify({ role: 'webhook', at: new Date(Date.now() - 2_000).toISOString() }));
  await assert.rejects(run());
});

test('worker de webhook inicializa a fila real fora do processo web', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-runtime-worker-'));
  const heartbeatFile = join(directory, 'heartbeat.json');
  const calls = [];
  const database = {
    query: async (sql) => calls.push(sql),
    close: async () => calls.push('close'),
  };
  let workerStopped = false;
  const runtime = await startRuntimeWorker({
    role: 'webhook',
    connectionString: 'postgres://nao-registre-esta-url',
    heartbeatFile,
    createDatabaseFn: () => database,
    migrateFn: async () => calls.push('migrate'),
    webhookRepositoryFactory: (value) => ({ database: value }),
    startWebhookWorkerFn: ({ repository }) => {
      assert.equal(repository.database, database);
      calls.push('webhook-worker');
      return { stop: () => { workerStopped = true; } };
    },
    log: () => {},
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(calls.slice(0, 3), ['migrate', 'webhook-worker', 'SELECT 1']);
  await runtime.close();
  assert.equal(workerStopped, true);
  assert.equal(calls.at(-1), 'close');
});

test('runtime Compose declara o worker contínuo NVS, bancos privados e imagens fixadas', async () => {
  const compose = await readFile(join(root, 'runtime/compose.yaml'), 'utf8');
  for (const service of ['studio-web', 'studio-worker', 'studio-media-worker', 'studio-postgres', 'umami', 'umami-postgres', 'nvs', 'nvs-outbox-worker', 'nvs-mariadb'])
    assert.match(compose, new RegExp(`^  ${service}:`, 'm'));
  assert.match(compose, /127\.0\.0\.1:4178:4178/);
  assert.match(compose, /PUBLIC_ORIGIN: \$\{PUBLIC_ORIGIN:\?Defina PUBLIC_ORIGIN HTTPS no ambiente do Coolify\}/);
  assert.match(compose, /WEBHOOK_WORKER_ENABLED: "false"/);
  assert.match(compose, /ghcr\.io\/umami-software\/umami:3\.3\.1@sha256:fa32d116cf20cad52cbc3fad9a63b46e7fa02299d8f967168eb453d49c476b4a/);
  assert.match(compose, /mariadb:11\.4@sha256:611a2fcc5fa7c6ceb8644c6f74b25ede004ff6c3a6b38c8f8c23d3bbf6c26430/);
  assert.match(compose, /postgres:16\.6-alpine3\.21@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef/);
  const studioDockerfile = await readFile(join(root, 'runtime/Dockerfile.studio'), 'utf8');
  const nvsDockerfile = await readFile(join(root, 'runtime/Dockerfile.nvs'), 'utf8');
  assert.match(studioDockerfile, /node:22\.14\.0-alpine3\.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944/);
  assert.match(nvsDockerfile, /php:8\.3\.15-cli-bookworm@sha256:0d3656c146a6a11c715b5d35169d80ffe1f67d6ae77ed39a1331f6889f794269/);
  assert.doesNotMatch(compose, /^networks:/m);
  assert.match(compose, /\/api\/heartbeat/);
  assert.match(compose, /NVS_MARIADB_HOST: nvs-mariadb/);
  for (const database of ['studio-postgres', 'umami-postgres', 'nvs-mariadb']) {
    const body = compose.slice(compose.indexOf(`  ${database}:`), compose.indexOf('\n  ', compose.indexOf(`  ${database}:`) + 3));
    assert.doesNotMatch(body, /^    ports:/m, `${database} não pode publicar porta`);
  }
});

test('runbook e scripts tratam backup e restauração dos três bancos com confirmação explícita', async () => {
  const [backup, restore, runbook] = await Promise.all([
    readFile(join(root, 'runtime/backup.sh'), 'utf8'),
    readFile(join(root, 'runtime/restore.sh'), 'utf8'),
    readFile(join(root, 'runtime/RUNBOOK.md'), 'utf8'),
  ]);
  for (const name of ['studio-postgres.sql', 'umami-postgres.sql', 'nvs-mariadb.sql']) {
    assert.match(backup, new RegExp(name));
    assert.match(restore, new RegExp(name));
  }
  assert.match(restore, /--confirm-restore/);
  assert.match(backup, /--env-file/);
  assert.match(backup, /--project-name/);
  assert.match(restore, /--env-file/);
  assert.match(restore, /--project-name/);
  assert.match(backup, /mariadb-dump .* nvs/);
  assert.doesNotMatch(backup, /--all-databases/);
  assert.match(restore, /compose stop studio-web studio-worker studio-media-worker umami nvs nvs-outbox-worker/);
  assert.match(restore, /compose start studio-web studio-worker studio-media-worker umami nvs nvs-outbox-worker/);
  assert.match(restore, /writers_stopped=true\ncompose stop/);
  assert.match(restore, /compose start studio-web studio-worker studio-media-worker umami nvs nvs-outbox-worker\nwriters_stopped=false/);
  assert.match(restore, /pg_isready -U studio -d studio/);
  assert.match(restore, /pg_isready -U umami -d umami/);
  assert.match(restore, /mariadb-admin ping/);
  assert.match(runbook, /executa a fila de webhooks/);
  assert.match(runbook, /não é atômica entre os três bancos/);
});
