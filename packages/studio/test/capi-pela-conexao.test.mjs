import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { criarClienteDeDestinos, MOTIVO_RECONECTAR, MOTIVO_SEM_APP } from '../server/tracking-cliente-direto.mjs';
import { criarTokenDaConexao } from '../server/meta-token-da-conexao.mjs';
import { lerConfiguracaoDaMeta } from '../server/meta-config.mjs';
import { motivoDaFalha } from '../public/studio-dashboard.js';

// Decisão de 02/10/2026 (muda a D3): a Conversions API usa o token da conexão da empresa.
// Estes testes cobrem as mitigações: o token é resolvido na hora (nunca copiado para o
// destino), vencido ou recusado falha de forma visível, e a recusa marca a conexão.
const SEGREDO = 'segredo-do-app-marcador';
const TOKEN = 'EAAG-token-da-conexao-marcador';
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);
const configuracao = lerConfiguracaoDaMeta({ META_APP_ID: '111', META_APP_SECRET: SEGREDO }, {});

const payload = {
  event_name: 'lead', event_time: 1_764_200_000, tracking_event_id: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29',
  source_url: 'https://lp.exemplo.test/oferta', client: { user_agent: 'Mozilla/5.0' }, user: {}, click_ids: {}, params: {}, consent_state: 'granted',
};
const entrega = { id: 'e1', companyId: 'c1', projectId: 'p1', environment: 'production', destination: 'meta', payload };

function conexoesFalsas(conexao) {
  const marcadas = [];
  return {
    marcadas,
    async comToken(companyId) { return companyId === 'c1' ? conexao : null; },
    async marcarParaReconectar(input) { marcadas.push(input); if (conexao) conexao.status = 'needs_reconnect'; },
  };
}
const conexaoBoa = (extra = {}) => ({ id: 'conn-1', status: 'connected', token: TOKEN, expiraEm: new Date(AGORA + 30 * 86_400_000), ...extra });

function montar({ conexao = conexaoBoa(), resposta = { status: 200, corpo: '' }, comApp = true } = {}) {
  const conexoes = conexoesFalsas(conexao);
  const chamadas = [];
  const tokenDaConexao = criarTokenDaConexao({ conexoes, configuracao: comApp ? configuracao : null, agora: () => AGORA });
  const cliente = criarClienteDeDestinos({
    tracking: { conversionDestinations: async () => ({ meta: { pixel_id: '555', token_source: 'connection' } }) },
    tokenDaConexao,
    fetchImpl: async (url) => { chamadas.push(new URL(url)); return { ok: resposta.status < 400, status: resposta.status, text: async () => JSON.stringify(resposta.corpo) }; },
  });
  return { cliente, chamadas, conexoes };
}

test('CAPI pela conexão: o token da empresa é resolvido na hora e vai com a prova do segredo', async () => {
  const { cliente, chamadas } = montar();
  await cliente.sendEvent(entrega);
  assert.equal(chamadas.length, 1);
  const url = chamadas[0];
  assert.match(url.pathname, /\/555\/events$/);
  assert.equal(url.searchParams.get('access_token'), TOKEN);
  const tempo = url.searchParams.get('appsecret_time');
  assert.equal(tempo, String(AGORA / 1000));
  assert.equal(url.searchParams.get('appsecret_proof'), createHmac('sha256', SEGREDO).update(`${TOKEN}|${tempo}`).digest('hex'));
});

test('a Meta recusa o token (190): a conexão vira "precisa reconectar" e a falha é visível, sem retentar', async () => {
  const { cliente, conexoes } = montar({ resposta: { status: 400, corpo: { error: { code: 190, error_subcode: 463 } } } });
  await assert.rejects(() => cliente.sendEvent(entrega), (erro) => erro.message === MOTIVO_RECONECTAR && erro.retentar === false);
  assert.deepEqual(conexoes.marcadas, [{ companyId: 'c1', motivo: 'capi_token_recusado' }]);
  assert.match(motivoDaFalha(MOTIVO_RECONECTAR, 'Meta'), /Reconectar/);
});

test('token vencido pela data: nem chega à Meta, marca a conexão e falha com "reconectar"', async () => {
  const { cliente, chamadas, conexoes } = montar({ conexao: conexaoBoa({ expiraEm: new Date(AGORA - 1000) }) });
  await assert.rejects(() => cliente.sendEvent(entrega), (erro) => erro.message === MOTIVO_RECONECTAR && erro.retentar === false);
  assert.equal(chamadas.length, 0);
  assert.equal(conexoes.marcadas[0].motivo, 'token_vencido');
});

test('conexão desfeita ou já marcada para reconectar: falha com "reconectar", sem tocar a rede', async () => {
  for (const conexao of [null, conexaoBoa({ status: 'needs_reconnect' })]) {
    const { cliente, chamadas } = montar({ conexao });
    await assert.rejects(() => cliente.sendEvent(entrega), (erro) => erro.message === MOTIVO_RECONECTAR);
    assert.equal(chamadas.length, 0);
  }
});

test('sem o app da Meta no ambiente do envio: motivo próprio, nada sai', async () => {
  const { cliente, chamadas } = montar({ comApp: false });
  await assert.rejects(() => cliente.sendEvent(entrega), (erro) => erro.message === MOTIVO_SEM_APP && erro.retentar === false);
  assert.equal(chamadas.length, 0);
  assert.match(motivoDaFalha(MOTIVO_SEM_APP), /servidor de envio/);
});

test('destino manual continua usando o token colado, sem consultar a conexão', async () => {
  let consultou = false;
  const chamadas = [];
  const cliente = criarClienteDeDestinos({
    tracking: { conversionDestinations: async () => ({ meta: { pixel_id: '1', access_token: 'colado' } }) },
    tokenDaConexao: { configurado: true, resolver: async () => { consultou = true; return null; }, marcarParaReconectar: async () => {} },
    fetchImpl: async (url) => { chamadas.push(new URL(url)); return { ok: true, status: 200, text: async () => '' }; },
  });
  await cliente.sendEvent(entrega);
  assert.equal(consultou, false);
  assert.equal(chamadas[0].searchParams.get('access_token'), 'colado');
  assert.equal(chamadas[0].searchParams.has('appsecret_proof'), false);
});

test('cofre que não decifra é conexão inutilizável, não exceção solta', async () => {
  const resolvedor = criarTokenDaConexao({ conexoes: { comToken: async () => { throw new Error('auth tag'); }, marcarParaReconectar: async () => {} }, configuracao, agora: () => AGORA });
  assert.equal(await resolvedor.resolver('c1'), null);
});
