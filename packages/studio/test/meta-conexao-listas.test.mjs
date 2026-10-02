import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarClienteDaConexao, provaDoSegredo } from '../server/meta-conexao-cliente.mjs';
import { lerConfiguracaoDaMeta, PAGINACAO, VERSAO_DA_GRAPH_API, diasParaVencer, linkDosTermos } from '../server/meta-config.mjs';

// F2: as listas que o cartão "Conta da Meta" mostra. Nenhum teste toca a rede.
const SEGREDO = 'segredo-do-app-que-nao-pode-vazar';
const TOKEN = 'EAAG-token-de-teste-que-nao-pode-vazar';
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);

function respostas(...lista) {
  const chamadas = [];
  const fetch = async (url) => {
    chamadas.push(new URL(String(url)));
    const proximo = lista.shift();
    if (!proximo) throw new Error('chamada inesperada');
    if (proximo instanceof Error) throw proximo;
    return { ok: proximo.status < 400, status: proximo.status, json: async () => proximo.corpo };
  };
  return { fetch, chamadas };
}
const configuracao = lerConfiguracaoDaMeta({ META_APP_ID: '111222333', META_APP_SECRET: SEGREDO }, { publicOrigin: 'https://studio.alva.test' });
const cliente = (falso) => criarClienteDaConexao({ fetch: falso.fetch, configuracao, agora: () => AGORA });
const ok = (corpo) => ({ status: 200, corpo });
const caminho = (url) => url.pathname.replace(`/${VERSAO_DA_GRAPH_API}/`, '');

function provaConfere(url) {
  const tempo = url.searchParams.get('appsecret_time');
  assert.equal(tempo, String(AGORA / 1000));
  assert.equal(url.searchParams.get('appsecret_proof'), createHmac('sha256', SEGREDO).update(`${TOKEN}|${tempo}`).digest('hex'));
}

test('contas de anúncios: portfólios, depois contas próprias e de clientes, sem repetir', async () => {
  const falso = respostas(
    ok({ data: [{ id: '900', name: 'Portfólio Alva' }] }),
    ok({ data: [{ id: 'act_111', account_id: '111', name: 'Conta Zeta' }, { id: 'act_222', account_id: '222', name: 'Conta Alfa' }] }),
    ok({ data: [{ id: 'act_111', account_id: '111', name: 'Conta Zeta' }, { id: 'act_333', name: 'Cliente' }, { id: 'lixo' }] }),
  );
  const contas = await cliente(falso).contasDeAnuncios(TOKEN);
  assert.deepEqual(falso.chamadas.map(caminho), ['me/businesses', '900/owned_ad_accounts', '900/client_ad_accounts']);
  for (const url of falso.chamadas) provaConfere(url);
  assert.equal(falso.chamadas[1].searchParams.get('fields'), 'id,account_id,name');
  assert.deepEqual(contas.map((item) => [item.id, item.nome]), [['333', 'Cliente'], ['222', 'Conta Alfa'], ['111', 'Conta Zeta']]);
  assert.deepEqual(contas[0].negocio, { id: '900', nome: 'Portfólio Alva' });
});

test('/me/adaccounts não é usado (não está na referência do nó User)', async () => {
  const falso = respostas(ok({ data: [] }));
  assert.deepEqual(await cliente(falso).contasDeAnuncios(TOKEN), []);
  assert.equal(falso.chamadas.some((url) => url.pathname.endsWith('/adaccounts')), false);
});

test('paginação: segue o cursor after com prova nova, nunca a URL do next', async () => {
  const falso = respostas(
    ok({ data: [{ id: '1', name: 'Pixel 1' }], paging: { cursors: { after: 'CURSOR1' }, next: `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/act_5/adspixels?after=CURSOR1&access_token=${TOKEN}` } }),
    ok({ data: [{ id: '2', name: 'Pixel 2' }], paging: { cursors: { after: 'CURSOR2' } } }),
  );
  const pixels = await cliente(falso).pixels(TOKEN, 'act_5');
  assert.deepEqual(pixels, [{ id: '1', nome: 'Pixel 1' }, { id: '2', nome: 'Pixel 2' }]);
  assert.equal(caminho(falso.chamadas[0]), 'act_5/adspixels');
  assert.equal(falso.chamadas[0].searchParams.has('after'), false);
  assert.equal(falso.chamadas[1].searchParams.get('after'), 'CURSOR1');
  assert.equal(falso.chamadas[1].searchParams.get('limit'), String(PAGINACAO.porPagina));
  provaConfere(falso.chamadas[1]);
});

test('paginação tem teto, mesmo que a Meta diga que sempre há mais', async () => {
  const paginas = Array.from({ length: PAGINACAO.maximoDePaginas + 5 }, (_, i) => ok({ data: [{ id: String(i + 1), name: `P${i}` }], paging: { cursors: { after: `C${i}` }, next: 'https://graph.facebook.com/x' } }));
  const falso = respostas(...paginas);
  const pixels = await cliente(falso).pixels(TOKEN, '5');
  assert.equal(falso.chamadas.length, PAGINACAO.maximoDePaginas);
  assert.equal(pixels.length, PAGINACAO.maximoDePaginas);
});

test('cursor repetido para a paginação (resposta defeituosa não vira laço)', async () => {
  const falso = respostas(
    ok({ data: [{ id: '1' }], paging: { cursors: { after: 'MESMO' }, next: 'x' } }),
    ok({ data: [{ id: '2' }], paging: { cursors: { after: 'MESMO' }, next: 'x' } }),
  );
  assert.equal((await cliente(falso).pixels(TOKEN, '5')).length, 2);
  assert.equal(falso.chamadas.length, 2);
});

test('Páginas que a pessoa administra: só id e nome', async () => {
  const falso = respostas(ok({ data: [{ id: '77', name: 'Página da Alva', access_token: 'token-da-pagina-nao-sai', category: 'x' }] }));
  const paginas = await cliente(falso).paginas(TOKEN);
  assert.equal(caminho(falso.chamadas[0]), 'me/accounts');
  assert.equal(falso.chamadas[0].searchParams.get('fields'), 'id,name');
  assert.deepEqual(paginas, [{ id: '77', nome: 'Página da Alva' }]);
});

test('termos de públicos: custom_audience_tos = 1 é aceito; o resto não', async () => {
  const falso = respostas(ok({ tos_accepted: { custom_audience_tos: 1 }, id: 'act_5' }), ok({ id: 'act_5' }), ok({ tos_accepted: { web_custom_audience_tos: 1 } }));
  const c = cliente(falso);
  assert.equal(await c.termosAceitos(TOKEN, '5'), true);
  assert.equal(await c.termosAceitos(TOKEN, 'act_5'), false);
  assert.equal(await c.termosAceitos(TOKEN, '5'), false);
  assert.equal(caminho(falso.chamadas[0]), 'act_5');
  assert.equal(falso.chamadas[0].searchParams.get('fields'), 'tos_accepted');
  assert.equal(linkDosTermos('5'), 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=5');
});

test('conta inválida é recusada antes de chamar a Meta', async () => {
  const falso = respostas();
  await assert.rejects(() => cliente(falso).pixels(TOKEN, '../me'), (erro) => erro.status === 400);
  await assert.rejects(() => cliente(falso).termosAceitos(TOKEN, 'x'), (erro) => erro.status === 400);
  assert.equal(falso.chamadas.length, 0);
});

test('token recusado (190, 102) nas listas vira "reconectar", sem vazar token nem segredo', async () => {
  for (const code of [190, 102]) {
    const falso = respostas({ status: 400, corpo: { error: { code, error_subcode: 463, message: `expirou ${TOKEN}` } } });
    await assert.rejects(() => cliente(falso).contasDeAnuncios(TOKEN), (erro) => {
      assert.equal(erro.reconectar, true);
      const texto = `${erro.message} ${erro.stack} ${JSON.stringify(erro)}`;
      for (const marcador of [TOKEN, SEGREDO, 'graph.facebook.com']) assert.equal(texto.includes(marcador), false);
      return true;
    });
  }
});

test('falha de rede nas listas não leva a URL (que traz o token)', async () => {
  const falso = respostas(new Error(`connect ECONNREFUSED https://graph.facebook.com/x?access_token=${TOKEN}`));
  await assert.rejects(() => cliente(falso).paginas(TOKEN), (erro) => !erro.message.includes(TOKEN) && erro.status === 502);
});

test('prova do segredo: HMAC de token|tempo, como a página de segurança', () => {
  const prova = provaDoSegredo({ token: TOKEN, appSecret: SEGREDO, agora: AGORA + 999 });
  assert.equal(prova.appsecret_time, String(AGORA / 1000));
  assert.equal(prova.appsecret_proof, createHmac('sha256', SEGREDO).update(`${TOKEN}|${AGORA / 1000}`).digest('hex'));
});

test('dias para vencer', () => {
  assert.equal(diasParaVencer(null, AGORA), null);
  assert.equal(diasParaVencer('lixo', AGORA), null);
  assert.equal(diasParaVencer(new Date(AGORA + 6.5 * 86_400_000), AGORA), 7);
  assert.equal(diasParaVencer(new Date(AGORA - 1000), AGORA), 0);
});
