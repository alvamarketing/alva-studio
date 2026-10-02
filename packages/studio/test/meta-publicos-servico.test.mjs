import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { MetaAudiencesRepository } from '../server/repositories/meta-audiences-repository.mjs';
import { criarServicoDePublicos } from '../server/meta-publicos-servico.mjs';
import { PUBLICOS, publicoPorChave, regraDoPublico } from '../server/meta-publicos.mjs';
import { VERSAO_DA_GRAPH_API } from '../server/tracking-destinos.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const TOKEN = 'EAAG-token-de-gerenciar-anuncios-NAO-VAZAR';
const CONTA = '555000111';
const PIXEL = '123456789012345';

async function ambiente(t) {
  // O pool fecha antes de o contêiner cair: `t.after` roda na ordem do registro, então o
  // fechamento é registrado antes de o contêiner existir.
  let database;
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  database = createDatabase({ connectionString });
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('p@alva.test', 'hash', 'Pessoa') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Empresa', 'empresa') RETURNING id")).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', 'projeto', $2) RETURNING id", [company.id, user.id])).rows[0];
  return { database, escopo: { companyId: company.id, projectId: project.id }, outro: { companyId: company.id } };
}

// Um servidor da Meta de mentira: guarda os públicos criados e responde como a Graph API.
function metaFalsa({ existentes = [], falhas = {} } = {}) {
  const chamadas = [];
  const publicos = [...existentes];
  let proximoId = 9000;
  const fetchFalso = async (url, opcoes = {}) => {
    const alvo = new URL(String(url));
    const metodo = opcoes.method || 'GET';
    chamadas.push({ metodo, url: String(url), corpo: opcoes.body });
    const responder = (status, corpo) => ({ ok: status < 400, status, json: async () => corpo });
    if (metodo === 'GET') return responder(200, { data: publicos.map(({ id, name, rule }) => ({ id, name, rule })) });
    const corpo = new URLSearchParams(opcoes.body);
    const nome = corpo.get('name');
    if (falhas[nome]) return responder(400, { error: falhas[nome] });
    if (falhas['*']) return responder(400, { error: falhas['*'] });
    proximoId += 1;
    publicos.push({ id: String(proximoId), name: nome, rule: corpo.get('rule') });
    return responder(200, { id: String(proximoId) });
  };
  return { fetch: fetchFalso, chamadas, publicos, falhas };
}

const trackingComPixel = (pixelId = PIXEL) => ({
  async destinationsFor() {
    return [{ provider: 'meta', configured: Boolean(pixelId), publicConfiguration: pixelId ? { pixel_id: pixelId } : {} }, { provider: 'tiktok', configured: false, publicConfiguration: {} }];
  },
});

const montar = (db, meta, tracking = trackingComPixel()) => {
  const repository = new MetaAudiencesRepository(db, { masterKey: 'chave-de-teste' });
  return { repository, servico: criarServicoDePublicos({ repository, tracking, fetch: meta.fetch }) };
};

test('o token é gravado cifrado, nunca em texto aberto, e nunca volta numa leitura', async (t) => {
  const { database, escopo } = await ambiente(t);
  const { servico } = montar(database, metaFalsa());
  await servico.salvarCredenciais({ ...escopo, adAccountId: `act_${CONTA}`, token: TOKEN });
  const { rows } = await database.query('SELECT ad_account_id, encrypted_token FROM meta_audience_credentials');
  assert.equal(rows[0].ad_account_id, CONTA, 'o prefixo act_ é descartado');
  assert.equal(rows[0].encrypted_token.includes(TOKEN), false, 'o token não está em texto aberto no banco');
  const estado = await servico.estado(escopo);
  assert.equal(estado.credenciais.configuradas, true);
  assert.equal(estado.credenciais.adAccountId, CONTA);
  assert.equal(JSON.stringify(estado).includes(TOKEN), false);
});

test('regravar a conta sem novo token mantém o token; trocar a conta esquece os públicos da conta antiga', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico, repository } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA });
  assert.equal((await repository.credenciais(escopo)).token, TOKEN);
  assert.equal((await servico.estado(escopo)).publicos.find((p) => p.chave === 'lead').estado, 'criado', 'mesma conta: o público continua');
  await servico.salvarCredenciais({ ...escopo, adAccountId: '777000999' });
  assert.equal((await servico.estado(escopo)).publicos.find((p) => p.chave === 'lead').estado, 'nao_criado', 'outra conta: o id antigo não vale mais');
});

test('sem token o estado diz o que falta, e sincronizar recusa sem chamar a Meta', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta);
  const estado = await servico.estado(escopo);
  assert.deepEqual(estado.faltando.map((item) => item.chave), ['credenciais']);
  assert.equal(estado.publicos.length, PUBLICOS.length);
  await assert.rejects(() => servico.sincronizar({ ...escopo, chaves: ['lead'] }), (erro) => erro.status === 409 && /token/i.test(erro.message));
  assert.equal(meta.chamadas.length, 0);
});

test('sem pixel da Meta no projeto, falta o pixel e nada é enviado', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta, trackingComPixel(null));
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const estado = await servico.estado(escopo);
  assert.deepEqual(estado.faltando.map((item) => item.chave), ['pixel']);
  await assert.rejects(() => servico.sincronizar({ ...escopo, chaves: ['lead'] }), (erro) => erro.status === 409 && /pixel/i.test(erro.message));
  assert.equal(meta.chamadas.length, 0);
});

test('sincronizar cria na Meta o público escolhido, com a regra do pixel do projeto, e guarda o id', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['vsl_50'] });
  assert.deepEqual(resultados.map((r) => [r.chave, r.estado]), [['vsl_50', 'criado']]);
  const criacoes = meta.chamadas.filter((c) => c.metodo === 'POST');
  assert.equal(criacoes.length, 1);
  assert.equal(criacoes[0].url, `https://graph.facebook.com/${VERSAO_DA_GRAPH_API}/act_${CONTA}/customaudiences`);
  const corpo = new URLSearchParams(criacoes[0].corpo);
  assert.equal(corpo.get('name'), 'Alva · Assistiu 50% da VSL');
  assert.deepEqual(JSON.parse(corpo.get('rule')), regraDoPublico(publicoPorChave('vsl_50'), PIXEL));
  const estado = await servico.estado(escopo);
  const salvo = estado.publicos.find((p) => p.chave === 'vsl_50');
  assert.equal(salvo.estado, 'criado');
  assert.equal(salvo.metaId, '9001');
  assert.equal(estado.publicos.find((p) => p.chave === 'lead').estado, 'nao_criado', 'só o que foi escolhido é criado');
});

test('idempotência: sincronizar duas vezes não cria o público duas vezes', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await servico.sincronizar({ ...escopo, chaves: ['lead', 'vsl_completa'] });
  const segunda = await servico.sincronizar({ ...escopo, chaves: ['lead', 'vsl_completa'] });
  assert.equal(meta.chamadas.filter((c) => c.metodo === 'POST').length, 2);
  assert.equal(meta.publicos.length, 2);
  assert.equal(segunda.resultados.every((r) => r.estado === 'criado'), true);
});

test('idempotência: público que já existe na Meta com o mesmo nome e pixel é adotado, não duplicado', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa({ existentes: [{ id: '4242', name: 'Alva · Virou lead', rule: JSON.stringify(regraDoPublico(publicoPorChave('lead'), PIXEL)) }] });
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(meta.chamadas.filter((c) => c.metodo === 'POST').length, 0);
  assert.equal((await servico.estado(escopo)).publicos.find((p) => p.chave === 'lead').metaId, '4242');
});

test('mesmo nome ligado a outro pixel vira erro explicado, sem duplicar nem sobrescrever', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa({ existentes: [{ id: '4242', name: 'Alva · Virou lead', rule: JSON.stringify(regraDoPublico(publicoPorChave('lead'), '999888777')) }] });
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(resultados[0].estado, 'erro');
  assert.match(resultados[0].erro, /outro pixel/i);
  assert.equal(meta.chamadas.filter((c) => c.metodo === 'POST').length, 0);
});

test('erro da Meta fica no público, em português e sem token, e o resto da rodada segue', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa({ falhas: { 'Alva · Assistiu 50% da VSL': { code: 100, message: `ruim ${TOKEN}`, error_user_msg: 'Regra recusada' } } });
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['vsl_50', 'lead'] });
  assert.deepEqual(resultados.map((r) => [r.chave, r.estado]), [['vsl_50', 'erro'], ['lead', 'criado']]);
  const estado = await servico.estado(escopo);
  const falho = estado.publicos.find((p) => p.chave === 'vsl_50');
  assert.equal(falho.estado, 'erro');
  assert.match(falho.erro, /Meta recusou/);
  assert.equal(JSON.stringify(estado).includes(TOKEN), false);
  // Depois de corrigido (a Meta passa a aceitar), sincronizar de novo cria só o que falhou.
  delete meta.falhas['Alva · Assistiu 50% da VSL'];
  const segunda = await servico.sincronizar({ ...escopo, chaves: ['vsl_50', 'lead'] });
  assert.deepEqual(segunda.resultados.map((r) => [r.chave, r.estado]), [['vsl_50', 'criado'], ['lead', 'criado']]);
  assert.equal(meta.publicos.length, 2, 'o lead não foi criado de novo');
  assert.equal((await servico.estado(escopo)).publicos.find((p) => p.chave === 'vsl_50').erro, null);
});

test('erro de permissão (fatal) interrompe a rodada e marca o resto com o mesmo motivo', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa({ falhas: { '*': { code: 200, message: 'Permissions error' } } });
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const { resultados } = await servico.sincronizar({ ...escopo, chaves: ['lead', 'vsl_50', 'vsl_cta'] });
  assert.equal(meta.chamadas.filter((c) => c.metodo === 'POST').length, 1, 'não insiste depois de um erro de permissão');
  assert.deepEqual(resultados.map((r) => r.estado), ['erro', 'erro', 'erro']);
  assert.match(resultados[2].erro, /ads_management/);
});

test('chave desconhecida é recusada antes de qualquer chamada', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await assert.rejects(() => servico.sincronizar({ ...escopo, chaves: ['inventado'] }), (erro) => erro.status === 400);
  await assert.rejects(() => servico.sincronizar({ ...escopo, chaves: [] }), (erro) => erro.status === 400);
  assert.equal(meta.chamadas.length, 0);
});

test('desligar esquece o registro, não apaga nada na Meta, e ligar de novo reaproveita o público', async (t) => {
  const { database, escopo } = await ambiente(t);
  const meta = metaFalsa();
  const { servico } = montar(database, meta);
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  await servico.esquecer({ ...escopo, chave: 'lead' });
  assert.equal((await servico.estado(escopo)).publicos.find((p) => p.chave === 'lead').estado, 'nao_criado');
  assert.equal(meta.chamadas.some((c) => c.metodo === 'DELETE'), false);
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  assert.equal(meta.publicos.length, 1, 'adotou o que já existia na conta');
});

test('projetos diferentes não enxergam credenciais nem públicos uns dos outros', async (t) => {
  const { database, escopo } = await ambiente(t);
  const outroProjeto = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Outro', 'outro', (SELECT id FROM users LIMIT 1)) RETURNING id", [escopo.companyId])).rows[0];
  const { servico } = montar(database, metaFalsa());
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  const estadoDoOutro = await servico.estado({ companyId: escopo.companyId, projectId: outroProjeto.id });
  assert.equal(estadoDoOutro.credenciais.configuradas, false);
});

test('remover as credenciais apaga a linha cifrada e os registros dos públicos', async (t) => {
  const { database, escopo } = await ambiente(t);
  const { servico } = montar(database, metaFalsa());
  await servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: TOKEN });
  await servico.sincronizar({ ...escopo, chaves: ['lead'] });
  await servico.removerCredenciais(escopo);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM meta_audience_credentials')).rows[0].n, 0);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM meta_audiences')).rows[0].n, 0);
});

test('validação: token e conta mal formados são recusados na hora de salvar', async (t) => {
  const { database, escopo } = await ambiente(t);
  const { servico } = montar(database, metaFalsa());
  await assert.rejects(() => servico.salvarCredenciais({ ...escopo, adAccountId: 'abc', token: TOKEN }), (erro) => erro.status === 400);
  await assert.rejects(() => servico.salvarCredenciais({ ...escopo, adAccountId: CONTA, token: 'com espaço' }), (erro) => erro.status === 400);
  await assert.rejects(() => servico.salvarCredenciais({ ...escopo, adAccountId: CONTA }), (erro) => erro.status === 400, 'a primeira vez exige o token');
});
