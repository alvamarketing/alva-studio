// Como cada plataforma responde, lido do jeito que ela documenta.
//
// Até 27/09 a entrega olhava só o status HTTP. A Meta diz o motivo no corpo
// (`error.code`), e o TikTok também (`code`) — e usa HTTP 401 para "muitas requisições"
// (40100), que lido pelo status virava "credencial recusada" e parava de tentar.
// - https://developers.facebook.com/docs/graph-api/guides/error-handling
// - https://business-api.tiktok.com/portal/docs/responses-and-errors/v1.3
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entregarEvento } from '../server/tracking-entrega.mjs';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { CAMPOS_DE_DESTINO, motivoDaFalha } from '../public/studio-dashboard.js';

const EVENTO = { event_name: 'lead', event_time: 1_764_200_000, tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', source_url: 'https://lp.exemplo.test/oferta', user: {}, click_ids: {}, params: {} };
const META = { pixel_id: '123456', access_token: 'token-da-meta' };
const TIKTOK = { pixel_code: 'PXTIKTOK', access_token: 'token-do-tiktok' };
const responde = (status, corpo) => async () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

// https://developers.facebook.com/docs/graph-api/changelog — a v20.0 ficou no ar até
// 24/09/2026. https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
// documenta o token como `?access_token=`.
test('Meta: versão em vigor e o token onde a documentação manda', () => {
  const pedido = destinoPara('meta').requisicao(EVENTO, META);
  const url = new URL(pedido.url);
  assert.equal(url.pathname, '/v26.0/123456/events');
  assert.equal(url.searchParams.get('access_token'), 'token-da-meta');
  assert.equal((pedido.cabecalhos ?? []).some((linha) => /^authorization:/i.test(linha)), false);
});

test('Meta: token vencido ou inválido (190) é credencial, e não se insiste', async () => {
  const resultado = await entregarEvento({ destino: 'meta', evento: EVENTO, credenciais: META, fetchImpl: responde(400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190, fbtrace_id: 'x' } }) });
  assert.deepEqual([resultado.entregue, resultado.retentar, resultado.motivo], [false, false, 'destination_credential_rejected']);
});

test('Meta: permissão faltando (10, 200-299) tem motivo próprio', async () => {
  for (const code of [10, 200, 299]) {
    const resultado = await entregarEvento({ destino: 'meta', evento: EVENTO, credenciais: META, fetchImpl: responde(403, { error: { type: 'OAuthException', code } }) });
    assert.equal(resultado.motivo, 'destination_permission_denied', String(code));
    assert.equal(resultado.retentar, false);
  }
});

test('Meta: limite e instabilidade (1, 2, 4, 17, 341) tentam de novo', async () => {
  for (const code of [1, 2, 4, 17, 341]) {
    const resultado = await entregarEvento({ destino: 'meta', evento: EVENTO, credenciais: META, fetchImpl: responde(400, { error: { code } }) });
    assert.equal(resultado.retentar, true, String(code));
  }
});

test('TikTok: só é entregue com HTTP 200 e code 0', async () => {
  assert.equal((await entregarEvento({ destino: 'tiktok', evento: EVENTO, credenciais: TIKTOK, fetchImpl: responde(200, { code: 0, message: 'OK', data: {} }) })).entregue, true);
  const comErro = await entregarEvento({ destino: 'tiktok', evento: EVENTO, credenciais: TIKTOK, fetchImpl: responde(200, { code: 40002, message: 'Invalid payload' }) });
  assert.equal(comErro.entregue, false, '200 com code diferente de 0 não é entrega');
});

test('TikTok: 40100 é limite de requisições, mesmo vindo com 401 — tenta de novo', async () => {
  const resultado = await entregarEvento({ destino: 'tiktok', evento: EVENTO, credenciais: TIKTOK, fetchImpl: responde(401, { code: 40100, message: 'Too many requests' }) });
  assert.deepEqual([resultado.retentar, resultado.motivo], [true, 'destination_rate_limited']);
});

test('TikTok: sem permissão, token vazio e corpo inválido têm motivos próprios', async () => {
  const casos = [[400, 40001, 'destination_permission_denied'], [401, 40104, 'destination_credential_rejected'], [400, 40002, 'destination_invalid_payload']];
  for (const [status, code, motivo] of casos) {
    const resultado = await entregarEvento({ destino: 'tiktok', evento: EVENTO, credenciais: TIKTOK, fetchImpl: responde(status, { code }) });
    assert.deepEqual([resultado.retentar, resultado.motivo], [false, motivo], String(code));
  }
});

test('cada motivo novo vira uma frase na tela, nomeando o destino', () => {
  assert.match(motivoDaFalha('destination_credential_rejected', 'Meta'), /recusou a credencial.*Meta/);
  assert.match(motivoDaFalha('destination_permission_denied', 'TikTok'), /permissão.*TikTok/);
  assert.match(motivoDaFalha('destination_rate_limited', 'TikTok'), /tenta de novo sozinho/);
  assert.match(motivoDaFalha('destination_invalid_payload', 'TikTok'), /Studio/);
});

// "Events sent with test_event_code are not dropped. They flow into Events Manager and are
// used for targeting and ads measurement purposes."
// https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
test('a ajuda do modo de teste não promete o que a Meta não garante', () => {
  const ajuda = CAMPOS_DE_DESTINO.meta.find((campo) => campo.name === 'test_event_code').help;
  assert.doesNotMatch(ajuda, /não entram|fora dos dados|sem afetar/i);
  assert.match(ajuda, /contam|conta/i);
});
