import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ProjectIntegrationRepository, SecretVault } from '../server/repositories/publication-repository.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

// O token da Vercel é da empresa: uma conta, uma credencial. Cada projeto só diz qual é
// o projeto dele lá. Enquanto o formulário do projeto pedia o token de novo, configurar
// um projeto trocava a credencial de todos os outros.

async function palco(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const company = (await database.query(
    `INSERT INTO companies (name, slug) VALUES ('Alva', 'alva-vercel') RETURNING id`,
  )).rows[0].id;
  const dono = (await database.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ('dono@alva.test', 'x', 'Dono') RETURNING id`,
  )).rows[0].id;
  const projeto = async (nome, slug) => (await database.query(
    `INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [company, nome, slug, dono],
  )).rows[0].id;
  return { database, company, projeto, repo: new ProjectIntegrationRepository(database, { vault: new SecretVault({ masterKey: 'chave-de-teste-para-o-cofre-32b' }) }) };
}

test('o token vale para a empresa inteira, e cada projeto guarda só o projeto dele', async (t) => {
  const { company, projeto, repo } = await palco(t);
  const a = await projeto('Campanha A', 'campanha-a');
  const b = await projeto('Campanha B', 'campanha-b');

  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian', token: 'token-da-empresa' });
  await repo.save({ companyId: company, projectId: b, vercelProjectId: 'outro-site' });

  const credA = await repo.credentials({ companyId: company, projectId: a });
  const credB = await repo.credentials({ companyId: company, projectId: b });
  assert.equal(credA.token, 'token-da-empresa');
  assert.equal(credB.token, 'token-da-empresa', 'o segundo projeto usa a mesma credencial da empresa');
  assert.equal(credA.vercelProjectId, 'taian');
  assert.equal(credB.vercelProjectId, 'outro-site', 'cada projeto aponta para o projeto dele na Vercel');
});

test('configurar um projeto não apaga o token que a empresa já tinha', async (t) => {
  const { company, projeto, repo } = await palco(t);
  const a = await projeto('Campanha A', 'campanha-a');
  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian', token: 'token-original' });
  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian-renomeado' });
  const cred = await repo.credentials({ companyId: company, projectId: a });
  assert.equal(cred.token, 'token-original', 'salvar sem token precisa manter o que estava lá');
  assert.equal(cred.vercelProjectId, 'taian-renomeado');
});

test('token vazio continua sendo recusado quando é o primeiro', async (t) => {
  const { company, projeto, repo } = await palco(t);
  const a = await projeto('Campanha A', 'campanha-a');
  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian' });
  const cred = await repo.credentials({ companyId: company, projectId: a });
  assert.equal(cred, null, 'sem credencial nenhuma não há como publicar');
});

test('a tela do projeto não pede mais o token', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const form = html.slice(html.indexOf('id="publication-connection-form"'));
  const corpo = form.slice(0, form.indexOf('</form>'));
  assert.doesNotMatch(corpo, /name="token"/, 'o token é da empresa e fica nas configurações dela');
  assert.match(corpo, /name="vercelProjectId"/, 'o projeto continua dizendo qual é o projeto dele na Vercel');
});

test('a empresa salva a credencial sem precisar saber de projeto nenhum', async (t) => {
  const { company, projeto, repo } = await palco(t);
  const a = await projeto('Campanha A', 'campanha-a');
  // é o que a tela de Preferências envia: token e equipe, mais nada
  await repo.save({ companyId: company, projectId: a, token: 'token-da-empresa', teamId: 'team_alva' });
  const cred = await repo.credentials({ companyId: company, projectId: a });
  assert.equal(cred, null, 'sem projeto na Vercel ainda não dá para publicar, mas o token ficou guardado');
  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian' });
  const depois = await repo.credentials({ companyId: company, projectId: a });
  assert.equal(depois.token, 'token-da-empresa', 'a credencial da empresa continua valendo');
  assert.equal(depois.vercelProjectId, 'taian');
  assert.equal(depois.teamId, 'team_alva', 'a equipe também é da empresa e não se perde');
});

test('salvar a credencial da empresa não apaga o projeto que já estava configurado', async (t) => {
  const { company, projeto, repo } = await palco(t);
  const a = await projeto('Campanha A', 'campanha-a');
  await repo.save({ companyId: company, projectId: a, vercelProjectId: 'taian', token: 'token-1' });
  await repo.save({ companyId: company, projectId: a, token: 'token-2' });
  const cred = await repo.credentials({ companyId: company, projectId: a });
  assert.equal(cred.token, 'token-2', 'trocar o token da empresa vale para todos');
  assert.equal(cred.vercelProjectId, 'taian', 'e não desfaz a configuração do projeto');
});
