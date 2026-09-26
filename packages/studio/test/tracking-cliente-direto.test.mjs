import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteDeDestinos } from '../server/tracking-cliente-direto.mjs';
import { processDueCommercialEvents } from '../server/commercial-events-worker.mjs';

// O cliente que substitui o gateway PHP: lê as credenciais do projeto, escolhe o
// adaptador do destino e entrega. É ele que o worker da fila passa a usar.

const entrega = (payload, extra = {}) => ({
  id: 'e1', companyId: 'c1', projectId: 'p1', environment: 'production',
  destination: 'meta', trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
  eventName: 'lead', attemptCount: 0, payload, ...extra,
});

const payloadBase = {
  event_name: 'lead', event_time: 1_764_200_000,
  tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
  user: { email_sha256: 'a'.repeat(64) }, click_ids: {}, params: {}, consent_state: 'granted',
};

function trackingFalso(destinos = { meta: { pixel_id: '1', access_token: 't' } }) {
  return { nvsDestinations: async () => destinos };
}

test('entrega usando a credencial do projeto, decifrada pelo repositório de tracking', async () => {
  const chamadas = [];
  const cliente = criarClienteDeDestinos({
    tracking: trackingFalso(),
    fetchImpl: async (url) => { chamadas.push(url); return { ok: true, status: 200, text: async () => '' }; },
  });
  await cliente.sendEvent(entrega(payloadBase));
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0], /graph\.facebook\.com\/v20\.0\/1\/events/);
});

test('destino sem credencial no projeto falha sem tocar a rede', async () => {
  let tocou = false;
  const cliente = criarClienteDeDestinos({
    tracking: trackingFalso({}),
    fetchImpl: async () => { tocou = true; return { ok: true, status: 200, text: async () => '' }; },
  });
  await assert.rejects(() => cliente.sendEvent(entrega(payloadBase)), /destination_not_configured/);
  assert.equal(tocou, false);
});

test('falha transitória é lançada como retentável e a permanente não', async () => {
  const comStatus = (status) => criarClienteDeDestinos({
    tracking: trackingFalso(),
    fetchImpl: async () => ({ ok: false, status, text: async () => '' }),
  });
  await assert.rejects(() => comStatus(503).sendEvent(entrega(payloadBase)), (erro) => erro.retentar === true);
  await assert.rejects(() => comStatus(401).sendEvent(entrega(payloadBase)), (erro) => erro.retentar === false);
});

// O worker tratava qualquer erro como retentável: credencial errada gastava as seis
// tentativas antes de morrer, disparando seis vezes contra a plataforma sem necessidade.
test('o worker mata na primeira tentativa o que não melhora com repetição', async () => {
  const acoes = [];
  const repositorio = {
    claimNextDue: async () => (acoes.length ? { claimed: false } : { claimed: true, token: 'tk', delivery: entrega(payloadBase) }),
    markDelivered: async () => acoes.push('entregue'),
    markRetry: async () => acoes.push('retentar'),
    markDead: async ({ attemptCount }) => acoes.push(`morto:${attemptCount}`),
  };
  await processDueCommercialEvents({
    repository: repositorio,
    client: { sendEvent: async () => { throw Object.assign(new Error('destination_rejected_401'), { retentar: false }); } },
  });
  assert.deepEqual(acoes, ['morto:1'], 'erro permanente não pode voltar para a fila');
});

test('o worker continua retentando o que é transitório', async () => {
  const acoes = [];
  const repositorio = {
    claimNextDue: async () => (acoes.length ? { claimed: false } : { claimed: true, token: 'tk', delivery: entrega(payloadBase) }),
    markDelivered: async () => acoes.push('entregue'),
    markRetry: async () => acoes.push('retentar'),
    markDead: async () => acoes.push('morto'),
  };
  await processDueCommercialEvents({
    repository: repositorio,
    client: { sendEvent: async () => { throw Object.assign(new Error('transport_error'), { retentar: true }); } },
  });
  assert.deepEqual(acoes, ['retentar']);
});
