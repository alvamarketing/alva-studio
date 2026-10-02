import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { criarServicoDeConexaoMeta } from '../server/meta-conexao-servico.mjs';
import { criarClienteDaConexao } from '../server/meta-conexao-cliente.mjs';
import { lerConfiguracaoDaMeta, VERSAO_DA_GRAPH_API } from '../server/meta-config.mjs';
import { MetaConnectionsRepository } from '../server/repositories/meta-connections-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const CHAVE = 'd'.repeat(64);
const SEGREDO = 'segredo-do-app-marcador';
const TOKEN_CURTO = 'EAAG-curto-marcador';
const TOKEN_LONGO = 'EAAG-longo-marcador';
const ORIGEM = 'https://studio.alva.test';

// Uma Graph API de mentira: responde a troca, a extensão, o /me e as permissões, e registra
// cada chamada para provar quando a Meta NÃO foi chamada.
function metaFalsa({ falhaNaTroca = false, usuario = '10203040' } = {}) {
  const chamadas = [];
  const fetch = async (url, opcoes = {}) => {
    const alvo = new URL(String(url));
    chamadas.push({ caminho: alvo.pathname, metodo: opcoes.method || 'GET', parametros: alvo.searchParams });
    const responder = (status, corpo) => ({ ok: status < 400, status, json: async () => corpo });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/oauth/access_token`) {
      if (alvo.searchParams.get('grant_type') === 'fb_exchange_token') return responder(200, { access_token: TOKEN_LONGO, expires_in: 5_184_000 });
      if (falhaNaTroca) return responder(400, { error: { message: `bad code ${alvo.searchParams.get('code')}`, code: 100 } });
      return responder(200, { access_token: TOKEN_CURTO, expires_in: 3600 });
    }
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/me`) return responder(200, { id: usuario, name: 'Pessoa na Meta' });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/me/permissions`) return responder(200, { data: [{ permission: 'ads_management', status: 'granted' }, { permission: 'ads_read', status: 'granted' }, { permission: 'business_management', status: 'declined' }] });
    if (alvo.pathname === `/${VERSAO_DA_GRAPH_API}/${usuario}/permissions` && opcoes.method === 'DELETE') return responder(200, { success: true });
    throw new Error(`chamada inesperada ${alvo.pathname}`);
  };
  return { fetch, chamadas };
}

let database;
let contador = 0;

async function empresa() {
  contador += 1;
  const user = (await database.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [`s${contador}@alva.test`, 'hash', `Dona ${contador}`])).rows[0];
  const company = (await database.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${contador}`, `empresa-s${contador}`])).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', $2, $3) RETURNING id", [company.id, `projeto-s${contador}`, user.id])).rows[0];
  return { companyId: company.id, projectId: project.id, userId: user.id, sessionId: `sessao-${contador}` };
}

function montar(meta = metaFalsa(), env = {}) {
  const configuracao = lerConfiguracaoDaMeta({ META_APP_ID: '111222333', META_APP_SECRET: SEGREDO, ...env }, { publicOrigin: ORIGEM });
  const repository = new MetaConnectionsRepository(database, { vault: new SecretVault({ masterKey: CHAVE }) });
  const servico = criarServicoDeConexaoMeta({ repository, cliente: criarClienteDaConexao({ fetch: meta.fetch, configuracao }), configuracao, chaveMestra: CHAVE });
  return { servico, meta, repository };
}

const stateDa = (url) => new URL(url).searchParams.get('state');
const recusado = (erro) => erro.status === 400 && /conectar/i.test(erro.message);

test('conexão com a Meta: serviço (Postgres, Meta falsa)', async (t) => {
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  database = createDatabase({ connectionString });
  await migrate(database);

  await t.test('iniciar e concluir conecta a empresa, com token longo e cifrado', async () => {
    const escopo = await empresa();
    const { servico, meta } = montar();
    const { url } = await servico.iniciar({ ...escopo, origem: 'http://127.0.0.1:1' });
    const endereco = new URL(url);
    assert.equal(endereco.searchParams.get('redirect_uri'), `${ORIGEM}/conexoes/meta/retorno`);
    assert.equal(meta.chamadas.length, 0, 'iniciar não fala com a Meta');
    const resultado = await servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'codigo-1', state: stateDa(url) });
    assert.equal(resultado.estado, 'conectado');
    assert.equal(resultado.projectId, escopo.projectId);
    assert.equal(resultado.conexao.nome, 'Pessoa na Meta');
    assert.equal(JSON.stringify(resultado).includes('marcador'), false);
    assert.deepEqual(meta.chamadas.map((c) => c.caminho), [
      `/${VERSAO_DA_GRAPH_API}/oauth/access_token`, `/${VERSAO_DA_GRAPH_API}/oauth/access_token`, `/${VERSAO_DA_GRAPH_API}/me`, `/${VERSAO_DA_GRAPH_API}/me/permissions`,
    ]);
    // A troca repete o redirect do diálogo, letra por letra.
    assert.equal(meta.chamadas[0].parametros.get('redirect_uri'), `${ORIGEM}/conexoes/meta/retorno`);
    // O /me já usa o token longo.
    assert.equal(meta.chamadas[2].parametros.get('access_token'), TOKEN_LONGO);
    const estado = await servico.estado({ companyId: escopo.companyId });
    assert.equal(estado.conectado, true);
    assert.equal(estado.conectadoPor.nome, `Dona ${contador}`);
    assert.deepEqual(estado.permissoesFaltando, ['business_management', 'pages_show_list', 'pages_read_engagement']);
    assert.equal(JSON.stringify(estado).includes('marcador'), false);
    const { rows } = await database.query('SELECT encrypted_token FROM meta_connections WHERE company_id = $1', [escopo.companyId]);
    assert.equal(rows[0].encrypted_token.includes(TOKEN_LONGO), false);
  });

  await t.test('callback sem state, com state forjado ou vazio, é recusado sem chamar a Meta', async () => {
    const escopo = await empresa();
    const { servico, meta } = montar();
    const contexto = { companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId };
    await assert.rejects(() => servico.concluir({ ...contexto, code: 'c' }), recusado);
    await assert.rejects(() => servico.concluir({ ...contexto, code: 'c', state: '' }), recusado);
    await assert.rejects(() => servico.concluir({ ...contexto, code: 'c', state: 'abc.def' }), recusado);
    assert.equal(meta.chamadas.length, 0);
  });

  await t.test('state reusado, de outra sessão, de outro usuário ou de outra empresa é recusado sem chamar a Meta', async () => {
    const escopo = await empresa();
    const outra = await empresa();
    const { servico, meta } = montar();
    const contexto = { companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId };
    const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
    await assert.rejects(() => servico.concluir({ ...contexto, sessionId: 'outra-sessao', code: 'c', state }), recusado);
    await assert.rejects(() => servico.concluir({ ...contexto, userId: outra.userId, code: 'c', state }), recusado);
    await assert.rejects(() => servico.concluir({ ...contexto, companyId: outra.companyId, code: 'c', state }), recusado);
    assert.equal(meta.chamadas.length, 0, 'nenhuma tentativa falsa chegou à Meta');
    await servico.concluir({ ...contexto, code: 'c', state });
    const antes = meta.chamadas.length;
    await assert.rejects(() => servico.concluir({ ...contexto, code: 'c', state }), recusado);
    assert.equal(meta.chamadas.length, antes, 'o state reusado não chega à Meta');
  });

  await t.test('access_denied volta com aviso, consome o state e não grava nada', async () => {
    const escopo = await empresa();
    const { servico, meta } = montar();
    const contexto = { companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId };
    const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
    const resultado = await servico.concluir({ ...contexto, error: 'access_denied', state });
    assert.equal(resultado.estado, 'cancelado');
    assert.match(resultado.aviso, /cancel/i);
    assert.equal(meta.chamadas.length, 0);
    assert.equal((await servico.estado({ companyId: escopo.companyId })).conectado, false);
    await assert.rejects(() => servico.concluir({ ...contexto, code: 'c', state }), recusado);
  });

  await t.test('troca recusada pela Meta não grava e não vaza o código', async () => {
    const escopo = await empresa();
    const { servico } = montar(metaFalsa({ falhaNaTroca: true }));
    const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
    await assert.rejects(
      () => servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'codigo-secreto-marcador', state }),
      (erro) => !erro.message.includes('marcador') && /Conecte de novo/.test(erro.message),
    );
    assert.equal((await servico.estado({ companyId: escopo.companyId })).conectado, false);
  });

  await t.test('iniciar recusa projeto de outra empresa', async () => {
    const escopo = await empresa();
    const outra = await empresa();
    const { servico } = montar();
    await assert.rejects(() => servico.iniciar({ ...escopo, projectId: outra.projectId, origem: ORIGEM }));
  });

  await t.test('desconectar apaga a conexão e mantém os públicos e a escolha do projeto (D10)', async () => {
    const escopo = await empresa();
    // Pessoa da Meta só desta empresa: as outras empresas do arquivo usam outra.
    const { servico, meta } = montar(metaFalsa({ usuario: '99887766' }));
    const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
    const { conexao } = await servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'c', state });
    await database.query(
      "INSERT INTO meta_audience_credentials (company_id, project_id, ad_account_id, encrypted_token, source, connection_id) VALUES ($1, $2, '4455', NULL, 'connection', $3)",
      [escopo.companyId, escopo.projectId, conexao.id],
    );
    await database.query(
      "INSERT INTO meta_audiences (company_id, project_id, audience_key, meta_audience_id, status) VALUES ($1, $2, 'lead', '6001', 'created')",
      [escopo.companyId, escopo.projectId],
    );
    const resposta = await servico.desconectar({ companyId: escopo.companyId });
    assert.equal(resposta.conectado, false);
    assert.equal((await servico.estado({ companyId: escopo.companyId })).conectado, false);
    const publicos = (await database.query('SELECT audience_key, meta_audience_id, status FROM meta_audiences WHERE company_id = $1', [escopo.companyId])).rows;
    assert.deepEqual(publicos, [{ audience_key: 'lead', meta_audience_id: '6001', status: 'created' }]);
    const escolha = (await database.query('SELECT ad_account_id, source, connection_id FROM meta_audience_credentials WHERE company_id = $1', [escopo.companyId])).rows;
    assert.deepEqual(escolha, [{ ad_account_id: '4455', source: 'connection', connection_id: null }]);
    // Desautoriza o app na Meta (a pessoa não usa a conexão em outra empresa do Studio).
    const revogacao = meta.chamadas.find((c) => c.metodo === 'DELETE');
    assert.equal(revogacao?.caminho, `/${VERSAO_DA_GRAPH_API}/99887766/permissions`);
  });

  await t.test('desconectar não desautoriza na Meta quando a mesma pessoa conecta outra empresa', async () => {
    const a = await empresa();
    const b = await empresa();
    const { servico, meta } = montar();
    for (const escopo of [a, b]) {
      const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
      await servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'c', state });
    }
    await servico.desconectar({ companyId: a.companyId });
    assert.equal(meta.chamadas.some((c) => c.metodo === 'DELETE'), false);
    assert.equal((await servico.estado({ companyId: b.companyId })).conectado, true);
  });

  await t.test('desconectar funciona mesmo com a Meta fora do ar', async () => {
    const escopo = await empresa();
    const { servico } = montar();
    const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
    await servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'c', state });
    const { servico: semRede } = montar({ fetch: async () => { throw new Error('rede'); }, chamadas: [] });
    assert.equal((await semRede.desconectar({ companyId: escopo.companyId })).conectado, false);
    assert.equal((await semRede.estado({ companyId: escopo.companyId })).conectado, false);
  });

  await t.test('marcar para reconectar muda o estado e conectar de novo limpa', async () => {
    const escopo = await empresa();
    const { servico } = montar();
    const conectar = async () => {
      const state = stateDa((await servico.iniciar({ ...escopo, origem: ORIGEM })).url);
      await servico.concluir({ companyId: escopo.companyId, userId: escopo.userId, sessionId: escopo.sessionId, code: 'c', state });
    };
    await conectar();
    await servico.marcarParaReconectar({ companyId: escopo.companyId, motivo: 'expirado' });
    const estado = await servico.estado({ companyId: escopo.companyId });
    assert.equal(estado.conectado, true);
    assert.equal(estado.precisaReconectar, true);
    await conectar();
    assert.equal((await servico.estado({ companyId: escopo.companyId })).precisaReconectar, false);
  });
});
