import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { MetaConnectionsRepository } from '../server/repositories/meta-connections-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const MIGRACOES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db', 'migrations');
const CHAVE = 'c'.repeat(64);
const TOKEN = 'EAAG-token-da-conexao-marcador';
const HASH = (letra) => letra.repeat(64);

// Um container para o arquivo inteiro: cada caso usa a sua empresa.
let database;
let repositorio;
let contador = 0;

async function preparar(t) {
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  // A 034 entra sobre a base de antes dela, com uma credencial manual já gravada — o caminho
  // de quem atualiza, não o de um banco vazio.
  const anteriores = await mkdtemp(path.join(tmpdir(), 'alva-migracoes-034-'));
  t.after(() => rm(anteriores, { recursive: true, force: true }));
  for (const arquivo of (await readdir(MIGRACOES)).filter((nome) => nome < '034')) await copyFile(path.join(MIGRACOES, arquivo), path.join(anteriores, arquivo));
  database = createDatabase({ connectionString });
  await migrate(database, { migrationsPath: anteriores });
  const antigo = await empresa();
  await database.query("INSERT INTO meta_audience_credentials (company_id, project_id, ad_account_id, encrypted_token) VALUES ($1, $2, '123', 'cifrado-antigo')", [antigo.companyId, antigo.projectId]);
  await migrate(database);
  repositorio = new MetaConnectionsRepository(database, { vault: new SecretVault({ masterKey: CHAVE }) });
}

async function empresa() {
  contador += 1;
  const user = (await database.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [`p${contador}@alva.test`, 'hash', `Pessoa ${contador}`])).rows[0];
  const company = (await database.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${contador}`, `empresa-${contador}`])).rows[0];
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto', $2, $3) RETURNING id", [company.id, `projeto-${contador}`, user.id])).rows[0];
  return { companyId: company.id, projectId: project.id, userId: user.id };
}

const conexao = (escopo, extra = {}) => ({
  companyId: escopo.companyId, metaUserId: '10203040', nome: 'Pessoa na Meta', tipoDeToken: 'user', token: TOKEN,
  escopos: ['ads_management', 'ads_read'], clientBusinessId: null, expiraEm: new Date(Date.now() + 60 * 86_400_000), conectadoPor: escopo.userId, ...extra,
});

test('repositório da conexão com a Meta (Postgres, migração 034)', async (t) => {
  await preparar(t);

  await t.test('a 034 aplica limpa sobre a base anterior e a credencial antiga vira manual', async () => {
    const { rows } = await database.query("SELECT source, connection_id, encrypted_token FROM meta_audience_credentials WHERE ad_account_id = '123'");
    assert.deepEqual(rows, [{ source: 'manual', connection_id: null, encrypted_token: 'cifrado-antigo' }]);
    const versoes = (await database.query("SELECT version FROM schema_migrations WHERE version = '034'")).rows;
    assert.equal(versoes.length, 1);
  });

  await t.test('CHECK da origem: connection sem token, manual exige token, nunca as duas', async () => {
    const escopo = await empresa();
    const inserir = (source, token) => database.query(
      'INSERT INTO meta_audience_credentials (company_id, project_id, ad_account_id, encrypted_token, source) VALUES ($1, $2, $3, $4, $5)',
      [escopo.companyId, escopo.projectId, '999', token, source],
    );
    await assert.rejects(() => inserir('manual', null), /meta_audience_credentials_uma_origem/);
    await assert.rejects(() => inserir('connection', 'cifrado'), /meta_audience_credentials_uma_origem/);
    await assert.rejects(() => inserir('outra', null), /check/i);
    await inserir('connection', null);
  });

  await t.test('o token é guardado cifrado, e o que é público não o leva', async () => {
    const escopo = await empresa();
    const publica = await repositorio.salvar(conexao(escopo));
    assert.equal(JSON.stringify(publica).includes(TOKEN), false);
    assert.equal(publica.nome, 'Pessoa na Meta');
    assert.equal(publica.status, 'connected');
    assert.deepEqual(publica.conectadoPor, { id: escopo.userId, nome: `Pessoa ${contador}` });
    const { rows } = await database.query('SELECT encrypted_token FROM meta_connections WHERE company_id = $1', [escopo.companyId]);
    assert.equal(rows[0].encrypted_token.includes(TOKEN), false);
    assert.equal((await repositorio.comToken(escopo.companyId)).token, TOKEN);
    assert.equal(JSON.stringify(await repositorio.publica(escopo.companyId)).includes(TOKEN), false);
  });

  await t.test('token cifrado para uma empresa não decifra no lugar de outra', async () => {
    const a = await empresa();
    const b = await empresa();
    await repositorio.salvar(conexao(a));
    await repositorio.salvar(conexao(b, { token: 'outro-token' }));
    await database.query('UPDATE meta_connections SET encrypted_token = (SELECT encrypted_token FROM meta_connections WHERE company_id = $1) WHERE company_id = $2', [a.companyId, b.companyId]);
    await assert.rejects(() => repositorio.comToken(b.companyId), (erro) => !String(erro.message).includes(TOKEN));
  });

  await t.test('uma conexão por empresa: conectar de novo substitui e mantém o id', async () => {
    const escopo = await empresa();
    const primeira = await repositorio.salvar(conexao(escopo));
    await repositorio.marcarParaReconectar({ companyId: escopo.companyId, motivo: 'expirado' });
    assert.equal((await repositorio.publica(escopo.companyId)).status, 'needs_reconnect');
    const segunda = await repositorio.salvar(conexao(escopo, { metaUserId: '555', nome: 'Outra pessoa', token: 'novo-token' }));
    assert.equal(segunda.id, primeira.id);
    assert.equal(segunda.status, 'connected');
    assert.equal(segunda.motivo, null);
    assert.equal((await repositorio.comToken(escopo.companyId)).token, 'novo-token');
    assert.equal((await database.query('SELECT count(*)::int AS n FROM meta_connections WHERE company_id = $1', [escopo.companyId])).rows[0].n, 1);
  });

  await t.test('o state é consumido uma vez só, mesmo com duas conclusões ao mesmo tempo', async () => {
    const escopo = await empresa();
    const dados = { nonceHash: HASH('a'), companyId: escopo.companyId, projectId: escopo.projectId, userId: escopo.userId, sessionHash: HASH('b'), redirectUri: 'https://studio.alva.test/conexoes/meta/retorno', expiraEm: new Date(Date.now() + 600_000) };
    await repositorio.registrarState(dados);
    const consumo = { nonceHash: HASH('a'), companyId: escopo.companyId, userId: escopo.userId, sessionHash: HASH('b') };
    const resultados = await Promise.all([repositorio.consumirState(consumo), repositorio.consumirState(consumo), repositorio.consumirState(consumo)]);
    assert.equal(resultados.filter(Boolean).length, 1);
    assert.deepEqual(resultados.find(Boolean), { projectId: escopo.projectId, redirectUri: dados.redirectUri });
  });

  await t.test('state de outra sessão, outro usuário, outra empresa ou vencido não é consumido', async () => {
    const escopo = await empresa();
    const outra = await empresa();
    await repositorio.registrarState({ nonceHash: HASH('c'), companyId: escopo.companyId, projectId: escopo.projectId, userId: escopo.userId, sessionHash: HASH('d'), redirectUri: 'https://x.test/r', expiraEm: new Date(Date.now() + 600_000) });
    const base = { nonceHash: HASH('c'), companyId: escopo.companyId, userId: escopo.userId, sessionHash: HASH('d') };
    assert.equal(await repositorio.consumirState({ ...base, sessionHash: HASH('e') }), null);
    assert.equal(await repositorio.consumirState({ ...base, userId: outra.userId }), null);
    assert.equal(await repositorio.consumirState({ ...base, companyId: outra.companyId }), null);
    await repositorio.registrarState({ nonceHash: HASH('f'), companyId: escopo.companyId, projectId: escopo.projectId, userId: escopo.userId, sessionHash: HASH('d'), redirectUri: 'https://x.test/r', expiraEm: new Date(Date.now() - 1000) });
    assert.equal(await repositorio.consumirState({ ...base, nonceHash: HASH('f') }), null);
    assert.ok(await repositorio.consumirState(base), 'o original continua valendo para quem é dono dele');
  });

  await t.test('remover devolve quem era e o token, e apaga só a conexão', async () => {
    const escopo = await empresa();
    await repositorio.salvar(conexao(escopo));
    assert.equal(await repositorio.outrasEmpresasDoUsuario({ metaUserId: '10203040', companyId: escopo.companyId }) >= 0, true);
    const removida = await repositorio.remover(escopo.companyId);
    assert.deepEqual(removida, { metaUserId: '10203040', token: TOKEN });
    assert.equal(await repositorio.publica(escopo.companyId), null);
    assert.equal(await repositorio.remover(escopo.companyId), null);
  });
});
