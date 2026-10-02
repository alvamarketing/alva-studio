import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteDePublicos, MetaApiError } from '../server/meta-publicos-cliente.mjs';
import { VERSAO_DA_GRAPH_API } from '../server/tracking-destinos.mjs';
import { PUBLICOS, publicoPorChave, regraDoPublico } from '../server/meta-publicos.mjs';

// Nenhum destes testes toca a rede: o `fetch` é falso e registra o que o cliente mandaria.
// O TOKEN abaixo é inventado para provar que ele nunca aparece num erro.
const TOKEN = 'EAAG-token-de-teste-que-nao-pode-vazar';
const CONTA = '9876543210';
const PIXEL = '123456789012345';

function respostas(...lista) {
  const chamadas = [];
  const fetchFalso = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', cabecalhos: opcoes.headers || {}, corpo: opcoes.body });
    const proximo = lista.shift();
    if (!proximo) throw new Error('chamada inesperada');
    if (proximo instanceof Error) throw proximo;
    return { ok: proximo.status < 400, status: proximo.status, json: async () => proximo.corpo, text: async () => JSON.stringify(proximo.corpo) };
  };
  return { fetch: fetchFalso, chamadas };
}
const cliente = (falso) => criarClienteDePublicos({ fetch: falso.fetch, token: TOKEN, contaDeAnuncios: CONTA });

test('criar: POST em act_<conta>/customaudiences, na versão única da Graph API, com o corpo da documentação', async () => {
  const falso = respostas({ status: 200, corpo: { id: '6001' } });
  const definicao = publicoPorChave('vsl_50');
  const regra = regraDoPublico(definicao, PIXEL);
  const criado = await cliente(falso).criar({ nome: 'Alva · Assistiu 50% da VSL', regra });
  assert.deepEqual(criado, { id: '6001' });
  assert.equal(falso.chamadas.length, 1);
  const [chamada] = falso.chamadas;
  assert.equal(chamada.metodo, 'POST');
  assert.equal(chamada.url, `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/act_${CONTA}/customaudiences`);
  assert.equal(chamada.url.includes(TOKEN), false, 'o token não vai na URL de escrita');
  const corpo = new URLSearchParams(chamada.corpo);
  assert.deepEqual([...corpo.keys()].sort(), ['access_token', 'name', 'prefill', 'rule']);
  assert.equal(corpo.get('name'), 'Alva · Assistiu 50% da VSL');
  assert.equal(corpo.get('prefill'), '1');
  assert.equal(corpo.get('access_token'), TOKEN);
  assert.deepEqual(JSON.parse(corpo.get('rule')), regra, 'a regra vai como string JSON, como a Meta pede');
  assert.equal(JSON.parse(corpo.get('rule')).inclusions.rules[0].retention_seconds, 30 * 86400);
});

test('a versão da Graph API vem de um lugar só', () => {
  assert.match(VERSAO_DA_GRAPH_API, /^v\d+\.\d+$/);
});

test('listar: segue a paginação e devolve id, nome e o pixel da regra', async () => {
  const regra = JSON.stringify(regraDoPublico(publicoPorChave('lead'), PIXEL));
  const falso = respostas(
    { status: 200, corpo: { data: [{ id: '1', name: 'Outro' }], paging: { next: `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/act_${CONTA}/customaudiences?after=ABC&access_token=${TOKEN}` } } },
    { status: 200, corpo: { data: [{ id: '2', name: 'Alva · Virou lead', rule: regra }] } },
  );
  const lista = await cliente(falso).listar();
  assert.deepEqual(lista, [{ id: '1', nome: 'Outro', pixelId: null }, { id: '2', nome: 'Alva · Virou lead', pixelId: PIXEL }]);
  const primeira = new URL(falso.chamadas[0].url);
  assert.equal(falso.chamadas[0].metodo, 'GET');
  assert.equal(primeira.pathname, `/${VERSAO_DA_GRAPH_API}/act_${CONTA}/customaudiences`);
  assert.equal(primeira.searchParams.get('fields'), 'id,name,rule');
  assert.equal(primeira.searchParams.get('access_token'), TOKEN);
  assert.equal(falso.chamadas.length, 2);
});

test('listar: não segue um "next" que aponta para fora da Graph API', async () => {
  const falso = respostas({ status: 200, corpo: { data: [], paging: { next: `https://outro-host.test/roubo?access_token=${TOKEN}` } } });
  await cliente(falso).listar();
  assert.equal(falso.chamadas.length, 1, 'o token não pode ser entregue a outro host');
});

const erroDaMeta = (code, extra = {}) => ({ status: 400, corpo: { error: { message: `msg interna ${code}`, type: 'OAuthException', code, fbtrace_id: 'x', ...extra } } });

for (const [code, esperado, fatal] of [
  [190, /token.*(inválido|expirado)/i, true],
  [200, /ads_management/, true],
  [100, /recusou/i, false],
  [80003, /muitas chamadas/i, false],
]) {
  test(`erro ${code} da Meta vira mensagem em português`, async () => {
    const falso = respostas(erroDaMeta(code, code === 100 ? { error_user_msg: 'Regra inválida' } : {}));
    await assert.rejects(() => cliente(falso).criar({ nome: 'n', regra: {} }), (erro) => {
      assert.ok(erro instanceof MetaApiError);
      assert.match(erro.message, esperado);
      assert.equal(erro.fatal, fatal);
      assert.equal(erro.code, code);
      return true;
    });
  });
}

test('o token nunca aparece numa mensagem de erro, nem quando a Meta o repete', async () => {
  const falso = respostas(erroDaMeta(100, { error_user_msg: `Falhou com ${TOKEN} em https://graph.facebook.com/x?access_token=${TOKEN}` }));
  await assert.rejects(() => cliente(falso).criar({ nome: 'n', regra: {} }), (erro) => {
    assert.equal(erro.message.includes(TOKEN), false);
    assert.equal(JSON.stringify(erro).includes(TOKEN), false);
    assert.equal(/https?:\/\//.test(erro.message), false);
    return true;
  });
});

test('falha de rede vira mensagem em português e não vaza a URL com o token', async () => {
  const falso = respostas(new Error(`getaddrinfo ENOTFOUND graph.facebook.com?access_token=${TOKEN}`));
  await assert.rejects(() => cliente(falso).listar(), (erro) => {
    assert.match(erro.message, /não foi possível falar com a Meta/i);
    assert.equal(erro.message.includes(TOKEN), false);
    assert.equal(erro.fatal, false);
    return true;
  });
});

test('resposta de sucesso sem id é tratada como falha, não como público criado', async () => {
  const falso = respostas({ status: 200, corpo: {} });
  await assert.rejects(() => cliente(falso).criar({ nome: 'n', regra: {} }), /sem identificador/i);
});

test('conta e token são validados antes de qualquer chamada', () => {
  assert.throws(() => criarClienteDePublicos({ fetch: async () => {}, token: '', contaDeAnuncios: CONTA }), /token/i);
  assert.throws(() => criarClienteDePublicos({ fetch: async () => {}, token: TOKEN, contaDeAnuncios: 'abc' }), /conta de anúncios/i);
  assert.ok(criarClienteDePublicos({ fetch: async () => {}, token: TOKEN, contaDeAnuncios: `act_${CONTA}` }), 'aceita o prefixo act_');
});

test('o catálogo inteiro vira regras que cabem nos limites da Meta (até 10 regras, 100 filtros)', () => {
  for (const publico of PUBLICOS) {
    const regra = regraDoPublico(publico, PIXEL);
    assert.ok(regra.inclusions.rules.length <= 10);
  }
});

test('recusa de dados diz em português o que costuma faltar: aceitar os Termos de Públicos Personalizados', async () => {
  // A documentação da Meta não lista um código próprio para "termos não aceitos": o erro chega
  // como recusa genérica. Em vez de adivinhar um código, a mensagem aponta a causa mais comum.
  const falso = respostas({ status: 400, corpo: { error: { code: 100, message: 'Invalid parameter' } } });
  await assert.rejects(
    () => cliente(falso).criar({ nome: 'Alva · X', regra: regraDoPublico(publicoPorChave('vsl_50'), PIXEL) }),
    (erro) => /Termos de Públicos Personalizados/.test(erro.message) && /Gerenciador de Anúncios/.test(erro.message) && !erro.fatal,
  );
});
