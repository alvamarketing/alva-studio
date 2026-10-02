import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteDaConexao } from '../server/meta-conexao-cliente.mjs';
import { criarServicoDeConexaoMeta } from '../server/meta-conexao-servico.mjs';
import { lerConfiguracaoDaMeta, VERSAO_DA_GRAPH_API } from '../server/meta-config.mjs';

// Conferência F2: o vencimento vinha só do `expires_in` da troca. Quando ele falta, o
// Studio pergunta à Meta pelo `debug_token` (token do app = app_id|app_secret).
// https://developers.facebook.com/docs/graph-api/reference/debug_token/
// https://developers.facebook.com/docs/facebook-login/guides/access-tokens#apptokens
const SEGREDO = 'segredo-do-app-marcador';
const TOKEN = 'EAAG-token-marcador';
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);
const configuracao = lerConfiguracaoDaMeta({ META_APP_ID: '111222333', META_APP_SECRET: SEGREDO }, { publicOrigin: 'https://studio.alva.test' });

function respostas(...lista) {
  const chamadas = [];
  const fetch = async (url) => {
    chamadas.push(new URL(String(url)));
    const proximo = lista.shift();
    if (!proximo) throw new Error('chamada inesperada');
    return { ok: proximo.status < 400, status: proximo.status, json: async () => proximo.corpo };
  };
  return { fetch, chamadas };
}

test('debug_token: input_token e o token do app, expires_at vira data', async () => {
  const falso = respostas({ status: 200, corpo: { data: { is_valid: true, expires_at: 1_795_000_000, data_access_expires_at: 1_797_000_000 } } });
  const cliente = criarClienteDaConexao({ fetch: falso.fetch, configuracao, agora: () => AGORA });
  const resultado = await cliente.inspecionarToken(TOKEN);
  const url = falso.chamadas[0];
  assert.equal(url.pathname, `/${VERSAO_DA_GRAPH_API}/debug_token`);
  assert.equal(url.searchParams.get('input_token'), TOKEN);
  assert.equal(url.searchParams.get('access_token'), `111222333|${SEGREDO}`);
  assert.equal(resultado.expiraEm.getTime(), 1_795_000_000_000);
  assert.equal(resultado.acessoAosDadosExpiraEm.getTime(), 1_797_000_000_000);
});

test('debug_token: expires_at 0 ou ausente é "não informado" (o significado de 0 não está na doc)', async () => {
  for (const data of [{ expires_at: 0 }, {}, { expires_at: 'x' }]) {
    const falso = respostas({ status: 200, corpo: { data } });
    const cliente = criarClienteDaConexao({ fetch: falso.fetch, configuracao, agora: () => AGORA });
    assert.equal((await cliente.inspecionarToken(TOKEN)).expiraEm, null);
  }
});

test('debug_token: erro não leva token nem segredo', async () => {
  const falso = respostas({ status: 400, corpo: { error: { code: 100, message: `ruim ${TOKEN} ${SEGREDO}` } } });
  const cliente = criarClienteDaConexao({ fetch: falso.fetch, configuracao, agora: () => AGORA });
  await assert.rejects(() => cliente.inspecionarToken(TOKEN), (erro) => {
    const texto = `${erro.message} ${JSON.stringify(erro)}`;
    return !texto.includes(TOKEN) && !texto.includes(SEGREDO);
  });
});

function servico({ expiraNaTroca, inspecao, expiraNoCodigo = null }) {
  const salvos = [];
  const inspecoes = [];
  const repository = {
    registrarState: async () => {},
    consumirState: async () => ({ projectId: 'p1', redirectUri: 'https://studio.alva.test/conexoes/meta/retorno' }),
    salvar: async (dados) => { salvos.push(dados); return { id: 'c1' }; },
  };
  const cliente = {
    urlDeAutorizacao: ({ state }) => `https://www.facebook.com/x?state=${encodeURIComponent(state)}`,
    trocarCodigo: async () => ({ token: 'curto', expiraEm: expiraNoCodigo }),
    estenderToken: async () => ({ token: TOKEN, expiraEm: expiraNaTroca }),
    quemSou: async () => ({ id: '10203040', nome: 'Pessoa', clientBusinessId: null }),
    permissoes: async () => ({ concedidas: [], recusadas: [] }),
    inspecionarToken: async (token) => { inspecoes.push(token); if (inspecao instanceof Error) throw inspecao; return inspecao; },
  };
  const s = criarServicoDeConexaoMeta({ repository, cliente, configuracao, chaveMestra: 'c'.repeat(64), agora: () => AGORA });
  return { s, salvos, inspecoes };
}

async function conectar({ s }) {
  const escopo = { companyId: 'empresa', userId: 'pessoa', sessionId: 'sessao' };
  const { url } = await s.iniciar({ ...escopo, projectId: 'p1', origem: '' });
  return s.concluir({ ...escopo, code: 'codigo', state: new URL(url).searchParams.get('state') });
}

test('sem expires_in na troca, o vencimento vem do debug_token', async () => {
  const montado = servico({ expiraNaTroca: null, inspecao: { expiraEm: new Date(AGORA + 50 * 86_400_000) } });
  await conectar(montado);
  assert.deepEqual(montado.inspecoes, [TOKEN]);
  assert.equal(montado.salvos[0].expiraEm.getTime(), AGORA + 50 * 86_400_000);
});

test('com expires_in, debug_token não é chamado; falha do debug_token não impede conectar', async () => {
  const comPrazo = servico({ expiraNaTroca: new Date(AGORA + 60 * 86_400_000), inspecao: { expiraEm: null } });
  await conectar(comPrazo);
  assert.equal(comPrazo.inspecoes.length, 0);
  const falhou = servico({ expiraNaTroca: null, inspecao: new Error('fora do ar') });
  const resultado = await conectar(falhou);
  assert.equal(resultado.estado, 'conectado');
  assert.equal(falhou.salvos[0].expiraEm, null);
});

// Conferência F2 (N1): o `expires_in` da troca do código é o do token CURTO (≈1–2 h). Usá-lo como
// plano B gravava um prazo falso e, duas horas depois, a CAPI parava em todos os projetos.
test('o prazo do token curto nunca vale como prazo do token longo', async () => {
  const duasHoras = new Date(AGORA + 2 * 3_600_000);
  const comDebug = servico({ expiraNaTroca: null, expiraNoCodigo: duasHoras, inspecao: { expiraEm: new Date(AGORA + 55 * 86_400_000) } });
  await conectar(comDebug);
  assert.equal(comDebug.salvos[0].expiraEm.getTime(), AGORA + 55 * 86_400_000);
  const semDebug = servico({ expiraNaTroca: null, expiraNoCodigo: duasHoras, inspecao: new Error('fora do ar') });
  await conectar(semDebug);
  assert.equal(semDebug.salvos[0].expiraEm, null, 'sem prazo do token longo, melhor sem prazo do que um prazo falso');
});
