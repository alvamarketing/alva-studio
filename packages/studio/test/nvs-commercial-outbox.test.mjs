import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { NvsCommercialOutboxRepository } from '../server/repositories/nvs-commercial-outbox-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function seed(database) {
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('task6@alva.test', 'hash', 'Task 6') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Task 6', 'task-6') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Conversões', 'conversoes', $2) RETURNING id", [company.id, user.id])).rows[0];
  return { user, company, project };
}

function scope(ids, environment) { return `tracking-binding:${ids.company.id}:${ids.project.id}:${environment}:nvs`; }

test('outbox comercial deriva propriedade preview, hasheia contato e deduplica retries', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const ids = await seed(database);
    const vault = new SecretVault({ masterKey: 'task-6-master-key' });
    await database.query(
      `UPDATE tracking_bindings SET status = 'ready', encrypted_remote_reference = $4
        WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'nvs'`,
      [ids.company.id, ids.project.id, 'preview', vault.encrypt('nvs_preview_property', scope(ids, 'preview'))],
    );
    const outbox = new NvsCommercialOutboxRepository(database, { vault });
    const event = { companyId: ids.company.id, projectId: ids.project.id, environment: 'preview', trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'lead', answers: { email: ' Pessoa@Example.Test ', telefone: '+55 (11) 99999-9999', name: 'Nunca enviar' } };
    await database.transaction((client) => outbox.enqueue(client, event));
    await database.transaction((client) => outbox.enqueue(client, event));
    const vsl = { ...event, trackingEventId: 'a1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'vsl_progress', answers: {}, params: { content_id: 'vsl-123', value: 75 } };
    await database.transaction((client) => outbox.enqueue(client, vsl));
    await database.transaction((client) => outbox.enqueue(client, vsl));
    await database.transaction((client) => outbox.enqueue(client, { ...vsl, trackingEventId: 'b1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29' }));
    const rows = await database.query('SELECT property_id, tracking_event_id, event_name, destination, payload FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2', [ids.company.id, ids.project.id]);
    assert.equal(rows.rowCount, 3);
    const lead = rows.rows.find((row) => row.event_name === 'lead');
    assert.equal(lead.property_id, 'nvs_preview_property');
    assert.equal(lead.destination, 'nvs');
    const payload = lead.payload;
    assert.deepEqual(payload.user, {
      email_sha256: createHash('sha256').update('pessoa@example.test').digest('hex'),
      phone_sha256: createHash('sha256').update('5511999999999').digest('hex'),
    });
    assert.equal(JSON.stringify(payload).includes('Pessoa@Example'), false);
    assert.equal(JSON.stringify(payload).includes('Nunca enviar'), false);
    const status = await outbox.status({ companyId: ids.company.id, projectId: ids.project.id });
    assert.equal(JSON.stringify(status).includes('nvs_preview_property'), false);
    assert.equal(JSON.stringify(status).includes('d1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29'), false);
  } finally { await database.close(); }
});

test('cliente NVS assina o mesmo envelope comercial sem respostas ou identificadores crus', async () => {
  const { NvsClient } = await import('../server/tracking-clients.mjs');
  const requests = [];
  const client = new NvsClient({ baseUrl: 'http://nvs.test', secret: 'a'.repeat(64), now: () => 1_700_000_000_000, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ status: 'queued' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  } });
  await client.sendEvent({ property_id: 'nvs_preview_property', tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', event_name: 'lead', event_time: 1_700_000_000, user: { email_sha256: 'a'.repeat(64) }, params: {} });
  assert.equal(requests[0].url, 'http://nvs.test/internal/v1/events');
  assert.match(requests[0].init.headers['X-NVS-Signature'], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(requests[0].init).includes('answers'), false);
});

test('worker comercial preserva o tracking_event_id em retry e sanitiza erro', async () => {
  const { processDueCommercialEvents } = await import('../server/commercial-events-worker.mjs');
  const calls = []; let retry;
  const repository = {
    async claimNextDue() { return { claimed: true, token: 'claim', delivery: { id: 'delivery', attemptCount: 0, payload: { tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29' } } }; },
    async markRetry(value) { retry = value; },
  };
  await processDueCommercialEvents({ repository, client: { sendEvent: async (payload) => { calls.push(payload); throw new Error('Bearer secret\nfailed'); } }, maxPerRun: 1, now: () => new Date(0) });
  assert.equal(calls[0].tracking_event_id, 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29');
  assert.equal(retry.attemptCount, 1);
  assert.equal(retry.lastError.includes('secret'), false);
});

test('fan-out NVS reutiliza o UUID do browser e reduz os parâmetros VSL à allowlist', async () => {
  const { nvsVslEvent } = await import('../server/index.mjs');
  const input = { payload: { data: { trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29' } } };
  assert.deepEqual(nvsVslEvent({ payload: { name: 'vsl_progress', data: { publicId: 'vsl-123', value: 75 } } }, input), {
    trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
    eventName: 'vsl_progress', params: { content_id: 'vsl-123', value: 75 },
  });
  assert.equal(nvsVslEvent({ payload: { name: 'form_start', data: { formId: 'form-123' } } }, input), null);
  assert.equal(nvsVslEvent({ payload: { name: 'vsl_start', data: {} } }, { payload: { data: { trackingEventId: 'not-a-uuid' } } }), null);
});

test('origens READY repetidas no mesmo ambiente são deduplicadas, mas preview e produção iguais são ambíguos', async (t) => {
  const { ContentRepository } = await import('../server/repositories/content-repository.mjs');
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const ids = await seed(database);
    await database.query(
      `INSERT INTO project_domains (company_id, project_id, environment, domain, verification_status)
       VALUES ($1, $2, 'preview', 'preview.example.test', 'verified')`,
      [ids.company.id, ids.project.id],
    );
    await database.query(
      `INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision, status, external_url)
       VALUES ($1, $2, 'preview', $3, 'preview:one', 0, 'READY', 'https://preview.example.test')`,
      [ids.company.id, ids.project.id, 'a'.repeat(64)],
    );
    const repository = new ContentRepository(database);
    assert.equal(await repository.publicationEnvironment(database, {
      companyId: ids.company.id, projectId: ids.project.id, origin: 'https://preview.example.test/path',
    }), 'preview');

    await database.query(
      `INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision, status, external_url)
       VALUES ($1, $2, 'production', $3, 'production:one', 0, 'READY', 'https://preview.example.test')`,
      [ids.company.id, ids.project.id, 'b'.repeat(64)],
    );
    assert.equal(await repository.publicationEnvironment(database, {
      companyId: ids.company.id, projectId: ids.project.id, origin: 'https://preview.example.test',
    }), null);
  } finally { await database.close(); }
});

test('produtores internos de checkout e compra preservam o UUID persistido e restringem parâmetros', async () => {
  const { CommercialEventProducer } = await import('../server/commercial-event-producer.mjs');
  const sent = [];
  const producer = new CommercialEventProducer({ database: { transaction: (fn) => fn({}) }, outbox: { enqueue: async (_client, event) => sent.push(event) } });
  const base = { companyId: 'company', projectId: 'project', environment: 'preview', trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', transactionId: 'order-1', value: 19.9, currency: 'BRL' };
  await producer.initiateCheckout(base); await producer.purchase({ ...base, trackingEventId: 'a1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29' });
  assert.deepEqual(sent.map((event) => [event.eventName, event.trackingEventId, event.params]), [
    ['initiate_checkout', base.trackingEventId, { transaction_id: 'order-1', value: 19.9, currency: 'BRL' }],
    ['purchase', 'a1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', { transaction_id: 'order-1', value: 19.9, currency: 'BRL' }],
  ]);
  await assert.rejects(() => producer.purchase({ ...base, value: -1 }), /value inválido/);
});
