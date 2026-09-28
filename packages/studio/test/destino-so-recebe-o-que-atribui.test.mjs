// Cada destino só recebe o evento que ele consegue atribuir.
//
// A simulação de 27/09 mostrou o Google recusando todo lead que não veio dele: sem
// `gclid` e sem e-mail hasheado, não há a quem atribuir. Cada lead de Facebook, TikTok
// ou orgânico virava uma entrega morta, e a tela mostraria o Google como quebrado. O
// mesmo valia para Taboola e LinkedIn.
//
// A regra que decide se a fila endereça é a mesma que decide se o destino recusa. Duas
// regras separadas divergiriam — foi assim que a lista do `fbc` se perdeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESTINOS, destinoPara } from '../server/tracking-destinos.mjs';

const HASH = 'a'.repeat(64);
// Todo lead que passa pela publicação traz a página e o navegador de quem converteu.
const base = { event_name: 'lead', event_time: 1_700_000_000, tracking_event_id: 'e1', consent_state: 'pending', source_url: 'https://lp.exemplo.test/oferta', client: { user_agent: 'Mozilla/5.0 (iPhone)' }, user: {}, params: {} };
const CREDENCIAIS = {
  meta: { pixel_id: '1', access_token: 't' },
  tiktok: { pixel_code: 'PX', access_token: 't' },
  google: { operating_account_id: '1', conversion_action_id: '2', oauth_access_token: 't' },
  linkedin: { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 't' },
  taboola: {},
};

test('Meta e TikTok atribuem qualquer evento: eles fazem a própria correspondência', () => {
  for (const chave of ['meta', 'tiktok']) assert.equal(destinoPara(chave).podeAtribuir(base), true, chave);
  // Menos um caso: evento web sem a página é inválido para o TikTok.
  // https://business-api.tiktok.com/portal/docs/parameters/v1.3
  assert.equal(destinoPara('tiktok').podeAtribuir({ ...base, source_url: undefined }), false);
});

test('o Google atribui com o clique dele, ou com contato hasheado', () => {
  const google = destinoPara('google');
  assert.equal(google.podeAtribuir(base), false, 'sem nada, não há a quem atribuir');
  assert.equal(google.podeAtribuir({ ...base, click_ids: { fbc: 'fb.1.1.x' } }), false, 'clique da Meta não serve ao Google');
  for (const clique of ['gclid', 'gbraid', 'wbraid']) assert.equal(google.podeAtribuir({ ...base, click_ids: { [clique]: 'x' } }), true, clique);
  // O Google usa o e-mail no formato dele (sem os pontos do Gmail) e o telefone em E.164.
  assert.equal(google.podeAtribuir({ ...base, user: { email_google_sha256: HASH } }), true, 'e-mail hasheado permite casar a pessoa');
  assert.equal(google.podeAtribuir({ ...base, user: { phone_e164_sha256: HASH } }), true, 'telefone hasheado também');
});

test('o LinkedIn atribui com e-mail hasheado ou com o identificador dele', () => {
  const linkedin = destinoPara('linkedin');
  assert.equal(linkedin.podeAtribuir(base), false);
  assert.equal(linkedin.podeAtribuir({ ...base, user: { email_sha256: HASH } }), true);
  assert.equal(linkedin.podeAtribuir({ ...base, click_ids: { linkedin_tracking_uuid: 'u' } }), true);
});

test('a Taboola só atribui com o clique dela, em formato válido', () => {
  const taboola = destinoPara('taboola');
  assert.equal(taboola.podeAtribuir(base), false);
  assert.equal(taboola.podeAtribuir({ ...base, click_ids: { taboola_click_id: 'abc-123' } }), true);
  assert.equal(taboola.podeAtribuir({ ...base, click_ids: { taboola_click_id: 'com espaço' } }), false);
});

// A garantia de que a fila e o adaptador usam a mesma regra: para cada destino e cada
// evento, "não pode atribuir" é exatamente "o adaptador recusaria por falta de
// identificador".
test('a pergunta da fila e a recusa do adaptador nunca discordam', () => {
  const eventos = [
    base,
    { ...base, source_url: undefined },
    { ...base, click_ids: { gclid: 'g' } },
    { ...base, click_ids: { fbc: 'fb.1.1.x' } },
    { ...base, click_ids: { taboola_click_id: 'abc' } },
    { ...base, click_ids: { linkedin_tracking_uuid: 'u' } },
    { ...base, user: { email_sha256: HASH } },
    { ...base, user: { phone_sha256: HASH } },
  ];
  for (const chave of Object.keys(DESTINOS)) {
    for (const evento of eventos) {
      let recusou = false;
      try { destinoPara(chave).requisicao(evento, CREDENCIAIS[chave]); } catch (erro) { recusou = ['destination_identifier_required', 'destination_page_url_required'].includes(erro.message); }
      assert.equal(destinoPara(chave).podeAtribuir(evento), !recusou, `${chave} discorda de si mesmo em ${JSON.stringify({ click_ids: evento.click_ids, user: evento.user })}`);
    }
  }
});
