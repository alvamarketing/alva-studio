import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServicoDePublicos } from '../server/meta-publicos-servico.mjs';

// Públicos com a conta escolhida pela conexão: o token é o da conexão da empresa (com a prova
// do segredo do app), e a credencial colada continua valendo para quem não escolheu assim.
const TOKEN = 'EAAG-token-da-conexao-marcador';
const PROVA = { appsecret_proof: 'a'.repeat(64), appsecret_time: '1790000000' };
const escopo = { companyId: 'c1', projectId: 'p1' };

function repositorioFalso(credenciais) {
  const gravados = [];
  return {
    gravados,
    credenciaisPublicas: async () => credenciais && { adAccountId: credenciais.adAccountId, origem: credenciais.origem },
    credenciais: async () => credenciais,
    listar: async () => [],
    gravar: async (item) => { gravados.push(item); },
  };
}
const tracking = { destinationsFor: async () => [{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' } }] };

function metaFalsa(resposta = null) {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: new URL(String(url)), metodo: opcoes.method || 'GET', corpo: new URLSearchParams(opcoes.body ?? '') });
    if (resposta) return { ok: false, status: 400, json: async () => resposta };
    if ((opcoes.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ data: [] }) };
    return { ok: true, status: 200, json: async () => ({ id: '9001' }) };
  };
  return { fetch, chamadas };
}

function resolvedor(resultado) {
  const marcadas = [];
  return { marcadas, configurado: true, resolver: async () => resultado, marcarParaReconectar: async (input) => { marcadas.push(input); } };
}

test('pela conexão: lista e cria com o token da conexão e a prova do segredo', async () => {
  const meta = metaFalsa();
  const servico = criarServicoDePublicos({ repository: repositorioFalso({ adAccountId: '111', origem: 'connection', token: null }), tracking, fetch: meta.fetch, tokenDaConexao: resolvedor({ token: TOKEN, ...PROVA }) });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(resultados[0].estado, 'criado');
  const [listar, criar] = meta.chamadas;
  assert.match(listar.url.pathname, /\/act_111\/customaudiences$/);
  assert.equal(listar.url.searchParams.get('access_token'), TOKEN);
  assert.equal(listar.url.searchParams.get('appsecret_proof'), PROVA.appsecret_proof);
  assert.equal(criar.corpo.get('access_token'), TOKEN);
  assert.equal(criar.corpo.get('appsecret_time'), PROVA.appsecret_time);
});

test('pela conexão, sem conexão utilizável: 409 pedindo reconectar, nada sai', async () => {
  const meta = metaFalsa();
  const servico = criarServicoDePublicos({ repository: repositorioFalso({ adAccountId: '111', origem: 'connection', token: null }), tracking, fetch: meta.fetch, tokenDaConexao: resolvedor(null) });
  await assert.rejects(() => servico.sincronizar({ ...escopo, chaves: ['lead'] }), (erro) => erro.status === 409 && /Reconectar/.test(erro.message));
  assert.equal(meta.chamadas.length, 0);
  const estado = await servico.estado(escopo);
  assert.ok(estado.faltando.some((item) => item.chave === 'conexao'));
  assert.equal(estado.credenciais.origem, 'connection');
});

test('pela conexão, a Meta recusa o token (190): a conexão é marcada para reconectar', async () => {
  const meta = metaFalsa({ error: { code: 190, message: 'expirou' } });
  const tokenDaConexao = resolvedor({ token: TOKEN, ...PROVA });
  const servico = criarServicoDePublicos({ repository: repositorioFalso({ adAccountId: '111', origem: 'connection', token: null }), tracking, fetch: meta.fetch, tokenDaConexao });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(resultados[0].estado, 'erro');
  assert.deepEqual(tokenDaConexao.marcadas, [{ companyId: 'c1', motivo: 'publicos_token_recusado' }]);
});

test('credencial manual continua valendo, sem consultar a conexão e sem prova', async () => {
  const meta = metaFalsa();
  let consultou = false;
  const tokenDaConexao = { configurado: true, resolver: async () => { consultou = true; return null; }, marcarParaReconectar: async () => {} };
  const servico = criarServicoDePublicos({ repository: repositorioFalso({ adAccountId: '111', origem: 'manual', token: 'colado' }), tracking, fetch: meta.fetch, tokenDaConexao });
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(consultou, false);
  assert.equal(meta.chamadas[0].url.searchParams.get('access_token'), 'colado');
  assert.equal(meta.chamadas[0].url.searchParams.has('appsecret_proof'), false);
});
