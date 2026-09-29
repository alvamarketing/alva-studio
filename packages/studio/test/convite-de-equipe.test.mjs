// Convidar alguém para a equipe. O repositório sabia convidar desde o começo, mas nenhuma
// rota chamava, e quem era convidado não tinha como criar a conta: o primeiro acesso do
// Studio cria só o dono e depois se recusa. Sem isso, "Equipe e acessos" era uma lista de
// uma pessoa só.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function subir(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const server = createApp({ database, sessionOptions: { sessionTTL: 60_000 } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); database.close(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = async (caminho, { method = 'GET', body, cookie = '' } = {}) => {
    const resposta = await fetch(base + caminho, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const texto = await resposta.text();
    let dados = null;
    try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: resposta.status, dados, cookie: resposta.headers.getSetCookie?.().join('; ') ?? '' };
  };
  const dono = await chamar('/api/setup', { method: 'POST', body: { name: 'Dona', email: 'dona@example.test', password: 'senha-bem-comprida-1' } });
  assert.equal(dono.status < 400, true, JSON.stringify(dono.dados));
  return { chamar, cookieDoDono: dono.cookie, database };
}

test('o dono convida alguém e recebe o link para enviar', async (t) => {
  const { chamar, cookieDoDono } = await subir(t);
  const empresas = await chamar('/api/companies', { cookie: cookieDoDono });
  const companyId = empresas.dados[0].id;
  const convite = await chamar(`/api/companies/${companyId}/invitations`, {
    method: 'POST', cookie: cookieDoDono, body: { email: 'novo@example.test', role: 'editor' },
  });
  assert.equal(convite.status, 201, JSON.stringify(convite.dados));
  assert.equal(convite.dados.email, 'novo@example.test');
  assert.equal(convite.dados.role, 'editor');
  assert.match(convite.dados.link, /^https?:\/\/[^/]+\/convite\?codigo=[A-Za-z0-9_-]{20,}$/);
  // O convite aparece na lista, para reenviar o link ou saber quem está pendente.
  const pendentes = await chamar(`/api/companies/${companyId}/invitations`, { cookie: cookieDoDono });
  assert.equal(pendentes.dados.some((i) => i.email === 'novo@example.test'), true);
});

test('quem é convidado cria a conta pelo link e já entra no Studio', async (t) => {
  const { chamar, cookieDoDono } = await subir(t);
  const companyId = (await chamar('/api/companies', { cookie: cookieDoDono })).dados[0].id;
  const convite = await chamar(`/api/companies/${companyId}/invitations`, {
    method: 'POST', cookie: cookieDoDono, body: { email: 'novo@example.test', role: 'editor' },
  });
  const codigo = new URL(convite.dados.link).searchParams.get('codigo');
  // Antes de aceitar, o link diz para quem ele é — sem exigir sessão.
  const visao = await chamar(`/api/invitations/${codigo}`);
  assert.equal(visao.status, 200);
  assert.equal(visao.dados.email, 'novo@example.test');
  assert.equal(typeof visao.dados.companyName, 'string');
  const aceite = await chamar(`/api/invitations/${codigo}/accept`, {
    method: 'POST', body: { name: 'Pessoa Nova', password: 'outra-senha-comprida-1' },
  });
  assert.equal(aceite.status, 200, JSON.stringify(aceite.dados));
  assert.equal(aceite.dados.authenticated, true);
  assert.match(aceite.cookie, /alva/i);
  // E entra de verdade: a sessão criada pelo aceite já responde pelas rotas do Studio.
  const sessao = await chamar('/api/session', { cookie: aceite.cookie });
  assert.equal(sessao.dados.authenticated, true);
  assert.equal(sessao.dados.user.email, 'novo@example.test');
  // O convite não serve duas vezes.
  const repetido = await chamar(`/api/invitations/${codigo}/accept`, { method: 'POST', body: { name: 'Outra', password: 'mais-uma-senha-longa-1' } });
  assert.equal(repetido.status, 404);
});

test('convite não vaza empresa para código inválido nem aceita senha curta', async (t) => {
  const { chamar } = await subir(t);
  assert.equal((await chamar('/api/invitations/codigo-que-nao-existe')).status, 404);
  const { chamar: chamar2, cookieDoDono } = await subir(t);
  const companyId = (await chamar2('/api/companies', { cookie: cookieDoDono })).dados[0].id;
  const convite = await chamar2(`/api/companies/${companyId}/invitations`, {
    method: 'POST', cookie: cookieDoDono, body: { email: 'curta@example.test', role: 'analyst' },
  });
  const codigo = new URL(convite.dados.link).searchParams.get('codigo');
  const curta = await chamar2(`/api/invitations/${codigo}/accept`, { method: 'POST', body: { name: 'Pessoa', password: '123' } });
  assert.equal(curta.status >= 400, true);
});

test('quem não pode gerir membros não convida', async (t) => {
  const { chamar, cookieDoDono } = await subir(t);
  const companyId = (await chamar('/api/companies', { cookie: cookieDoDono })).dados[0].id;
  const convite = await chamar(`/api/companies/${companyId}/invitations`, {
    method: 'POST', cookie: cookieDoDono, body: { email: 'analista@example.test', role: 'analyst' },
  });
  const codigo = new URL(convite.dados.link).searchParams.get('codigo');
  const aceite = await chamar(`/api/invitations/${codigo}/accept`, { method: 'POST', body: { name: 'Analista', password: 'senha-de-analista-1' } });
  const tentativa = await chamar(`/api/companies/${companyId}/invitations`, {
    method: 'POST', cookie: aceite.cookie, body: { email: 'outro@example.test', role: 'editor' },
  });
  assert.equal(tentativa.status, 403);
});
