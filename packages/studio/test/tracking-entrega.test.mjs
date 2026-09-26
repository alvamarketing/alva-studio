import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entregarEvento, classificarResposta } from '../server/tracking-entrega.mjs';

const evento = {
  event_name: 'lead',
  event_time: 1_764_200_000,
  tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
  user: { email_sha256: 'a'.repeat(64) },
  click_ids: {},
  params: {},
  consent_state: 'granted',
};
const credenciaisMeta = { pixel_id: '123', access_token: 'tok' };

test('entrega bem-sucedida devolve o status e não pede retentativa', async () => {
  const chamadas = [];
  const resultado = await entregarEvento({
    destino: 'meta', evento, credenciais: credenciaisMeta,
    fetchImpl: async (url, opcoes) => { chamadas.push({ url, opcoes }); return { ok: true, status: 200, text: async () => '{}' }; },
  });
  assert.equal(resultado.entregue, true);
  assert.equal(resultado.status, 200);
  assert.match(chamadas[0].url, /graph\.facebook\.com/);
  assert.equal(chamadas[0].opcoes.method, 'POST');
});

test('o corpo enviado carrega o mesmo tracking_event_id que veio da fila', async () => {
  let corpoEnviado;
  await entregarEvento({
    destino: 'meta', evento, credenciais: credenciaisMeta,
    fetchImpl: async (_url, opcoes) => { corpoEnviado = JSON.parse(opcoes.body); return { ok: true, status: 200, text: async () => '' }; },
  });
  // É o que deduplica contra o pixel do navegador; se mudasse a cada tentativa, cada
  // retentativa viraria uma conversão nova na plataforma.
  assert.equal(corpoEnviado.data[0].event_id, evento.tracking_event_id);
});

test('duas tentativas do mesmo evento mandam identificador idêntico', async () => {
  const ids = [];
  const enviar = () => entregarEvento({
    destino: 'meta', evento, credenciais: credenciaisMeta,
    fetchImpl: async (_u, o) => { ids.push(JSON.parse(o.body).data[0].event_id); return { ok: true, status: 200, text: async () => '' }; },
  });
  await enviar(); await enviar();
  assert.equal(ids[0], ids[1]);
});

test('erro de rede pede retentativa; erro de configuração não', () => {
  assert.equal(classificarResposta({ erroDeRede: true }).retentar, true);
  assert.equal(classificarResposta({ status: 500 }).retentar, true);
  assert.equal(classificarResposta({ status: 503 }).retentar, true);
  assert.equal(classificarResposta({ status: 429 }).retentar, true);
  // 400 e 401 não melhoram com insistência: credencial errada ou payload inválido.
  assert.equal(classificarResposta({ status: 400 }).retentar, false);
  assert.equal(classificarResposta({ status: 401 }).retentar, false);
  assert.equal(classificarResposta({ status: 403 }).retentar, false);
  assert.equal(classificarResposta({ status: 200 }).retentar, false);
});

test('destino mal configurado falha sem tocar a rede', async () => {
  let tocouARede = false;
  const resultado = await entregarEvento({
    destino: 'meta', evento, credenciais: { pixel_id: '', access_token: '' },
    fetchImpl: async () => { tocouARede = true; return { ok: true, status: 200, text: async () => '' }; },
  });
  assert.equal(tocouARede, false);
  assert.equal(resultado.entregue, false);
  assert.equal(resultado.retentar, false, 'credencial faltando não melhora com retentativa');
  assert.match(resultado.motivo, /destination_not_configured/);
});

test('a plataforma fora do ar devolve retentar, preservando o evento na fila', async () => {
  const resultado = await entregarEvento({
    destino: 'meta', evento, credenciais: credenciaisMeta,
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  assert.equal(resultado.entregue, false);
  assert.equal(resultado.retentar, true);
});

test('Taboola é GET e não manda corpo', async () => {
  let opcoesUsadas;
  await entregarEvento({
    destino: 'taboola',
    evento: { ...evento, click_ids: { taboola_click_id: 'abc' } },
    credenciais: {},
    fetchImpl: async (_u, o) => { opcoesUsadas = o; return { ok: true, status: 200, text: async () => '' }; },
  });
  assert.equal(opcoesUsadas.method, 'GET');
  assert.equal(opcoesUsadas.body, undefined);
});
