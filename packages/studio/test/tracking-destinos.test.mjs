import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoPara, DESTINOS } from '../server/tracking-destinos.mjs';

// Os destinos de conversão, portados do PHP do NVS. Cada um monta o corpo que a
// plataforma espera e nada mais: quem decide quando disparar é a fila, quem garante que
// não dispara duas vezes é o event_id que nasce no navegador e a unicidade do outbox.

const evento = ({ nome = 'lead', ...resto } = {}) => ({
  event_name: nome,
  event_time: 1_764_200_000,
  tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
  user: { email_sha256: 'a'.repeat(64), phone_sha256: 'b'.repeat(64) },
  click_ids: {},
  params: {},
  consent_state: 'granted',
  ...resto,
});

test('o registro conhece os cinco destinos e recusa o desconhecido', () => {
  assert.deepEqual(Object.keys(DESTINOS).sort(), ['google', 'linkedin', 'meta', 'taboola', 'tiktok']);
  assert.throws(() => destinoPara('pinterest'), /destino/i);
});

test('Meta: o event_id vai no corpo, que é o que deduplica contra o pixel do navegador', () => {
  const pedido = destinoPara('meta').requisicao(evento(), { pixel_id: '123', access_token: 'tok' });
  assert.equal(pedido.url, 'https://graph.facebook.com/v20.0/123/events');
  assert.equal(pedido.corpo.data[0].event_id, 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29');
  assert.equal(pedido.corpo.data[0].action_source, 'website');
  assert.equal(pedido.corpo.data[0].user_data.em, 'a'.repeat(64));
  assert.ok(pedido.cabecalhos.some((h) => h.startsWith('Authorization: Bearer tok')));
});

test('Meta: sem pixel ou token, recusa antes de sair pela rede', () => {
  assert.throws(() => destinoPara('meta').requisicao(evento(), { pixel_id: '', access_token: 'tok' }), /destination_not_configured/);
  assert.throws(() => destinoPara('meta').requisicao(evento(), { pixel_id: '123', access_token: ' ' }), /destination_not_configured/);
});

test('TikTok: identificador do evento e do pixel vão nos lugares certos', () => {
  const pedido = destinoPara('tiktok').requisicao(evento({ click_ids: { ttclid: 'tt-1' } }), { pixel_code: 'PX', access_token: 'tok' });
  assert.equal(pedido.url, 'https://business-api.tiktok.com/open_api/v1.3/event/track/');
  assert.equal(pedido.corpo.event_source_id, 'PX');
  assert.equal(pedido.corpo.data[0].event_id, 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29');
  assert.equal(pedido.corpo.data[0].user.ttclid, 'tt-1');
});

test('Google: exige ao menos um identificador, senão não há a quem atribuir', () => {
  assert.throws(
    () => destinoPara('google').requisicao(
      { ...evento(), user: {}, click_ids: {} },
      { operating_account_id: '1', conversion_action_id: '2', oauth_access_token: 'tok' },
    ),
    /destination_identifier_required/,
  );
});

test('Google: consentimento negado vira DENIED em todos os campos', () => {
  const pedido = destinoPara('google').requisicao(
    evento({ consent_state: 'denied' }),
    { operating_account_id: '1', conversion_action_id: '2', oauth_access_token: 'tok' },
  );
  const consent = pedido.corpo.events[0].consent;
  assert.deepEqual(Object.values(consent), ['DENIED', 'DENIED', 'DENIED', 'DENIED']);
});

test('LinkedIn: sem e-mail nem uuid de rastreio, recusa', () => {
  assert.throws(
    () => destinoPara('linkedin').requisicao(
      { ...evento(), user: {}, click_ids: {} },
      { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 'tok' },
    ),
    /destination_identifier_required/,
  );
});

test('LinkedIn: o instante vai em milissegundos, não em segundos', () => {
  const pedido = destinoPara('linkedin').requisicao(evento(), { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 'tok' });
  assert.equal(pedido.corpo.conversionHappenedAt, 1_764_200_000 * 1000);
  assert.equal(pedido.corpo.eventId, 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29');
});

test('Taboola: é GET com o clique na URL, e o clique é validado', () => {
  const pedido = destinoPara('taboola').requisicao(evento({ click_ids: { taboola_click_id: 'abc-123' } }), {});
  assert.equal(pedido.metodo, 'GET');
  assert.match(pedido.url, /click-id=abc-123/);
  assert.throws(() => destinoPara('taboola').requisicao(evento({ click_ids: { taboola_click_id: 'a b' } }), {}), /destination_identifier_required/);
});

test('nenhum destino recebe e-mail ou telefone em claro', () => {
  const cru = { ...evento(), user: { email_sha256: 'a'.repeat(64), email: 'pessoa@exemplo.test', phone: '+5511999999999' } };
  const credenciais = {
    meta: { pixel_id: '1', access_token: 't' },
    tiktok: { pixel_code: 'P', access_token: 't' },
    google: { operating_account_id: '1', conversion_action_id: '2', oauth_access_token: 't' },
    linkedin: { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 't' },
  };
  for (const [chave, credencial] of Object.entries(credenciais)) {
    const texto = JSON.stringify(destinoPara(chave).requisicao(cru, credencial));
    assert.ok(!texto.includes('pessoa@exemplo.test'), `${chave} vazou e-mail`);
    assert.ok(!texto.includes('+5511999999999'), `${chave} vazou telefone`);
  }
});
