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

test('worker de tracking consome a fila fora do processo web', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-runtime-tracking-worker-'));
  const heartbeatFile = join(directory, 'heartbeat.json');
  const calls = [];
  const database = { query: async (sql) => calls.push(sql), close: async () => calls.push('close') };
  let stopped = false;
  const runtime = await startRuntimeWorker({
    role: 'tracking', connectionString: 'postgres://nao-registre-esta-url', heartbeatFile,
    createDatabaseFn: () => database, migrateFn: async () => calls.push('migrate'),
    trackingRepositoryFactory: (value) => ({ database: value }),
    trackingClientsFactory: () => ({ umami: {}, nvs: {} }),
    startTrackingWorkerFn: ({ repository, clients }) => { assert.equal(repository.database, database); assert.ok(clients.umami); calls.push('tracking-worker'); return { stop: () => { stopped = true; } }; }, trackingProvisionEnabled: true,
    log: () => {},
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(calls.slice(0, 3), ['migrate', 'tracking-worker', 'SELECT 1']);
  await runtime.close();
  assert.equal(stopped, true);
});

test('worker de tracking permanece em heartbeat sem consumir fila enquanto a flag está desligada', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-runtime-tracking-disabled-'));
  const heartbeatFile = join(directory, 'heartbeat.json');
  let started = false;
  const runtime = await startRuntimeWorker({
    role: 'tracking', connectionString: 'postgres://nao-registre-esta-url', heartbeatFile,
    createDatabaseFn: () => ({ query: async () => {}, close: async () => {} }), migrateFn: async () => {},
    startTrackingWorkerFn: () => { started = true; return { stop: () => {} }; }, log: () => {},
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(started, false);
  await runtime.close();
});

test('worker de tracking inicia a outbox comercial somente com a flag NVS literal', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-runtime-commercial-worker-'));
  const heartbeatFile = join(directory, 'heartbeat.json'); let started = false;
  const runtime = await startRuntimeWorker({
    role: 'tracking', connectionString: 'postgres://nao-registre-esta-url', heartbeatFile,
    createDatabaseFn: () => ({ query: async () => {}, close: async () => {} }), migrateFn: async () => {},
    commercialRepositoryFactory: () => ({ queue: true }),
    startCommercialWorkerFn: ({ repository }) => { assert.equal(repository.queue, true); started = true; return { stop: () => {} }; },
    nvsRuntimeEnabled: true, log: () => {},
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(started, true);
  await runtime.close();
});

test('runtime Compose declara o worker contínuo NVS, bancos privados e imagens fixadas', async () => {
  const compose = await readFile(join(root, 'runtime/compose.yaml'), 'utf8');
  for (const service of ['studio-web', 'studio-worker', 'studio-media-worker', 'studio-tracking-worker', 'studio-postgres', 'umami', 'umami-postgres', 'nvs', 'nvs-outbox-worker', 'nvs-mariadb'])
    assert.match(compose, new RegExp(`^  ${service}:`, 'm'));
  assert.match(compose, /127\.0\.0\.1:4178:4178/);
  assert.match(compose, /PUBLIC_ORIGIN: \$\{PUBLIC_ORIGIN:\?Defina PUBLIC_ORIGIN HTTPS no ambiente do Coolify\}/);
  assert.match(compose, /WEBHOOK_WORKER_ENABLED: "false"/);
  assert.match(compose, /TRACKING_PROVISION_ENABLED: \$\{TRACKING_PROVISION_ENABLED:-false\}/);
  assert.match(compose, /UMAMI_RUNTIME_ENABLED: \$\{UMAMI_RUNTIME_ENABLED:-false\}/);
  assert.match(compose, /NVS_RUNTIME_ENABLED: \$\{NVS_RUNTIME_ENABLED:-false\}/);
  assert.match(compose, /PIXELS_ENABLED: \$\{PIXELS_ENABLED:-false\}/);
  assert.match(compose, /PUBLICATION_RUNTIME_HMAC_SECRET: \$\{PUBLICATION_RUNTIME_HMAC_SECRET:-\}/);
  assert.match(compose, /TRACKING_MASTER_KEY: \$\{TRACKING_MASTER_KEY:\?Defina TRACKING_MASTER_KEY no ambiente do Coolify\}/);
  assert.match(compose, /dockerfile: runtime\/Dockerfile\.umami/);
  assert.match(compose, /UMAMI_USERNAME: \$\{UMAMI_USERNAME:\?Defina UMAMI_USERNAME no ambiente do Coolify\}/);
  assert.match(compose, /mariadb:11\.4@sha256:611a2fcc5fa7c6ceb8644c6f74b25ede004ff6c3a6b38c8f8c23d3bbf6c26430/);
  assert.match(compose, /postgres:16\.6-alpine3\.21@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef/);
  const studioDockerfile = await readFile(join(root, 'runtime/Dockerfile.studio'), 'utf8');
  const nvsDockerfile = await readFile(join(root, 'runtime/Dockerfile.nvs'), 'utf8');
  assert.match(studioDockerfile, /node:22\.14\.0-alpine3\.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944/);
  assert.match(nvsDockerfile, /php:8\.3\.15-cli-bookworm@sha256:0d3656c146a6a11c715b5d35169d80ffe1f67d6ae77ed39a1331f6889f794269/);
  const [umamiDockerfile, umamiBootstrap, umamiContract] = await Promise.all([
    readFile(join(root, 'runtime/Dockerfile.umami'), 'utf8'), readFile(join(root, 'runtime/umami-bootstrap.mjs'), 'utf8'), readFile(join(root, 'runtime/umami-contract-test.sh'), 'utf8'),
  ]);
  assert.match(umamiDockerfile, /umami:3\.3\.1@sha256:fa32d116cf20cad52cbc3fad9a63b46e7fa02299d8f967168eb453d49c476b4a/);
  assert.match(umamiDockerfile, /postgresql18-client=18\.6-r0/);
  assert.match(umamiBootstrap, /crypt\(:'technical_password', gen_salt\('bf'\)\)/);
  assert.match(umamiBootstrap, /'user', 'Tracking Provisioner'/);
  assert.match(umamiBootstrap, /\\\\getenv technical_password UMAMI_PASSWORD/);
  assert.match(umamiBootstrap, /spawn\('psql', \['-v', 'ON_ERROR_STOP=1'\]/);
  assert.match(umamiBootstrap, /\/proc\/\$\{child\.pid\}\/cmdline/);
  assert.doesNotMatch(umamiBootstrap, /--set=technical_password/);
  assert.doesNotMatch(umamiBootstrap, /psql \"\$DATABASE_URL\"/);
  assert.match(umamiBootstrap, /DELETE FROM "user"/);
  assert.match(umamiContract, /payload\.id !== website\.id/);
  assert.match(umamiContract, /duplicate\.status !== 500/);
  assert.match(umamiContract, /UMAMI_BOOTSTRAP_ASSERT_ARGV=true/);
  assert.match(umamiContract, /SELECT role FROM .*tracking-provisioner/);
  assert.match(umamiContract, /SELECT NOT EXISTS \(SELECT 1 FROM .*username = 'admin'/);
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
  assert.match(restore, /compose stop studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker/);
  assert.match(restore, /compose start studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker/);
  assert.match(restore, /writers_stopped=true\ncompose stop/);
  assert.match(restore, /compose start studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker\nwriters_stopped=false/);
  assert.match(restore, /pg_isready -U studio -d studio/);
  assert.match(restore, /pg_isready -U umami -d umami/);
  assert.match(restore, /mariadb-admin ping/);
  assert.match(runbook, /executa a fila de webhooks/);
  assert.match(runbook, /não é atômica entre os três bancos/);
});
