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
    trackingClientsFactory: () => ({ conversions: {} }),
    startTrackingWorkerFn: ({ repository, clients }) => { assert.equal(repository.database, database); assert.ok(clients.conversions); calls.push('tracking-worker'); return { stop: () => { stopped = true; } }; }, trackingProvisionEnabled: true,
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

test('worker de tracking inicia a outbox comercial somente com a flag de conversões', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alva-runtime-commercial-worker-'));
  const heartbeatFile = join(directory, 'heartbeat.json'); let started = false;
  const runtime = await startRuntimeWorker({
    role: 'tracking', connectionString: 'postgres://nao-registre-esta-url', heartbeatFile,
    createDatabaseFn: () => ({ query: async () => {}, close: async () => {} }), migrateFn: async () => {},
    commercialRepositoryFactory: () => ({ queue: true }),
    // O cliente entrega direto aos destinos e por isso lê credencial cifrada; injetá-lo
    // mantém o teste sobre o que ele afirma — que a flag liga o worker.
    commercialClientFactory: () => ({ sendEvent: async () => {} }),
    startCommercialWorkerFn: ({ repository, client }) => { assert.equal(repository.queue, true); assert.ok(client.sendEvent); started = true; return { stop: () => {} }; },
    conversoesHabilitadas: true, log: () => {},
  });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(started, true);
  await runtime.close();
});

test('runtime Compose declara os serviços do Studio, o banco privado e imagens fixadas', async () => {
  const compose = await readFile(join(root, 'runtime/compose.yaml'), 'utf8');
  for (const service of ['studio-web', 'studio-worker', 'studio-postgres'])
    assert.match(compose, new RegExp(`^  ${service}:`, 'm'));
  assert.match(compose, /127\.0\.0\.1:4178:4178/);
  assert.match(compose, /PUBLIC_ORIGIN: \$\{PUBLIC_ORIGIN:\?Defina PUBLIC_ORIGIN HTTPS no ambiente do Coolify\}/);
  assert.match(compose, /WEBHOOK_WORKER_ENABLED: "false"/);
  assert.match(compose, /TRACKING_PROVISION_ENABLED: \$\{TRACKING_PROVISION_ENABLED:-false\}/);
  assert.match(compose, /PIXELS_ENABLED: \$\{PIXELS_ENABLED:-false\}/);
  assert.match(compose, /PUBLICATION_RUNTIME_HMAC_SECRET: \$\{PUBLICATION_RUNTIME_HMAC_SECRET:-\}/);
  assert.match(compose, /TRACKING_MASTER_KEY: \$\{TRACKING_MASTER_KEY:\?Defina TRACKING_MASTER_KEY no ambiente do Coolify\}/);
  assert.match(compose, /VERCEL_MASTER_KEY: \$\{VERCEL_MASTER_KEY:\?Defina VERCEL_MASTER_KEY no ambiente do Coolify\}/);
  const envExample = await readFile(join(root, 'runtime/.env.example'), 'utf8');
  assert.match(envExample, /^VERCEL_MASTER_KEY=\S+$/m);
  const indexSource = await readFile(join(root, 'packages/studio/server/index.mjs'), 'utf8');
  assert.match(indexSource, /process\.env\.VERCEL_MASTER_KEY/);
  assert.match(compose, /postgres:16\.6-alpine3\.21@sha256:1d04b9ba1d4996401f2552b51beda8187f175c0645c091e4781134fc9c9a3eef/);
  const studioDockerfile = await readFile(join(root, 'runtime/Dockerfile.studio'), 'utf8');
  assert.match(studioDockerfile, /node:22\.14\.0-alpine3\.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944/);
  assert.doesNotMatch(compose, /^networks:/m);
  for (const database of ['studio-postgres']) {
    const body = compose.slice(compose.indexOf(`  ${database}:`), compose.indexOf('\n  ', compose.indexOf(`  ${database}:`) + 3));
    assert.doesNotMatch(body, /^    ports:/m, `${database} não pode publicar porta`);
  }
});

test('runbook e scripts tratam backup e restauração do banco com confirmação explícita', async () => {
  const [backup, restore, runbook, localRestore] = await Promise.all([
    readFile(join(root, 'runtime/backup.sh'), 'utf8'),
    readFile(join(root, 'runtime/restore.sh'), 'utf8'),
    readFile(join(root, 'runtime/RUNBOOK.md'), 'utf8'),
    readFile(join(root, 'runtime/backup-restore-local-test.sh'), 'utf8'),
  ]);
  for (const name of ['studio-postgres.sql']) {
    assert.match(backup, new RegExp(name));
    assert.match(restore, new RegExp(name));
  }
  assert.match(restore, /--confirm-restore/);
  assert.match(backup, /--env-file/);
  assert.match(backup, /--project-name/);
  assert.match(restore, /--env-file/);
  assert.match(restore, /--project-name/);
  assert.doesNotMatch(backup, /--all-databases/);
  assert.match(restore, /writer_services='studio-web studio-worker'/);
  assert.match(restore, /compose ps --status running -q/);
  assert.match(restore, /active_writers/);
  assert.doesNotMatch(restore, /compose stop studio-web studio-worker/);
  assert.match(restore, /pg_isready -U studio -d studio/);
  assert.match(runbook, /executa a fila de webhooks/);
  // Eram três bancos, e o aviso existia porque o backup não podia ser atômico entre eles.
  // Sobrou um: o runbook precisa dizer isso, em vez de manter um risco que saiu com o Umami
  // e o NVS.
  assert.match(runbook, /Com um só banco, a restauração é atômica/);
  assert.doesNotMatch(runbook, /três bancos/);
  // O proxy local saiu junto: quem dá domínio e certificado é o OrbStack.
  assert.match(runbook, /https:\/\/alva\.orb\.local/);
  assert.match(localRestore, /--pull never/);
  assert.match(localRestore, /backup\.sh/);
  assert.match(localRestore, /restore\.sh/);
  assert.match(localRestore, /studio-postgres/);
});

// Quatro containers rodavam o mesmo arquivo com --role diferente, e um deles, o de mídia,
// não tinha bloco de trabalho nenhum: subia, migrava e batia heartbeat para sempre. Um
// processo só com todos os papéis faz o mesmo serviço, porque os blocos já eram
// independentes entre si.
test('um worker só assume vários papéis ao mesmo tempo', async () => {
  const iniciados = [];
  const database = { query: async () => ({ rows: [] }), close: async () => {} };
  const heartbeatFile = join(await mkdtemp(join(tmpdir(), 'alva-worker-')), 'heartbeat.json');
  const runtime = await startRuntimeWorker({
    role: 'webhook,tracking,billing',
    connectionString: 'postgres://nao-registre-esta-url',
    heartbeatFile,
    createDatabaseFn: () => database,
    migrateFn: async () => {},
    webhookRepositoryFactory: () => ({}),
    startWebhookWorkerFn: () => { iniciados.push('webhook'); return { stop() {} }; },
    trackingRepositoryFactory: () => ({}),
    trackingClientsFactory: () => ({}),
    startTrackingWorkerFn: () => { iniciados.push('tracking'); return { stop() {} }; },
    billingRepositoryFactory: () => ({}),
    startBillingWorkerFn: () => { iniciados.push('billing'); return { stop() {} }; },
    trackingProvisionEnabled: true,
    log: () => {},
  });
  await runtime.close();
  assert.deepEqual(iniciados.sort(), ['billing', 'tracking', 'webhook']);
});

test('o papel de mídia é recusado, porque nunca teve trabalho para fazer', async () => {
  await assert.rejects(
    () => startRuntimeWorker({ role: 'media', connectionString: 'postgres://x', log: () => {} }),
    /papel de worker/i,
  );
});
