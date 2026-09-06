import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDatabase, migrate } from './db/postgres.mjs';
import { WebhookDeliveryRepository } from './repositories/webhook-repository.mjs';
import { startWebhookWorker } from './webhook-worker.mjs';
import { TrackingRepository } from './repositories/tracking-repository.mjs';
import { NvsClient, UmamiClient } from './tracking-clients.mjs';
import { startTrackingProvisionWorker } from './tracking-provision-worker.mjs';
import { NvsCommercialOutboxRepository } from './repositories/nvs-commercial-outbox-repository.mjs';
import { startCommercialEventsWorker } from './commercial-events-worker.mjs';
import { BillingRepository } from './repositories/billing-repository.mjs';
import { AsaasClient } from './asaas-client.mjs';
import { startBillingWorker } from './billing-worker.mjs';
import { billingRuntimeEnvironment } from './runtime-flags.mjs';

export async function startRuntimeWorker({
  role,
  connectionString = process.env.DATABASE_URL,
  heartbeatFile = process.env.WORKER_HEARTBEAT_FILE || '/tmp/alva-worker-heartbeat.json',
  intervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 10_000),
  webhookIntervalMs = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 5_000),
  createDatabaseFn = createDatabase,
  migrateFn = migrate,
  webhookRepositoryFactory = (database) => new WebhookDeliveryRepository(database),
  startWebhookWorkerFn = startWebhookWorker,
  trackingRepositoryFactory = (database) => new TrackingRepository(database),
  trackingClientsFactory = () => ({ umami: new UmamiClient(), nvs: new NvsClient() }),
  startTrackingWorkerFn = startTrackingProvisionWorker,
  commercialRepositoryFactory = (database) => new NvsCommercialOutboxRepository(database),
  startCommercialWorkerFn = startCommercialEventsWorker,
  billingRepositoryFactory = (database) => new BillingRepository(database),
  startBillingWorkerFn = startBillingWorker,
  billingEnvironment = billingRuntimeEnvironment(),
  billingClientFactory = (environment) => new AsaasClient({ environment, apiKey: environment === 'production' ? process.env.ASAAS_PRODUCTION_API_KEY : process.env.ASAAS_SANDBOX_API_KEY }),
  trackingProvisionEnabled = process.env.TRACKING_PROVISION_ENABLED === 'true',
  nvsRuntimeEnabled = process.env.NVS_RUNTIME_ENABLED === 'true',
  log = console.log,
} = {}) {
  if (!['webhook', 'tracking', 'media', 'billing'].includes(role)) throw new Error('Papel de worker inválido.');
  if (typeof connectionString !== 'string' || !connectionString) throw new Error('DATABASE_URL é obrigatória para o worker.');
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error('Intervalo de heartbeat inválido.');
  if (!Number.isFinite(webhookIntervalMs) || webhookIntervalMs < 1_000) throw new Error('Intervalo da fila de webhook inválido.');

  const database = createDatabaseFn({ connectionString });
  let timer;
  let webhookWorker;
  let trackingWorker;
  let commercialWorker;
  let billingWorker;
  let closed = false;
  try {
    await migrateFn(database);
    if (role === 'webhook') {
      webhookWorker = startWebhookWorkerFn({
        repository: webhookRepositoryFactory(database),
        intervalMs: webhookIntervalMs,
      });
    }
    if (role === 'tracking' && trackingProvisionEnabled) {
      trackingWorker = startTrackingWorkerFn({
        repository: trackingRepositoryFactory(database),
        clients: trackingClientsFactory(),
      });
    }
    if (role === 'tracking' && nvsRuntimeEnabled) {
      commercialWorker = startCommercialWorkerFn({ repository: commercialRepositoryFactory(database), client: new NvsClient() });
    }
    if (role === 'billing') {
      billingWorker = startBillingWorkerFn({ repository: billingRepositoryFactory(database), clientFactory: billingClientFactory });
    }
    const heartbeat = async () => {
      await database.query('SELECT 1');
      await writeFile(heartbeatFile, JSON.stringify({ role, at: new Date().toISOString() }), { mode: 0o600 });
      log(JSON.stringify({ event: 'runtime.worker.heartbeat', role }));
    };
    await heartbeat();
    const runtime = {
      async close(exitCode = 0) {
        if (closed) return exitCode;
        closed = true;
        clearInterval(timer);
        webhookWorker?.stop?.();
        trackingWorker?.stop?.();
      commercialWorker?.stop?.();
      billingWorker?.stop?.();
        await database.close().catch(() => {});
        return exitCode;
      },
    };
    timer = setInterval(() => heartbeat().catch(() => runtime.close(1)), intervalMs);
    return runtime;
  } catch (error) {
    clearInterval(timer);
    webhookWorker?.stop?.();
    trackingWorker?.stop?.();
    commercialWorker?.stop?.();
    billingWorker?.stop?.();
    await database.close().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const role = process.argv.find((argument) => argument.startsWith('--role='))?.slice('--role='.length);
  try {
    const runtime = await startRuntimeWorker({ role });
    const stop = async () => process.exit(await runtime.close());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch {
    process.exitCode = 1;
  }
}
