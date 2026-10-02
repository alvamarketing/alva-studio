import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';

// Rotas da F2: contas de anúncios (empresa), pixels e escolha (projeto). Todas sob
// integration.manage; empresa, projeto e pessoa vêm do contexto.
function montar({ papel = 'owner', servico = true, destinos = [] } = {}) {
  const chamadas = [];
  const capacidades = [];
  const metaSelecao = servico ? {
    async contasDeAnuncios(input) { chamadas.push(['contas', input]); return { contas: [{ id: '111', nome: 'Conta' }] }; },
    async pixels(input) { chamadas.push(['pixels', input]); return { pixels: [] }; },
    async estado(input) { chamadas.push(['estado', input]); return { conectado: true, escolha: { adAccountId: '111' } }; },
    async escolher(input) { chamadas.push(['escolher', input]); return { conectado: true }; },
    async precisaReconectar(input) { chamadas.push(['precisaReconectar', input]); return true; },
  } : null;
  const metaConexao = { async estado() { return { conectado: true }; } };
  const tracking = { async destinationsFor() { return structuredClone(destinos); } };
  const context = { sessionId: 's', companyId: 'company-a', currentProjectId: 'project-a', user: { id: 'user-a' }, role: papel };
  const sessionService = {
    require: async () => context,
    state: async () => ({ authenticated: true }),
    authorize: async (_context, capacidade, projectId) => {
      capacidades.push([capacidade, projectId ?? null]);
      if (projectId && projectId !== 'project-a') throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
      if (capacidade && !['owner', 'admin'].includes(papel)) throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 });
    },
  };
  const api = createProjectApi({ sessionService, metaConexao, metaSelecao, tracking, body: async (req) => req.bodyValue, runtimeFlags: {} });
  const chamar = async (path, method, bodyValue = {}) => {
    let resultado;
    await api({ req: { bodyValue, url: path, headers: {} }, res: {}, path: path.split('?')[0], method, json: (data, status = 200) => { resultado = { data, status }; } });
    return resultado;
  };
  return { chamar, chamadas, capacidades };
}

test('contas de anúncios: GET na empresa da sessão, com integration.manage', async () => {
  const { chamar, chamadas, capacidades } = montar();
  const { data } = await chamar('/api/companies/company-a/meta-connection/ad-accounts', 'GET');
  assert.deepEqual(data.contas, [{ id: '111', nome: 'Conta' }]);
  assert.deepEqual(chamadas, [['contas', { companyId: 'company-a' }]]);
  assert.ok(capacidades.every(([capacidade]) => capacidade === 'integration.manage'));
  await assert.rejects(() => chamar('/api/companies/company-b/meta-connection/ad-accounts', 'GET'), (erro) => erro.status === 404);
});

test('pixels, estado e escolha do projeto: contexto da sessão, nunca do corpo', async () => {
  const { chamar, chamadas } = montar();
  await chamar('/api/projects/project-a/meta-connection/pixels?adAccountId=111', 'GET');
  await chamar('/api/projects/project-a/meta-connection', 'GET');
  const lida = await chamar('/api/projects/project-a/meta-connection/selection', 'GET');
  assert.deepEqual(lida.data, { escolha: { adAccountId: '111' } });
  await chamar('/api/projects/project-a/meta-connection/selection', 'PUT', { adAccountId: '111', pixelId: '555', substituirManual: true, automatica: true, companyId: 'company-b', userId: 'user-b' });
  assert.deepEqual(chamadas[0], ['pixels', { companyId: 'company-a', projectId: 'project-a', adAccountId: '111' }]);
  assert.deepEqual(chamadas[1], ['estado', { companyId: 'company-a', projectId: 'project-a' }]);
  assert.deepEqual(chamadas.at(-1), ['escolher', { companyId: 'company-a', projectId: 'project-a', userId: 'user-a', adAccountId: '111', pixelId: '555', substituirManual: true, automatica: true }]);
});

test('substituirManual só vale como true explícito', async () => {
  const { chamar, chamadas } = montar();
  await chamar('/api/projects/project-a/meta-connection/selection', 'PUT', { adAccountId: '111', pixelId: '555', substituirManual: 'sim' });
  assert.equal(chamadas[0][1].substituirManual, false);
});

test('sem permissão: 403 e nada é chamado; projeto de fora: 404', async () => {
  const { chamar, chamadas } = montar({ papel: 'editor' });
  await assert.rejects(() => chamar('/api/projects/project-a/meta-connection', 'GET'), (erro) => erro.status === 403);
  await assert.rejects(() => chamar('/api/projects/project-a/meta-connection/selection', 'PUT', { adAccountId: '1', pixelId: '1' }), (erro) => erro.status === 403);
  await assert.rejects(() => chamar('/api/companies/company-a/meta-connection/ad-accounts', 'GET'), (erro) => erro.status === 403);
  assert.equal(chamadas.length, 0);
  const dono = montar();
  await assert.rejects(() => dono.chamar('/api/projects/project-b/meta-connection', 'GET'), (erro) => erro.status === 404);
});

test('sem o app da Meta: 409', async () => {
  const { chamar } = montar({ servico: false });
  await assert.rejects(() => chamar('/api/projects/project-a/meta-connection', 'GET'), (erro) => erro.status === 409);
  await assert.rejects(() => chamar('/api/projects/project-a/meta-connection/selection', 'PUT', {}), (erro) => erro.status === 409);
});

test('destinos: o da Meta pela conexão diz se a conexão precisa reconectar', async () => {
  const destinos = [
    { provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' } },
    { provider: 'tiktok', configured: false, publicConfiguration: {} },
  ];
  const { chamar } = montar({ destinos });
  const { data } = await chamar('/api/projects/project-a/tracking/destinations', 'GET');
  assert.deepEqual(data[0].conexao, { precisaReconectar: true });
  assert.equal(data[1].conexao, undefined);
});
