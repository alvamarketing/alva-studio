import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { VERSAO_DA_GRAPH_API } from '../server/meta-config.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

// O servidor inteiro, com banco de verdade e a Meta de mentira. Os marcadores abaixo são
// inventados: o teste prova que nenhum deles aparece em resposta alguma.
const SEGREDO = 'segredo-do-app-marcador-http';
const TOKEN = 'EAAG-token-marcador-http';
const CODIGO = 'codigo-marcador-http';
const dono = { name: 'Dona', email: 'dona@alva.test', password: 'senha-longa-de-teste' };

function metaFalsa() {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    const alvo = new URL(String(url));
    chamadas.push({ caminho: alvo.pathname, metodo: opcoes.method || 'GET' });
    const responder = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/oauth/access_token`) return responder({ access_token: TOKEN, expires_in: 5_184_000 });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/me`) return responder({ id: '10203040', name: 'Pessoa na Meta' });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/me/permissions`) return responder({ data: [{ permission: 'ads_management', status: 'granted' }] });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/10203040/permissions`) return responder({ success: true });
    throw new Error(`chamada inesperada ${alvo.pathname}`);
  };
  return { fetch, chamadas };
}

async function iniciar(t, { env }) {
  const chaveAnterior = process.env.TRACKING_MASTER_KEY;
  process.env.TRACKING_MASTER_KEY = 'e'.repeat(64);
  t.after(() => { if (chaveAnterior === undefined) delete process.env.TRACKING_MASTER_KEY; else process.env.TRACKING_MASTER_KEY = chaveAnterior; });
  let database;
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  database = createDatabase({ connectionString });
  await migrate(database);
  const meta = metaFalsa();
  const server = createApp({ database, sessionOptions: { sessionTTL: 60_000 }, metaOptions: { env, fetch: meta.fetch } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const respostas = [];
  const pedir = async (path, method = 'GET', corpo, headers = {}) => {
    const resposta = await fetch(base + path, {
      method,
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    if (resposta.headers.has('set-cookie')) cookie = resposta.headers.get('set-cookie').split(';')[0];
    const texto = await resposta.text();
    respostas.push(texto);
    let dados = null;
    try { dados = JSON.parse(texto); } catch { dados = null; }
    return { status: resposta.status, headers: resposta.headers, texto, dados };
  };
  const sessao = await pedir('/api/setup', 'POST', dono);
  assert.equal(sessao.status, 201);
  // O `fetch` do Node troca Sec-Fetch-Mode por "cors"; a navegação de topo precisa do http cru.
  const navegar = (path, headers) => new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method: 'GET', headers }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (parte) => { texto += parte; });
      res.on('end', () => { respostas.push(texto); resolve({ status: res.statusCode, headers: new Headers(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), texto }); });
    });
    req.on('error', reject);
    req.end();
  });
  return { base, pedir, navegar, meta, respostas, companyId: sessao.dados.currentCompanyId, projectId: sessao.dados.currentProjectId };
}

const LIGADA = { META_APP_ID: '111222333', META_APP_SECRET: SEGREDO };
// A volta do Facebook chega como navegação de topo vinda de outro site.
const NAVEGACAO_CROSS_SITE = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };

test('conexão com a Meta pelo servidor: sessão, start, retorno, finish e desconectar', async (t) => {
  const { pedir, navegar, meta, respostas, companyId, projectId } = await iniciar(t, { env: LIGADA });
  const base = `/api/companies/${companyId}/meta-connection`;

  assert.equal((await pedir('/api/session')).dados.runtime.metaConexao, true);
  assert.equal((await pedir(base)).dados.conectado, false);

  const inicio = await pedir(`${base}/start`, 'POST', { projectId });
  assert.equal(inicio.status, 200);
  const dialogo = new URL(inicio.dados.url);
  assert.equal(dialogo.origin, 'https://www.facebook.com');
  const state = dialogo.searchParams.get('state');

  // A página de retorno abre numa navegação cross-site e não devolve o code nem o state.
  const retorno = await navegar(`/conexoes/meta/retorno?code=${CODIGO}&state=${encodeURIComponent(state)}`, NAVEGACAO_CROSS_SITE);
  assert.equal(retorno.status, 200);
  assert.match(retorno.headers.get('content-type'), /text\/html/);
  assert.equal(retorno.texto.includes(CODIGO), false);
  assert.equal(retorno.texto.includes(state), false);
  assert.doesNotMatch(retorno.texto, /<script(?![^>]*\bsrc=)[^>]*>/i, 'nenhum script em linha');
  assert.match(retorno.texto, /<script[^>]+src="\/conexao-meta-retorno\.js"/);
  assert.match(retorno.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(retorno.headers.get('referrer-policy'), 'no-referrer');
  assert.match(retorno.headers.get('cache-control'), /no-store/);
  assert.equal((await pedir('/conexao-meta-retorno.js')).status, 200);

  // O finish vindo de outro site é recusado antes de chegar ao serviço.
  const cruzado = await pedir(`${base}/finish`, 'POST', { code: CODIGO, state }, { Origin: 'https://facebook.com', 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(cruzado.status, 403);
  const semOrigem = await pedir(`${base}/finish`, 'POST', { code: CODIGO, state }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(semOrigem.status, 403);
  assert.equal(meta.chamadas.length, 0);

  const fim = await pedir(`${base}/finish`, 'POST', { code: CODIGO, state });
  assert.equal(fim.status, 200);
  assert.equal(fim.dados.estado, 'conectado');
  assert.equal(fim.dados.projectId, projectId);

  const estado = await pedir(base);
  assert.equal(estado.dados.conectado, true);
  assert.equal(estado.dados.nome, 'Pessoa na Meta');
  assert.equal(estado.dados.conectadoPor.nome, 'Dona');

  // O mesmo state de novo: recusado, e a Meta não é chamada outra vez.
  const chamadasAntes = meta.chamadas.length;
  assert.equal((await pedir(`${base}/finish`, 'POST', { code: CODIGO, state })).status, 400);
  assert.equal(meta.chamadas.length, chamadasAntes);

  assert.equal((await pedir(base, 'DELETE')).dados.conectado, false);
  assert.equal((await pedir(base)).dados.conectado, false);

  for (const texto of respostas) {
    for (const marcador of [TOKEN, SEGREDO, CODIGO]) assert.equal(texto.includes(marcador), false, `resposta vazou ${marcador}`);
  }
});

test('sem META_APP_ID a sessão diz desligado e as rotas respondem 409', async (t) => {
  const { pedir, companyId, projectId } = await iniciar(t, { env: {} });
  assert.equal((await pedir('/api/session')).dados.runtime.metaConexao, false);
  assert.equal((await pedir(`/api/companies/${companyId}/meta-connection`)).status, 409);
  assert.equal((await pedir(`/api/companies/${companyId}/meta-connection/start`, 'POST', { projectId })).status, 409);
});
