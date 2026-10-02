import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';

function montar({ papel = 'owner' } = {}) {
  const chamadas = [];
  const capacidades = [];
  const publicosMeta = {
    async estado(input) { chamadas.push(['estado', input]); return { credenciais: { configuradas: false, adAccountId: null }, faltando: [], publicos: [] }; },
    async salvarCredenciais(input) { chamadas.push(['credenciais', input]); return { configuradas: true, adAccountId: '1' }; },
    async removerCredenciais(input) { chamadas.push(['remover', input]); return { configuradas: false }; },
    async sincronizar(input) { chamadas.push(['sincronizar', input]); return { resultados: [] }; },
    async esquecer(input) { chamadas.push(['esquecer', input]); return { chave: input.chave, estado: 'nao_criado' }; },
  };
  const context = { companyId: 'company-a', currentProjectId: 'project-a', user: { id: 'user-a' }, role: papel };
  const sessionService = {
    require: async () => context,
    authorize: async (_context, capacidade, projectId) => {
      capacidades.push(capacidade);
      if (projectId !== 'project-a') throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
      if (capacidade !== 'integration.manage' || papel !== 'owner') throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 });
    },
  };
  const api = createProjectApi({ sessionService, publicosMeta, body: async (req) => req.bodyValue });
  const chamar = async (path, method, bodyValue = {}) => {
    let resultado;
    await api({ req: { bodyValue, url: path, headers: {} }, res: {}, path, method, json: (data, status = 200) => { resultado = { data, status }; } });
    return resultado;
  };
  return { chamar, chamadas, capacidades };
}

const base = '/api/projects/project-a/meta-audiences';

test('todas as rotas de públicos exigem integration.manage e passam empresa e projeto da sessão', async () => {
  const { chamar, chamadas, capacidades } = montar();
  await chamar(base, 'GET');
  await chamar(`${base}/credentials`, 'PUT', { adAccountId: '123', token: 'tok' });
  await chamar(`${base}/credentials`, 'DELETE');
  await chamar(`${base}/sync`, 'POST', { chaves: ['lead'] });
  await chamar(`${base}/audiences/lead`, 'DELETE');
  assert.deepEqual(chamadas.map(([nome]) => nome), ['estado', 'credenciais', 'remover', 'sincronizar', 'esquecer']);
  assert.equal(capacidades.every((c) => c === 'integration.manage'), true);
  assert.equal(capacidades.length, 5);
  for (const [, entrada] of chamadas) assert.deepEqual([entrada.companyId, entrada.projectId], ['company-a', 'project-a']);
  assert.deepEqual(chamadas[1][1], { companyId: 'company-a', projectId: 'project-a', adAccountId: '123', token: 'tok' });
  assert.deepEqual(chamadas[3][1].chaves, ['lead']);
  assert.equal(chamadas[4][1].chave, 'lead');
});

test('quem não pode gerenciar integrações recebe 403 e nada é chamado', async () => {
  const { chamar, chamadas } = montar({ papel: 'analyst' });
  await assert.rejects(() => chamar(base, 'GET'), (erro) => erro.status === 403);
  await assert.rejects(() => chamar(`${base}/sync`, 'POST', { chaves: ['lead'] }), (erro) => erro.status === 403);
  assert.equal(chamadas.length, 0);
});

test('projeto de outra empresa é 404, rota desconhecida é 404', async () => {
  const { chamar } = montar();
  await assert.rejects(() => chamar('/api/projects/project-b/meta-audiences', 'GET'), (erro) => erro.status === 404);
  await assert.rejects(() => chamar(`${base}/nada`, 'GET'), (erro) => erro.status === 404);
});

test('sem o serviço configurado, a rota diz que está pendente em vez de quebrar', async () => {
  const api = createProjectApi({
    sessionService: { require: async () => ({ companyId: 'c', user: { id: 'u' } }), authorize: async () => {} }, body: async () => ({}),
  });
  await assert.rejects(
    () => api({ req: { url: base, headers: {} }, res: {}, path: base, method: 'GET', json: () => {} }),
    (erro) => erro.status === 409,
  );
});
