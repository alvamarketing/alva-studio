import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';

function montar({ papel = 'owner', servico = true } = {}) {
  const chamadas = [];
  const capacidades = [];
  const metaConexao = servico ? {
    async estado(input) { chamadas.push(['estado', input]); return { conectado: false, tipoDeToken: 'user' }; },
    async iniciar(input) { chamadas.push(['iniciar', input]); return { url: 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1' }; },
    async concluir(input) { chamadas.push(['concluir', input]); return { estado: 'conectado', projectId: 'project-a' }; },
    async desconectar(input) { chamadas.push(['desconectar', input]); return { conectado: false }; },
  } : null;
  const context = { sessionId: 'sessao-a', companyId: 'company-a', currentProjectId: 'project-a', user: { id: 'user-a' }, role: papel };
  const sessionService = {
    require: async () => context,
    state: async () => ({ authenticated: true }),
    authorize: async (_context, capacidade, projectId) => {
      capacidades.push([capacidade, projectId ?? null]);
      if (projectId && projectId !== 'project-a') throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
      if (capacidade && !['owner', 'admin'].includes(papel)) throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 });
    },
  };
  const api = createProjectApi({ sessionService, metaConexao, body: async (req) => req.bodyValue, publicOrigin: 'https://studio.alva.test', runtimeFlags: {} });
  const chamar = async (path, method, bodyValue = {}) => {
    let resultado;
    await api({ req: { bodyValue, url: path, headers: { host: 'studio.alva.test' } }, res: {}, path, method, json: (data, status = 200) => { resultado = { data, status }; } });
    return resultado;
  };
  return { chamar, chamadas, capacidades };
}

const base = '/api/companies/company-a/meta-connection';

test('todas as rotas da conexão exigem integration.manage', async () => {
  const { chamar, chamadas, capacidades } = montar();
  await chamar(base, 'GET');
  await chamar(`${base}/start`, 'POST', { projectId: 'project-a' });
  await chamar(`${base}/finish`, 'POST', { code: 'c', state: 's' });
  await chamar(base, 'DELETE');
  assert.deepEqual(chamadas.map(([nome]) => nome), ['estado', 'iniciar', 'concluir', 'desconectar']);
  assert.ok(capacidades.length >= 4);
  assert.equal(capacidades.every(([capacidade]) => capacidade === 'integration.manage'), true);
  // O start confere também o projeto onde o clique aconteceu.
  assert.ok(capacidades.some(([, projeto]) => projeto === 'project-a'));
});

test('quem não pode gerenciar integrações recebe 403 e nada é chamado', async () => {
  for (const papel of ['editor', 'analyst']) {
    const { chamar, chamadas } = montar({ papel });
    await assert.rejects(() => chamar(base, 'GET'), (erro) => erro.status === 403);
    await assert.rejects(() => chamar(`${base}/start`, 'POST', { projectId: 'project-a' }), (erro) => erro.status === 403);
    await assert.rejects(() => chamar(`${base}/finish`, 'POST', { code: 'c', state: 's' }), (erro) => erro.status === 403);
    await assert.rejects(() => chamar(base, 'DELETE'), (erro) => erro.status === 403);
    assert.equal(chamadas.length, 0);
  }
});

test('empresa da URL diferente da sessão é 404, sem chamar o serviço', async () => {
  const { chamar, chamadas } = montar();
  for (const [caminho, metodo] of [['', 'GET'], ['/start', 'POST'], ['/finish', 'POST'], ['', 'DELETE']]) {
    await assert.rejects(() => chamar(`/api/companies/company-b/meta-connection${caminho}`, metodo, { projectId: 'project-a', code: 'c', state: 's' }), (erro) => erro.status === 404);
  }
  assert.equal(chamadas.length, 0);
});

test('finish usa empresa, pessoa e sessão do contexto, nunca do corpo', async () => {
  const { chamar, chamadas } = montar();
  await chamar(`${base}/finish`, 'POST', { code: 'c', state: 's', companyId: 'company-b', userId: 'user-b', sessionId: 'sessao-b' });
  assert.deepEqual(chamadas[0][1], { companyId: 'company-a', userId: 'user-a', sessionId: 'sessao-a', code: 'c', error: undefined, state: 's' });
});

test('start leva projeto, contexto e a origem pública', async () => {
  const { chamar, chamadas } = montar();
  const { data } = await chamar(`${base}/start`, 'POST', { projectId: 'project-a', userId: 'user-b' });
  assert.match(data.url, /^https:\/\/www\.facebook\.com\//);
  assert.deepEqual(chamadas[0][1], { companyId: 'company-a', projectId: 'project-a', userId: 'user-a', sessionId: 'sessao-a', origem: 'https://studio.alva.test' });
  await assert.rejects(() => chamar(`${base}/start`, 'POST', { projectId: 'project-b' }), (erro) => erro.status === 404);
  await assert.rejects(() => chamar(`${base}/start`, 'POST', {}), (erro) => erro.status === 400);
});

test('sem META_APP_ID (serviço desligado) as rotas respondem 409', async () => {
  const { chamar } = montar({ servico: false });
  await assert.rejects(() => chamar(base, 'GET'), (erro) => erro.status === 409);
  await assert.rejects(() => chamar(`${base}/start`, 'POST', { projectId: 'project-a' }), (erro) => erro.status === 409);
  await assert.rejects(() => chamar(`${base}/finish`, 'POST', { code: 'c', state: 's' }), (erro) => erro.status === 409);
});

test('rota desconhecida da conexão é 404', async () => {
  const { chamar } = montar();
  await assert.rejects(() => chamar(`${base}/outra`, 'GET'), (erro) => erro.status === 404);
  await assert.rejects(() => chamar(`${base}/start`, 'GET'), (erro) => erro.status === 404);
});

test('a sessão diz se a conexão com a Meta está ligada', async () => {
  const ligada = await montar().chamar('/api/session', 'GET');
  assert.equal(ligada.data.runtime.metaConexao, true);
  const desligada = await montar({ servico: false }).chamar('/api/session', 'GET');
  assert.equal(desligada.data.runtime.metaConexao, false);
});
