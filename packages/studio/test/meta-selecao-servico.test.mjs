import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServicoDeSelecaoMeta, CODIGO_MANUAL_EXISTENTE } from '../server/meta-selecao-servico.mjs';

// A escolha de conta e pixel pela conexão: só vale o que a Meta devolveu para esta conexão,
// e escolher configura sozinho o destino (token da conexão) e os públicos.
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);
const DIA = 86_400_000;
const TOKEN = 'EAAG-token-da-conexao-marcador';
const escopo = { companyId: 'c1', projectId: 'p1' };

function montar({ conexao = { id: 'conn-1', nome: 'Taian', status: 'connected', token: TOKEN, expiraEm: new Date(AGORA + 40 * DIA) }, destino = null, credencial = null, contas, pixels, termos = true, falhaMeta = null } = {}) {
  const registro = { salvos: [], destinos: [], publicos: [], marcadas: [] };
  const conexoes = {
    async comToken() { return conexao && { ...conexao }; },
    async publica() { if (!conexao) return null; const { token: _t, ...resto } = conexao; return resto; },
    async marcarParaReconectar(input) { registro.marcadas.push(input); if (conexao) conexao.status = 'needs_reconnect'; },
  };
  const falhar = () => { if (falhaMeta) throw falhaMeta; };
  const cliente = {
    async contasDeAnuncios(token) { assert.equal(token, TOKEN); falhar(); return contas ?? [{ id: '111', nome: 'Conta Alva', negocio: { id: '9', nome: 'Portfólio' } }, { id: '222', nome: 'Conta 2' }]; },
    async pixels(token, conta) { falhar(); return pixels?.[conta] ?? (conta === '111' ? [{ id: '555', nome: 'Pixel Alva' }] : []); },
    async paginas() { falhar(); return [{ id: '77', nome: 'Página Alva' }]; },
    async termosAceitos() { falhar(); return termos; },
  };
  let escolha = null;
  const selecoes = { async ler() { return escolha; }, async salvar(input) { registro.salvos.push(input); escolha = { adAccountId: input.adAccountId, adAccountNome: input.adAccountNome, pixelId: input.pixelId, pixelNome: input.pixelNome, automatica: input.automatica, conexaoId: input.connectionId }; return escolha; } };
  let destinoAtual = destino;
  const tracking = {
    async destinationsFor() { return [{ provider: 'meta', configured: Boolean(destinoAtual), publicConfiguration: destinoAtual ?? {} }]; },
    async saveDestination(input) { registro.destinos.push(input); destinoAtual = { pixel_id: input.configuration.pixel_id, token_source: 'connection' }; },
  };
  let credencialAtual = credencial;
  const publicos = {
    async credenciaisPublicas() { return credencialAtual; },
    async usarConexao(input) { registro.publicos.push(input); credencialAtual = { adAccountId: input.adAccountId, origem: 'connection' }; },
  };
  const servico = criarServicoDeSelecaoMeta({ conexoes, cliente, selecoes, tracking, publicos, agora: () => AGORA });
  return { servico, registro };
}

test('contas de anúncios vêm da conexão da empresa', async () => {
  const { servico } = montar();
  const { contas } = await servico.contasDeAnuncios(escopo);
  assert.deepEqual(contas.map((item) => item.id), ['111', '222']);
});

test('pixels só de conta que a conexão alcança', async () => {
  const { servico } = montar();
  assert.deepEqual((await servico.pixels({ ...escopo, adAccountId: 'act_111' })).pixels, [{ id: '555', nome: 'Pixel Alva' }]);
  await assert.rejects(() => servico.pixels({ ...escopo, adAccountId: '999' }), (erro) => erro.status === 404);
  await assert.rejects(() => servico.pixels({ ...escopo, adAccountId: 'abc' }), (erro) => erro.status === 400);
});

test('escolher: grava, configura o destino pela conexão (sem token) e os públicos', async () => {
  const { servico, registro } = montar();
  const estado = await servico.escolher({ ...escopo, userId: 'u1', adAccountId: '111', pixelId: '555', automatica: true });
  assert.deepEqual(registro.destinos, [{ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: '555' }, tokenSource: 'connection' }]);
  assert.deepEqual(registro.publicos, [{ ...escopo, adAccountId: '111', connectionId: 'conn-1' }]);
  assert.equal(registro.salvos[0].adAccountNome, 'Conta Alva');
  assert.equal(registro.salvos[0].pixelNome, 'Pixel Alva');
  assert.equal(registro.salvos[0].automatica, true);
  assert.equal(JSON.stringify(registro).includes(TOKEN), false, 'o token não é copiado para lugar nenhum');
  assert.equal(estado.escolha.pixelId, '555');
  assert.deepEqual(estado.destino, { configurado: true, origem: 'connection', pixelId: '555' });
  assert.equal(JSON.stringify(estado).includes(TOKEN), false);
});

test('escolher recusa conta ou pixel que a Meta não devolveu para esta conexão', async () => {
  const { servico, registro } = montar();
  await assert.rejects(() => servico.escolher({ ...escopo, adAccountId: '999', pixelId: '555' }), (erro) => erro.status === 404);
  await assert.rejects(() => servico.escolher({ ...escopo, adAccountId: '222', pixelId: '555' }), (erro) => erro.status === 404);
  await assert.rejects(() => servico.escolher({ ...escopo, adAccountId: '111', pixelId: '' }), (erro) => erro.status === 400);
  assert.equal(registro.destinos.length + registro.publicos.length + registro.salvos.length, 0);
});

test('D2: destino ou públicos manuais só são substituídos com confirmação', async () => {
  for (const extra of [{ destino: { pixel_id: '1' } }, { credencial: { adAccountId: '1', origem: 'manual' } }]) {
    const { servico, registro } = montar(extra);
    await assert.rejects(() => servico.escolher({ ...escopo, adAccountId: '111', pixelId: '555' }), (erro) => erro.status === 409 && erro.code === CODIGO_MANUAL_EXISTENTE);
    assert.equal(registro.destinos.length, 0);
    await servico.escolher({ ...escopo, adAccountId: '111', pixelId: '555', substituirManual: true });
    assert.equal(registro.destinos.length, 1);
  }
});

test('estado: perfil, Páginas, escolha, vencimento e termos (com link quando não aceitos)', async () => {
  const { servico } = montar({ termos: false, conexao: { id: 'conn-1', nome: 'Taian', status: 'connected', token: TOKEN, expiraEm: new Date(AGORA + 5 * DIA) } });
  await servico.escolher({ ...escopo, adAccountId: '111', pixelId: '555' });
  const estado = await servico.estado(escopo);
  assert.deepEqual(estado.perfil, { nome: 'Taian' });
  assert.deepEqual(estado.paginas, [{ id: '77', nome: 'Página Alva' }]);
  assert.equal(estado.vencimento.dias, 5);
  assert.equal(estado.vencimento.venceEmBreve, true);
  assert.deepEqual(estado.termos, { aceitos: false, link: 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=111', erro: null });
  assert.equal(estado.precisaReconectar, false);
});

test('token vencido pela data: marca a conexão e o estado pede reconectar', async () => {
  const { servico, registro } = montar({ conexao: { id: 'conn-1', nome: 'Taian', status: 'connected', token: TOKEN, expiraEm: new Date(AGORA - DIA) } });
  await assert.rejects(() => servico.contasDeAnuncios(escopo), (erro) => erro.status === 409);
  assert.equal(registro.marcadas[0].motivo, 'token_vencido');
  assert.equal((await servico.estado(escopo)).precisaReconectar, true);
});

test('a Meta recusa o token (190) ao listar: a conexão é marcada para reconectar', async () => {
  const recusa = Object.assign(new Error('A Meta não aceita mais esta conexão. Conecte de novo.'), { reconectar: true, status: 502 });
  const { servico, registro } = montar({ falhaMeta: recusa });
  await assert.rejects(() => servico.contasDeAnuncios(escopo), (erro) => erro.reconectar === true);
  assert.deepEqual(registro.marcadas, [{ companyId: 'c1', motivo: 'token_recusado' }]);
});

test('sem conexão: estado diz não conectado; listar é 409', async () => {
  const { servico } = montar({ conexao: null });
  assert.equal((await servico.estado(escopo)).conectado, false);
  await assert.rejects(() => servico.contasDeAnuncios(escopo), (erro) => erro.status === 409);
});
