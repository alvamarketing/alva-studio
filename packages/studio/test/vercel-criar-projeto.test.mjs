import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Publisher } from '../server/publisher.mjs';

// "Sincronizar" é o passo que faltava: hoje o campo assume que alguém já criou o projeto
// na Vercel à mão. O Studio passa a criar — e, se o nome já existe na conta, adotar em
// vez de recusar, porque recusar deixaria a pessoa presa sem saber o que fazer.

const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => corpo,
});

const falso = (rotas) => {
  const chamadas = [];
  return {
    chamadas,
    fetcher: async (url, opcoes) => {
      chamadas.push({ url: String(url), metodo: opcoes?.method || 'GET', corpo: opcoes?.body ? JSON.parse(opcoes.body) : null });
      for (const [padrao, devolve] of rotas) if (String(url).includes(padrao) && (opcoes?.method || 'GET') === (padrao.startsWith('POST ') ? 'POST' : 'GET')) return devolve;
      const rota = rotas.find(([padrao]) => String(url).includes(padrao.replace(/^POST /, '')));
      return rota ? rota[1] : resposta(404, { error: { code: 'not_found' } });
    },
  };
};

test('projeto que ainda não existe é criado na conta', async () => {
  const { fetcher, chamadas } = falso([]);
  const publisher = new Publisher({ token: 'tok', fetcher: async (url, opcoes) => {
    chamadas.push({ url: String(url), metodo: opcoes?.method || 'GET' });
    if ((opcoes?.method || 'GET') === 'GET') return resposta(404, { error: { code: 'not_found' } });
    return resposta(200, { id: 'prj_1', name: 'taian' });
  } });
  const resultado = await publisher.ensureProject('taian');
  assert.equal(resultado.created, true);
  assert.equal(resultado.name, 'taian');
  assert.ok(chamadas.some((c) => c.metodo === 'POST'), 'precisa criar quando não existe');
});

test('projeto que já existe é adotado, não recusado', async () => {
  const chamadas = [];
  const publisher = new Publisher({ token: 'tok', fetcher: async (url, opcoes) => {
    chamadas.push({ metodo: opcoes?.method || 'GET' });
    return resposta(200, { id: 'prj_9', name: 'taian' });
  } });
  const resultado = await publisher.ensureProject('taian');
  assert.equal(resultado.created, false, 'adotar é o que evita deixar a pessoa presa');
  assert.equal(resultado.name, 'taian');
  assert.ok(!chamadas.some((c) => c.metodo === 'POST'), 'não recria o que já está lá');
});

test('erro que não é "não encontrado" continua sendo erro', async () => {
  const publisher = new Publisher({ token: 'tok', retryLimit: 0, fetcher: async () => resposta(403, { error: { code: 'forbidden' } }) });
  await assert.rejects(() => publisher.ensureProject('taian'), /Vercel/);
});

test('sem token não há o que sincronizar', async () => {
  const publisher = new Publisher({ token: '', fetcher: async () => resposta(200, {}) });
  await assert.rejects(() => publisher.ensureProject('taian'), /Conecte a Vercel/);
});

test('o nome vai para a URL do projeto, então precisa ser um nome de projeto', async () => {
  const publisher = new Publisher({ token: 'tok', fetcher: async () => resposta(200, {}) });
  for (const invalido of ['', '  ', 'com espaço', 'MAIÚSCULA', 'a'.repeat(101), 'ponto.no.meio'])
    await assert.rejects(() => publisher.ensureProject(invalido), /nome do projeto/i, `aceitou "${invalido}"`);
});
