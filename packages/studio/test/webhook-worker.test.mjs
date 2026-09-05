import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextDelayMs, MAX_WEBHOOK_ATTEMPTS, processDueWebhookDeliveries, startWebhookWorker } from '../server/webhook-worker.mjs';

function makeDelivery(overrides = {}) {
  return {
    id: 'delivery-1', companyId: 'company-1', projectId: 'project-1',
    url: 'https://hooks.example.test/lead', event: { eventId: 'evt-1' }, attemptCount: 0,
    ...overrides,
  };
}

class FakeRepository {
  constructor(queue) {
    this.queue = queue;
    this.attempts = [];
    this.delivered = [];
    this.retried = [];
    this.dead = [];
  }
  async claimNextDue() {
    const delivery = this.queue.shift();
    return delivery ? { claimed: true, token: `token-${delivery.id}`, delivery } : { claimed: false, delivery: null };
  }
  async recordAttempt(input) { this.attempts.push(input); }
  async markDelivered(input) { this.delivered.push(input); }
  async markRetry(input) { this.retried.push(input); }
  async markDead(input) { this.dead.push(input); }
}

test('computeNextDelayMs cresce com o número de tentativas e nunca ultrapassa o teto', () => {
  const first = computeNextDelayMs(1);
  const second = computeNextDelayMs(2);
  const last = computeNextDelayMs(MAX_WEBHOOK_ATTEMPTS);
  const beyond = computeNextDelayMs(MAX_WEBHOOK_ATTEMPTS + 5);
  assert.ok(second > first, 'a segunda tentativa deve esperar mais que a primeira');
  assert.equal(beyond, last, 'além do máximo, o atraso fica no teto em vez de crescer sem limite');
});

test('entrega bem-sucedida: revalida o destino, entrega e marca delivered', async () => {
  const repository = new FakeRepository([makeDelivery()]);
  const calls = [];
  const result = await processDueWebhookDeliveries({
    repository,
    dnsLookup: async (host) => { calls.push(host); return [{ address: '93.184.216.34', family: 4 }]; },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result.processed, 1);
  assert.deepEqual(calls, ['hooks.example.test']);
  assert.equal(repository.attempts.length, 1);
  assert.equal(repository.attempts[0].attemptNumber, 1);
  assert.equal(repository.attempts[0].outcome, 'delivered');
  assert.equal(repository.delivered.length, 1);
  assert.equal(repository.retried.length, 0);
});

test('destino resolve para rede privada nesta tentativa: bloqueia, audita e reagenda com backoff', async () => {
  const repository = new FakeRepository([makeDelivery({ attemptCount: 0 })]);
  let fetchCalled = false;
  const before = Date.now();
  const result = await processDueWebhookDeliveries({
    repository,
    dnsLookup: async () => [{ address: '10.0.0.5', family: 4 }],
    fetchImpl: async () => { fetchCalled = true; return { ok: true }; },
  });
  assert.equal(result.processed, 1);
  assert.equal(fetchCalled, false, 'nunca deve chamar a rede quando o destino revalidado é privado');
  assert.equal(repository.attempts[0].outcome, 'blocked_destination');
  assert.equal(repository.retried.length, 1);
  assert.equal(repository.retried[0].attemptCount, 1);
  assert.ok(repository.retried[0].nextAttemptAt.getTime() > before, 'reagenda para o futuro, não para agora');
  assert.equal(repository.dead.length, 0);
});

test('revalida o DNS a cada tentativa: um destino antes privado pode ser aceito depois de mudar', async () => {
  const repository = new FakeRepository([makeDelivery({ id: 'a', attemptCount: 3 })]);
  let lookups = 0;
  const result = await processDueWebhookDeliveries({
    repository,
    dnsLookup: async () => { lookups += 1; return [{ address: '93.184.216.34', family: 4 }]; },
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(lookups, 1, 'cada tentativa processada deve revalidar o DNS de novo, não reaproveitar uma checagem antiga');
  assert.equal(result.processed, 1);
  assert.equal(repository.delivered.length, 1);
});

test('esgotou as tentativas: marca a entrega como morta em vez de reagendar de novo', async () => {
  const repository = new FakeRepository([makeDelivery({ attemptCount: MAX_WEBHOOK_ATTEMPTS - 1 })]);
  await processDueWebhookDeliveries({
    repository,
    dnsLookup: async () => [{ address: '10.0.0.5', family: 4 }],
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(repository.retried.length, 0);
  assert.equal(repository.dead.length, 1);
  assert.equal(repository.dead[0].attemptCount, MAX_WEBHOOK_ATTEMPTS);
});

test('processa todas as entregas devidas de uma vez, uma por reivindicação', async () => {
  const repository = new FakeRepository([makeDelivery({ id: 'a' }), makeDelivery({ id: 'b' }), makeDelivery({ id: 'c' })]);
  const result = await processDueWebhookDeliveries({
    repository,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result.processed, 3);
  assert.equal(repository.delivered.length, 3);
});

test('erro de rede na tentativa é tratado como falha recuperável, não trava o processamento', async () => {
  const repository = new FakeRepository([makeDelivery()]);
  const result = await processDueWebhookDeliveries({
    repository,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  assert.equal(result.processed, 1);
  assert.equal(repository.attempts[0].outcome, 'network_error');
  assert.equal(repository.retried.length, 1);
});

test('startWebhookWorker roda o processamento sozinho, desacoplado de qualquer requisição, e para quando pedido', async () => {
  const repository = new FakeRepository([makeDelivery()]);
  const worker = startWebhookWorker({
    repository, intervalMs: 5,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  worker.stop();
  assert.equal(repository.delivered.length, 1);
});
