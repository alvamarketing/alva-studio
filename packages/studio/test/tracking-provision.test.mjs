import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { processDueTrackingProvisionJobs, MAX_TRACKING_PROVISION_ATTEMPTS } from '../server/tracking-provision-worker.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { createProjectApi } from '../server/project-api.mjs';
import { NvsClient } from '../server/tracking-clients.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function seed(database, suffix) {
  const user = (await database.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id",
    [`${suffix}@alva.test`],
  )).rows[0];
  const company = (await database.query(
    'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${suffix}`, `empresa-${suffix}`],
  )).rows[0];
  const project = (await database.query(
    'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [company.id, `Projeto ${suffix}`, `projeto-${suffix}`, user.id],
  )).rows[0];
  return { user, company, project };
}

test('projeto cria bindings independentes para preview e produção, sem IDs administrativos no DTO', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const first = await seed(database, 'a');
    const second = await seed(database, 'b');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const firstStatus = await repository.status({ companyId: first.company.id, projectId: first.project.id });
    const secondStatus = await repository.status({ companyId: second.company.id, projectId: second.project.id });
    assert.deepEqual(firstStatus.bindings.map((item) => [item.environment, item.engine]).sort(), [
      ['preview', 'nvs'], ['preview', 'umami'], ['production', 'nvs'], ['production', 'umami'],
    ]);
    assert.equal(new Set(firstStatus.bindings.map((item) => item.id)).size, 4);
    assert.notDeepEqual(firstStatus.bindings.map((item) => item.id).sort(), secondStatus.bindings.map((item) => item.id).sort());
    assert.equal(JSON.stringify(firstStatus).includes('remote'), false, 'o DTO não pode revelar referências administrativas');
    await assert.rejects(
      () => repository.status({ companyId: first.company.id, projectId: second.project.id }),
      /Projeto de rastreamento não encontrado/,
    );
  } finally { await database.close(); }
});

test('worker provisiona de forma idempotente, trata falha parcial e não executa lease ainda ativo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'worker');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const calls = [];
    const clients = {
      umami: { provision: async (input) => { calls.push(['umami', input.bindingId]); return { remoteId: input.bindingId }; } },
      nvs: { provision: async () => { calls.push(['nvs']); throw new Error('indisponível'); } },
    };
    const first = await processDueTrackingProvisionJobs({ repository, clients, maxPerRun: 4, now: () => new Date() });
    assert.equal(first.processed, 4);
    assert.equal(calls.filter(([engine]) => engine === 'umami').length, 2);
    const afterFirst = await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id });
    assert.equal(afterFirst.bindings.filter((item) => item.engine === 'umami').every((item) => item.status === 'ready'), true);
    assert.equal(afterFirst.bindings.filter((item) => item.engine === 'nvs').every((item) => item.status === 'pending'), true);
    const claimed = await repository.claimNextDue({ leaseMs: 60_000 });
    assert.equal(claimed.claimed, false, 'backoff impede nova execução imediata');
    const due = await database.query("UPDATE tracking_provision_jobs SET lease_expires_at = now() - interval '1 second', next_attempt_at = now() WHERE status = 'retry' RETURNING id");
    assert.equal(due.rowCount, 2);
    const expired = await repository.claimNextDue({ leaseMs: 60_000 });
    assert.equal(expired.claimed, true, 'lease expirado pode ser recuperado');
    await repository.markRetry({ jobId: expired.job.id, bindingId: expired.job.bindingId, claimToken: expired.token, attemptCount: 1, nextAttemptAt: new Date(Date.now() + 60_000), lastError: 'falha' });
  } finally { await database.close(); }
});

test('falhas consecutivas terminam em dead e retry manual reabre somente o binding solicitado', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'dead');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const clients = { umami: { provision: async () => ({ remoteId: 'ok' }) }, nvs: { provision: async () => { throw new Error('offline'); } } };
    for (let attempt = 0; attempt < MAX_TRACKING_PROVISION_ATTEMPTS; attempt += 1) {
      await database.query("UPDATE tracking_provision_jobs SET next_attempt_at = now(), lease_expires_at = NULL WHERE status IN ('queued', 'retry')");
      await processDueTrackingProvisionJobs({ repository, clients, now: () => new Date('2026-09-06T10:00:00.000Z') });
    }
    const status = await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id });
    const dead = status.bindings.find((item) => item.engine === 'nvs' && item.environment === 'production');
    assert.equal(dead.status, 'dead');
    const retried = await repository.retry({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', engine: 'nvs' });
    assert.equal(retried.status, 'pending');
    const untouched = (await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id })).bindings.find((item) => item.engine === 'nvs' && item.environment === 'preview');
    assert.equal(untouched.status, 'dead');
  } finally { await database.close(); }
});

test('ciphertext de binding é vinculado criptograficamente ao escopo e não aceita troca entre tenants', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const first = await seed(database, 'scope-a');
    const second = await seed(database, 'scope-b');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const binding = (await database.query(
      "SELECT id FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND engine = 'umami'",
      [second.company.id, second.project.id],
    )).rows[0];
    const foreignCiphertext = repository.vault.encrypt('umami-admin-id', `binding:${first.company.id}:${first.project.id}:production:umami`);
    await database.query("UPDATE tracking_provision_jobs SET status = 'succeeded' WHERE company_id IN ($1, $2)", [first.company.id, second.company.id]);
    await database.query("UPDATE tracking_bindings SET encrypted_remote_reference = $2 WHERE id = $1", [binding.id, foreignCiphertext]);
    await database.query("UPDATE tracking_provision_jobs SET status = 'retry', next_attempt_at = now() WHERE binding_id = $1", [binding.id]);
    await assert.rejects(() => repository.claimNextDue(), /conexão|cifrado|ler/i);
  } finally { await database.close(); }
});

test('destinos aceitam somente o contrato NVS e Taboola pode ser ativado sem credenciais', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'providers');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const configurations = {
      meta: { pixel_id: '123', access_token: 'token' },
      tiktok: { pixel_code: 'pixel-code', access_token: 'token' },
      google: { operating_account_id: '123', conversion_action_id: '9', oauth_access_token: 'token' },
      linkedin: { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 'token', linkedin_version: '202608' },
      taboola: {},
    };
    for (const [provider, configuration] of Object.entries(configurations)) await repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider, configuration });
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'taboola', configuration: { account_id: 'não-usado' } }),
      /Configuração do destino inválida/,
    );
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'google', configuration: { operating_account_id: 'account', conversion_action_id: '9', oauth_access_token: 'token' } }),
      /Configuração do destino inválida/,
    );
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'linkedin', configuration: { conversion_urn: 'urn:lla:llaPartnerConversion:bad', access_token: 'token', linkedin_version: '20260' } }),
      /Configuração do destino inválida/,
    );
    const destinations = await repository.nvsDestinations({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations, configurations);
    const requests = [];
    const client = new NvsClient({ baseUrl: 'http://nvs.test', secret: 'segredo-de-teste', now: () => 0, fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ property: { property_id: 'nvs_binding' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    } });
    await client.provision({ propertyId: 'nvs_binding', projectName: 'Projeto', environment: 'production', destinations });
    assert.deepEqual(requests[0].destinations, configurations);
  } finally { await database.close(); }
});

test('API rejeita formato inválido de destino antes de cifrar ou enfileirar provisionamento', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'provider-api');
    const tracking = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const context = { companyId: seeded.company.id, currentProjectId: seeded.project.id, user: { id: seeded.user.id }, role: 'owner' };
    const api = createProjectApi({
      tracking, body: async (req) => req.bodyValue,
      sessionService: { require: async () => context, authorize: async (_context, capability, projectId) => {
        assert.equal(capability, 'integration.manage'); assert.equal(projectId, seeded.project.id);
      } },
    });
    await assert.rejects(
      () => api({ req: { bodyValue: { environment: 'production', configuration: { operating_account_id: 'account', conversion_action_id: '9', oauth_access_token: 'token' } }, url: `/api/projects/${seeded.project.id}/tracking/destinations/google` }, res: {}, path: `/api/projects/${seeded.project.id}/tracking/destinations/google`, method: 'PUT', json: () => {} }),
      /Configuração do destino inválida/,
    );
    const stored = await database.query('SELECT count(*)::int AS count FROM tracking_destinations WHERE company_id = $1 AND project_id = $2', [seeded.company.id, seeded.project.id]);
    assert.equal(stored.rows[0].count, 0);
  } finally { await database.close(); }
});

test('nova publicação exige apenas os bindings dos motores ativos sem invalidar snapshot já publicado', async () => {
  const required = [];
  const ready = { async assertReady(input) { required.push(input.engines); throw Object.assign(new Error('Rastreamento do ambiente ainda não está pronto.'), { status: 409 }); } };
  const service = new PublicationService({
    tracking: ready,
    trackingRequiredEngines: ['umami'],
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [] }) },
    integrations: { credentials: async () => ({ token: 'privado', vercelProjectId: 'vercel' }), publicSettings: async () => ({ connectionStatus: 'configured' }) },
    deployments: { async latest() { return { id: 'snapshot-antigo', status: 'READY' }; }, async latestReady() { return null; } },
  });
  await assert.rejects(
    () => service.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 1 }),
    /rastreamento/i,
  );
  assert.deepEqual(required, [['umami']]);
  const overview = await service.overview({ companyId: 'c', projectId: 'p' });
  assert.equal(overview.production.id, 'snapshot-antigo');
});

test('gate de publicação falha fechado quando há motores obrigatórios sem repositório', async () => {
  const service = new PublicationService({ trackingRequiredEngines: ['nvs'] });
  await assert.rejects(() => service.requireTracking({ companyId: 'c', projectId: 'p' }, 'preview'), /rastreamento/i);
});

test('API de tracking exige integration.manage e nunca serializa dados administrativos', async () => {
  const calls = [];
  const tracking = {
    async ensureJobs(input) { calls.push(['provision', input]); return { bindings: [{ id: 'publico', environment: 'preview', engine: 'umami', status: 'pending' }] }; },
    async status(input) { calls.push(['status', input]); return { bindings: [] }; },
    async retry(input) { calls.push(['retry', input]); return { id: 'publico', environment: input.environment, engine: input.engine, status: 'pending' }; },
    async saveDestination(input) { calls.push(['destination', input]); return { provider: input.provider, environment: input.environment, configured: true }; },
  };
  const context = { companyId: 'company-a', currentProjectId: 'project-a', user: { id: 'user-a' }, role: 'owner' };
  const sessionService = { require: async () => context, authorize: async (_context, capability, projectId) => {
    if (projectId !== 'project-a') throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
    if (capability !== 'integration.manage') throw new Error('capacidade errada');
  } };
  const api = createProjectApi({ sessionService, tracking, body: async (req) => req.bodyValue });
  const invoke = async (path, method, bodyValue = {}) => {
    let result;
    await api({ req: { bodyValue, url: path }, res: {}, path, method, json: (data, status = 200) => { result = { data, status }; } });
    return result;
  };
  const provision = await invoke('/api/projects/project-a/tracking/provision', 'POST');
  assert.equal(provision.status, 202);
  assert.equal(JSON.stringify(provision.data).includes('remote'), false);
  await invoke('/api/projects/project-a/tracking/retry', 'POST', { environment: 'production', engine: 'nvs' });
  await invoke('/api/projects/project-a/tracking/destinations/meta', 'PUT', { environment: 'production', configuration: { pixel_id: 'pixel-1' } });
  assert.deepEqual(calls.map(([name]) => name), ['provision', 'retry', 'destination']);
  const forbidden = createProjectApi({ sessionService: { ...sessionService, authorize: async () => { throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 }); } }, tracking, body: async () => ({}) });
  await assert.rejects(
    () => forbidden({ req: { url: '/api/projects/project-a/tracking/status' }, res: {}, path: '/api/projects/project-a/tracking/status', method: 'GET', json: () => {} }),
    (error) => error.status === 403,
  );
});
