import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarClienteDaConexao } from '../server/meta-conexao-cliente.mjs';
import { lerConfiguracaoDaMeta, VERSAO_DA_GRAPH_API } from '../server/meta-config.mjs';
import { MetaApiError } from '../server/meta-publicos-cliente.mjs';

// Nenhum teste toca a rede: o `fetch` é falso e registra o que sairia. Os valores abaixo são
// marcadores inventados, para provar que nunca aparecem em erro.
const SEGREDO = 'segredo-do-app-que-nao-pode-vazar';
const TOKEN = 'EAAG-token-de-teste-que-nao-pode-vazar';
const CODIGO = 'codigo-de-autorizacao-marcador';
const REDIRECT = 'https://studio.alva.test/conexoes/meta/retorno';
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);

function respostas(...lista) {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: new URL(String(url)), metodo: opcoes.method || 'GET', corpo: opcoes.body });
    const proximo = lista.shift();
    if (!proximo) throw new Error('chamada inesperada');
    if (proximo instanceof Error) throw proximo;
    return { ok: proximo.status < 400, status: proximo.status, json: async () => proximo.corpo };
  };
  return { fetch, chamadas };
}

const configuracao = (env = {}) => lerConfiguracaoDaMeta({ META_APP_ID: '111222333', META_APP_SECRET: SEGREDO, ...env }, { publicOrigin: 'https://studio.alva.test' });
const cliente = (falso, env) => criarClienteDaConexao({ fetch: falso.fetch, configuracao: configuracao(env), agora: () => AGORA });

function semSegredo(erro) {
  const texto = `${erro.message} ${erro.stack} ${JSON.stringify(erro)}`;
  for (const marcador of [SEGREDO, TOKEN, CODIGO, 'graph.facebook.com']) assert.equal(texto.includes(marcador), false, `vazou ${marcador}`);
  return true;
}

test('URL de autorização leva app id, redirect, state e config_id, e nunca o segredo', () => {
  const url = new URL(cliente(respostas(), { META_LOGIN_CONFIG_ID: '4455' }).urlDeAutorizacao({ state: 'estado.assinado', redirectUri: REDIRECT }));
  assert.equal(`${url.origin}${url.pathname}`, `https://www.facebook.com/${VERSAO_DA_GRAPH_API}/dialog/oauth`);
  assert.equal(url.searchParams.get('client_id'), '111222333');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('state'), 'estado.assinado');
  assert.equal(url.searchParams.get('config_id'), '4455');
  assert.equal(url.searchParams.get('response_type'), 'code');
  // Com configuration, as permissões são as do painel: scope não vai junto.
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.toString().includes(SEGREDO), false);
});

test('sem configuration, a URL pede os escopos; token de sistema pede o código explicitamente', () => {
  const semConfig = new URL(cliente(respostas()).urlDeAutorizacao({ state: 's', redirectUri: REDIRECT }));
  assert.deepEqual(semConfig.searchParams.get('scope').split(','), ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement']);
  assert.equal(semConfig.searchParams.has('override_default_response_type'), false);
  const sistema = new URL(cliente(respostas(), { META_TOKEN_TYPE: 'system_user', META_LOGIN_CONFIG_ID: '1' }).urlDeAutorizacao({ state: 's', redirectUri: REDIRECT }));
  assert.equal(sistema.searchParams.get('override_default_response_type'), 'true');
});

test('trocar o código: GET em oauth/access_token, do servidor, com o mesmo redirect', async () => {
  const falso = respostas({ status: 200, corpo: { access_token: TOKEN, token_type: 'bearer', expires_in: 3600 } });
  const resultado = await cliente(falso).trocarCodigo({ code: CODIGO, redirectUri: REDIRECT });
  assert.deepEqual(resultado, { token: TOKEN, expiraEm: new Date(AGORA + 3600_000) });
  const [chamada] = falso.chamadas;
  assert.equal(chamada.url.pathname, `/${VERSAO_DA_GRAPH_API}/oauth/access_token`);
  assert.equal(chamada.url.searchParams.get('client_id'), '111222333');
  assert.equal(chamada.url.searchParams.get('client_secret'), SEGREDO);
  assert.equal(chamada.url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(chamada.url.searchParams.get('code'), CODIGO);
});

test('troca recusada vira erro em português, sem token, código nem segredo', async () => {
  const falso = respostas({ status: 400, corpo: { error: { message: `This authorization code has expired. code=${CODIGO} client_secret=${SEGREDO}`, type: 'OAuthException', code: 100, error_subcode: 36007 } } });
  await assert.rejects(() => cliente(falso).trocarCodigo({ code: CODIGO, redirectUri: REDIRECT }), (erro) => {
    assert.ok(erro instanceof MetaApiError);
    assert.match(erro.message, /autoriza/i);
    assert.match(erro.message, /conect/i);
    return semSegredo(erro);
  });
});

test('falha de rede não vaza a URL (que leva o segredo)', async () => {
  const falso = respostas(new TypeError(`fetch failed https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/oauth/access_token?client_secret=${SEGREDO}&code=${CODIGO}`));
  await assert.rejects(() => cliente(falso).trocarCodigo({ code: CODIGO, redirectUri: REDIRECT }), (erro) => {
    assert.match(erro.message, /Não foi possível falar com a Meta/);
    return semSegredo(erro);
  });
});

test('resposta sem token é erro, não conexão vazia', async () => {
  const falso = respostas({ status: 200, corpo: { token_type: 'bearer' } });
  await assert.rejects(() => cliente(falso).trocarCodigo({ code: CODIGO, redirectUri: REDIRECT }), (erro) => semSegredo(erro));
});

test('estender: fb_exchange_token só para token de usuário', async () => {
  const falso = respostas({ status: 200, corpo: { access_token: `${TOKEN}-longo`, token_type: 'bearer', expires_in: 5183944 } });
  const longo = await cliente(falso).estenderToken(TOKEN);
  assert.deepEqual(longo, { token: `${TOKEN}-longo`, expiraEm: new Date(AGORA + 5183944_000) });
  const [chamada] = falso.chamadas;
  assert.equal(chamada.url.pathname, `/${VERSAO_DA_GRAPH_API}/oauth/access_token`);
  assert.equal(chamada.url.searchParams.get('grant_type'), 'fb_exchange_token');
  assert.equal(chamada.url.searchParams.get('fb_exchange_token'), TOKEN);
  const sistema = respostas();
  await assert.rejects(() => cliente(sistema, { META_TOKEN_TYPE: 'system_user' }).estenderToken(TOKEN), /sistema/);
  assert.equal(sistema.chamadas.length, 0);
});

test('quem sou e permissões levam appsecret_proof com o tempo usado no hash', async () => {
  const falso = respostas(
    { status: 200, corpo: { id: '10203040', name: 'Pessoa Dona' } },
    { status: 200, corpo: { data: [{ permission: 'ads_management', status: 'granted' }, { permission: 'ads_read', status: 'declined' }, { permission: 'public_profile', status: 'granted' }] } },
  );
  const api = cliente(falso);
  assert.deepEqual(await api.quemSou(TOKEN), { id: '10203040', nome: 'Pessoa Dona', clientBusinessId: null });
  assert.deepEqual(await api.permissoes(TOKEN), { concedidas: ['ads_management', 'public_profile'], recusadas: ['ads_read'] });
  const tempo = String(Math.floor(AGORA / 1000));
  const prova = createHmac('sha256', SEGREDO).update(`${TOKEN}|${tempo}`).digest('hex');
  for (const chamada of falso.chamadas) {
    assert.equal(chamada.url.searchParams.get('appsecret_proof'), prova);
    assert.equal(chamada.url.searchParams.get('appsecret_time'), tempo);
    assert.equal(chamada.url.searchParams.get('access_token'), TOKEN);
    assert.equal(chamada.url.searchParams.has('client_secret'), false);
  }
  assert.equal(falso.chamadas[0].url.pathname, `/${VERSAO_DA_GRAPH_API}/me`);
  assert.equal(falso.chamadas[0].url.searchParams.get('fields'), 'id,name');
  assert.equal(falso.chamadas[1].url.pathname, `/${VERSAO_DA_GRAPH_API}/me/permissions`);
});

test('token de sistema pergunta também o portfólio do cliente', async () => {
  const falso = respostas({ status: 200, corpo: { id: '55', name: 'Sistema', client_business_id: '777' } });
  assert.deepEqual(await cliente(falso, { META_TOKEN_TYPE: 'system_user' }).quemSou(TOKEN), { id: '55', nome: 'Sistema', clientBusinessId: '777' });
  assert.equal(falso.chamadas[0].url.searchParams.get('fields'), 'id,name,client_business_id');
});

test('token recusado (190) vira erro marcado para reconectar, sem o token', async () => {
  const falso = respostas({ status: 400, corpo: { error: { message: `Error validating access token: ${TOKEN}`, code: 190, error_subcode: 463 } } });
  await assert.rejects(() => cliente(falso).quemSou(TOKEN), (erro) => {
    assert.equal(erro.code, 190);
    assert.equal(erro.subcode, 463);
    assert.equal(erro.reconectar, true);
    assert.match(erro.message, /Conecte de novo/);
    return semSegredo(erro);
  });
});

test('revogar: DELETE em /{usuário}/permissions, com a prova', async () => {
  const falso = respostas({ status: 200, corpo: { success: true } });
  assert.equal(await cliente(falso).revogar({ token: TOKEN, metaUserId: '10203040' }), true);
  const [chamada] = falso.chamadas;
  assert.equal(chamada.metodo, 'DELETE');
  assert.equal(chamada.url.pathname, `/${VERSAO_DA_GRAPH_API}/10203040/permissions`);
  assert.ok(chamada.url.searchParams.get('appsecret_proof'));
  await assert.rejects(() => cliente(respostas()).revogar({ token: TOKEN, metaUserId: '../me' }), /usuário/);
});
