import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { MetaConnectionsRepository } from '../server/repositories/meta-connections-repository.mjs';
import { MetaProjectSelectionsRepository } from '../server/repositories/meta-project-selections-repository.mjs';
import { MetaAudiencesRepository } from '../server/repositories/meta-audiences-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import { createProjectApi } from '../server/project-api.mjs';
import { criarServicoDeSelecaoMeta } from '../server/meta-selecao-servico.mjs';
import { regraDoPublico, publicoPorChave } from '../server/meta-publicos.mjs';

// F2 no Postgres de verdade (descartável): migração 035, a escolha por projeto, o destino da
// Meta com `token_source` e a credencial dos públicos pela conexão.
const vault = new SecretVault({ masterKey: 'd'.repeat(64) });
const TOKEN = 'EAAG-token-da-conexao-marcador';
let database;
let contador = 0;

async function empresa() {
  contador += 1;
  const user = (await database.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [`e${contador}@alva.test`, 'hash', `Pessoa ${contador}`])).rows[0];
  const company = (await database.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${contador}`, `empresa-e${contador}`])).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', $2, $3) RETURNING id", [company.id, `projeto-e${contador}`, user.id])).rows[0];
  return { companyId: company.id, projectId: project.id, userId: user.id };
}

test('escolha da Meta por projeto (Postgres, migração 035)', async (t) => {
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  database = createDatabase({ connectionString });
  await migrate(database);
  const conexoes = new MetaConnectionsRepository(database, { vault });
  const selecoes = new MetaProjectSelectionsRepository(database);
  const publicos = new MetaAudiencesRepository(database, { vault });
  const tracking = new TrackingRepository(database, { vault });
  const conectar = (escopo) => conexoes.salvar({ companyId: escopo.companyId, metaUserId: '10203040', nome: 'Pessoa', tipoDeToken: 'user', token: TOKEN, escopos: [], conectadoPor: escopo.userId });

  await t.test('a 035 aplicou e a escolha é gravada e relida por projeto', async () => {
    assert.equal((await database.query("SELECT version FROM schema_migrations WHERE version = '035'")).rows.length, 1);
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    assert.equal(await selecoes.ler(escopo), null);
    const salva = await selecoes.salvar({ ...escopo, connectionId: conexao.id, adAccountId: '111', adAccountNome: 'Conta', pixelId: '555', pixelNome: 'Pixel', automatica: true, userId: escopo.userId });
    assert.equal(salva.adAccountId, '111');
    assert.equal(salva.automatica, true);
    assert.equal(salva.conexaoId, conexao.id);
    const trocada = await selecoes.salvar({ ...escopo, connectionId: conexao.id, adAccountId: '222', pixelId: '666' });
    assert.equal(trocada.adAccountId, '222');
    assert.equal(trocada.automatica, false);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM meta_project_selections WHERE project_id = $1', [escopo.projectId])).rows[0].n, 1);
  });

  await t.test('ids fora do formato são recusados pelo banco', async () => {
    const escopo = await empresa();
    await assert.rejects(() => selecoes.salvar({ ...escopo, connectionId: null, adAccountId: 'act_1', pixelId: '1' }), /check/i);
    await assert.rejects(() => selecoes.salvar({ ...escopo, connectionId: null, adAccountId: '1', pixelId: 'x' }), /check/i);
  });

  await t.test('conexão de outra empresa não serve à escolha (chave composta)', async () => {
    const a = await empresa();
    const b = await empresa();
    const conexaoDeB = await conectar(b);
    await assert.rejects(() => selecoes.salvar({ ...a, connectionId: conexaoDeB.id, adAccountId: '1', pixelId: '1' }), /foreign key|violates/i);
  });

  await t.test('D6/D10: desconectar mantém a escolha (vínculo nulo), a credencial dos públicos e os públicos', async () => {
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    await selecoes.salvar({ ...escopo, connectionId: conexao.id, adAccountId: '111', pixelId: '555' });
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id });
    await publicos.gravar({ ...escopo, chave: 'lead', status: 'created', metaId: '987' });
    await conexoes.remover(escopo.companyId);
    const escolha = await selecoes.ler(escopo);
    assert.equal(escolha.adAccountId, '111');
    assert.equal(escolha.conexaoId, null);
    assert.deepEqual(await publicos.credenciaisPublicas(escopo).then(({ adAccountId, origem }) => ({ adAccountId, origem })), { adAccountId: '111', origem: 'connection' });
    assert.equal((await publicos.listar(escopo)).length, 1);
  });

  await t.test('públicos pela conexão: sem token próprio; token colado volta a origem para manual', async () => {
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    await publicos.salvarCredenciais({ ...escopo, adAccountId: '111', token: 'colado-antes' });
    await publicos.gravar({ ...escopo, chave: 'lead', status: 'created', metaId: '987' });
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id });
    assert.deepEqual(await publicos.credenciais(escopo), { adAccountId: '111', origem: 'connection', conexaoId: conexao.id, token: null });
    const { rows } = await database.query('SELECT encrypted_token FROM meta_audience_credentials WHERE project_id = $1', [escopo.projectId]);
    assert.equal(rows[0].encrypted_token, null, 'o token colado foi apagado: nunca as duas origens');
    assert.equal((await publicos.listar(escopo)).length, 1, 'mesma conta: os públicos ficam');
    // Manual sem token novo não é possível a partir da conexão.
    await assert.rejects(() => publicos.salvarCredenciais({ ...escopo, adAccountId: '111', token: null }), (erro) => erro.status === 400);
    await publicos.salvarCredenciais({ ...escopo, adAccountId: '111', token: 'colado-depois' });
    assert.deepEqual(await publicos.credenciais(escopo), { adAccountId: '111', origem: 'manual', token: 'colado-depois' });
  });

  await t.test('públicos: trocar de conta pela conexão apaga os registros da conta antiga', async () => {
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id });
    await publicos.gravar({ ...escopo, chave: 'lead', status: 'created', metaId: '987' });
    await publicos.usarConexao({ ...escopo, adAccountId: '222', connectionId: conexao.id });
    assert.equal((await publicos.listar(escopo)).length, 0);
  });

  await t.test('destino da Meta pela conexão: sem token guardado, origem pública "connection"', async () => {
    const escopo = await empresa();
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '1', access_token: 'colado' } });
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '555' }, tokenSource: 'connection' });
    const guardado = (await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta;
    assert.deepEqual(guardado, { pixel_id: '555', token_source: 'connection' });
    const publico = (await tracking.destinationsFor({ ...escopo, environment: 'production' })).find((item) => item.provider === 'meta');
    assert.deepEqual(publico.publicConfiguration, { pixel_id: '555', token_source: 'connection' });
    // Corrigir o código de teste não muda a origem.
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { test_event_code: 'TEST1' } });
    assert.equal((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta.token_source, 'connection');
    // Colar um token volta para o manual, e a origem pública some.
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { access_token: 'colado-de-novo' } });
    const manual = (await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta;
    assert.equal(manual.token_source, undefined);
    assert.equal(manual.access_token, 'colado-de-novo');
    const publicoManual = (await tracking.destinationsFor({ ...escopo, environment: 'production' })).find((item) => item.provider === 'meta');
    assert.equal(publicoManual.publicConfiguration.token_source, undefined);
  });

  await t.test('o cliente não escolhe a origem: token_source não é campo aceito, nem na configuração pública', async () => {
    const escopo = await empresa();
    await assert.rejects(() => tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '1', token_source: 'connection' } }), (erro) => erro.status === 400);
    await assert.rejects(() => tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '1' } }), (erro) => erro.status === 400, 'sem token e sem conexão falta o token');
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '1', access_token: 't' }, publicConfiguration: { pixel_id: '1', token_source: 'connection' } });
    const publico = (await tracking.destinationsFor({ ...escopo, environment: 'production' })).find((item) => item.provider === 'meta');
    assert.equal(publico.publicConfiguration.token_source, undefined);
    await assert.rejects(() => tracking.saveDestination({ ...escopo, environment: 'production', provider: 'tiktok', configuration: { pixel_code: 'x' }, tokenSource: 'connection' }), (erro) => erro.status === 400);
  });

  // Conferência de 02/10/2026 (bloqueante): com a origem na conexão, trocar só o pixel pela
  // rota manual mantinha token_source 'connection' com um pixel que a Meta nunca validou.
  await t.test('origem connection: trocar o pixel sem token novo é recusado; com token vira manual', async () => {
    const escopo = await empresa();
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '555' }, tokenSource: 'connection' });
    await assert.rejects(
      () => tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '999999' } }),
      (erro) => erro.status === 400 && /cartão .Conta da Meta./.test(erro.message) && /informe também o token/.test(erro.message),
    );
    assert.deepEqual((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta, { pixel_id: '555', token_source: 'connection' });
    // Reenviar o mesmo pixel (ou só o código de teste) não muda nada e é aceito.
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '555', test_event_code: 'T1' } });
    assert.equal((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta.token_source, 'connection');
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '999999', access_token: 'colado' } });
    const manual = (await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta;
    assert.equal(manual.token_source, undefined);
    assert.equal(manual.pixel_id, '999999');
  });

  await t.test('a rota PUT de destinos também recusa trocar o pixel da conexão sem token', async () => {
    const escopo = await empresa();
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '555' }, tokenSource: 'connection' });
    const context = { sessionId: 's', companyId: escopo.companyId, user: { id: escopo.userId }, role: 'owner' };
    const sessionService = { require: async () => context, state: async () => ({}), authorize: async () => {} };
    const api = createProjectApi({ sessionService, tracking, body: async (req) => req.bodyValue, runtimeFlags: {} });
    const path = `/api/projects/${escopo.projectId}/tracking/destinations/meta`;
    const chamar = (bodyValue) => api({ req: { bodyValue, url: path, headers: {} }, res: {}, path, method: 'PUT', json: () => {} });
    await assert.rejects(() => chamar({ environment: 'production', configuration: { pixel_id: '999999' } }), (erro) => erro.status === 400);
    // E a rota não deixa o corpo escolher a origem.
    await assert.rejects(() => chamar({ environment: 'production', configuration: { pixel_id: '999999', token_source: 'connection' } }), (erro) => erro.status === 400);
    assert.equal((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta.pixel_id, '555');
  });

  // Regra registrada (conferência F2): trocar a ESCOLHA (conta ou pixel) invalida os públicos
  // registrados — eles foram montados com a conta e o pixel antigos. Desconectar não é trocar
  // a escolha e nunca apaga nada (D10, coberto acima).
  await t.test('públicos: trocar só o pixel pela conexão (mesma conta) apaga os registros montados com o pixel antigo', async () => {
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    const gravarPublico = (pixel) => publicos.gravar({ ...escopo, chave: 'lead', status: 'created', metaId: '987', definicao: { nome: 'Alva · Virou lead', regra: regraDoPublico(publicoPorChave('lead'), pixel) } });
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id, pixelId: '555' });
    await gravarPublico('555');
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id, pixelId: '555' });
    assert.equal((await publicos.listar(escopo)).length, 1, 'mesma conta e mesmo pixel: ficam');
    await publicos.usarConexao({ ...escopo, adAccountId: '111', connectionId: conexao.id, pixelId: '666' });
    assert.equal((await publicos.listar(escopo)).length, 0, 'pixel novo: os públicos do pixel antigo saem');
  });

  // Conferência F2: as três gravações da escolha eram separadas; uma falha no meio podia
  // apagar o token colado sem gravar a escolha.
  await t.test('escolher é uma transação só: falha no meio não apaga o token manual', async () => {
    const escopo = await empresa();
    const conexao = await conectar(escopo);
    await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '1', access_token: 'colado-capi' } });
    await publicos.salvarCredenciais({ ...escopo, adAccountId: '1', token: 'colado-publicos' });
    const cliente = {
      contasDeAnuncios: async () => [{ id: '111', nome: 'Conta' }],
      pixels: async () => [{ id: '555', nome: 'Pixel' }],
      paginas: async () => [], termosAceitos: async () => true,
    };
    const selecoesQueFalham = { ler: (input) => selecoes.ler(input), salvar: async () => { throw new Error('falha injetada'); } };
    const servico = criarServicoDeSelecaoMeta({ conexoes, cliente, selecoes: selecoesQueFalham, tracking, publicos, transacao: (fn) => database.transaction(fn) });
    await assert.rejects(() => servico.escolher({ ...escopo, adAccountId: '111', pixelId: '555', substituirManual: true }), /falha injetada/);
    assert.deepEqual((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta, { pixel_id: '1', access_token: 'colado-capi' });
    assert.deepEqual(await publicos.credenciais(escopo), { adAccountId: '1', origem: 'manual', token: 'colado-publicos' });
    assert.equal(await selecoes.ler(escopo), null);
    // Sem falha, as três mudam juntas.
    const servicoBom = criarServicoDeSelecaoMeta({ conexoes, cliente, selecoes, tracking, publicos, transacao: (fn) => database.transaction(fn) });
    await servicoBom.escolher({ ...escopo, adAccountId: '111', pixelId: '555', substituirManual: true });
    assert.deepEqual((await tracking.conversionDestinations({ ...escopo, environment: 'production' })).meta, { pixel_id: '555', token_source: 'connection' });
    assert.equal((await publicos.credenciais(escopo)).origem, 'connection');
    assert.equal((await selecoes.ler(escopo)).conexaoId, conexao.id);
  });
});
