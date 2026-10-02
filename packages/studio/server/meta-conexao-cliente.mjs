// O cliente do login da Meta: monta o endereço do diálogo, troca o código por token e
// pergunta à Graph API quem é a pessoa e o que ela autorizou. Recebe o `fetch` por
// parâmetro, como o cliente de públicos: os testes mostram cada chamada sem tocar a rede.
//
// O segredo do app e o token nunca saem daqui em mensagem de erro: a URL da troca leva o
// segredo (é assim que a documentação pede), e a de leitura leva o token.
import { createHmac } from 'node:crypto';
import {
  CAMPOS_DO_PERFIL, ESCOPOS, PARAMETROS_EXTRAS_DO_DIALOGO, PRAZOS, RAIZ_DA_GRAPH, URL_DO_DIALOGO, VERSAO_DA_GRAPH_API,
  faltaPermissao, tokenInvalido,
} from './meta-config.mjs';
import { MetaApiError, erroDaMeta, limpar } from './meta-publicos-cliente.mjs';

const ID_DA_META = /^\d{1,40}$/;
const base = `${RAIZ_DA_GRAPH}/${VERSAO_DA_GRAPH_API}`;

// `limpar` tira URLs e um segredo; aqui são três (segredo do app, token e código).
function semSegredos(texto, segredos) {
  let limpo = String(texto ?? '');
  for (const segredo of segredos) if (segredo) limpo = limpo.split(segredo).join('[oculto]');
  return limpar(limpo);
}

function expiracao(corpo, agora) {
  const segundos = Number(corpo?.expires_in);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(agora + segundos * 1000) : null;
}

export function criarClienteDaConexao({ fetch: buscar = globalThis.fetch, configuracao, agora = () => Date.now() }) {
  if (!configuracao) throw new Error('Configuração da Meta obrigatória.');
  const { appId, appSecret, configId, tipoDeToken } = configuracao;

  // Erro da Meta em português, sem nenhum dos segredos da chamada. Token recusado ganha
  // `reconectar`: é o sinal para o serviço marcar a conexão e a tela pedir novo login.
  function erroDaConexao(corpo, segredos, contexto) {
    const erro = corpo?.error ?? {};
    const code = Number.isInteger(erro.code) ? erro.code : null;
    const subcode = Number.isInteger(erro.error_subcode) ? erro.error_subcode : null;
    if (contexto === 'troca') {
      // A troca falha por código vencido, já usado ou redirect diferente do cadastrado. Para
      // quem clicou, a saída é a mesma: começar de novo.
      return new MetaApiError('A Meta não aceitou esta autorização (ela vence em minutos e só vale uma vez). Conecte de novo.', { code, subcode, status: 502 });
    }
    if (tokenInvalido({ code })) return Object.assign(new MetaApiError('A Meta não aceita mais esta conexão. Conecte de novo.', { code, subcode, fatal: true, status: 502 }), { reconectar: true });
    if (faltaPermissao({ code })) return new MetaApiError('A conexão não tem a permissão necessária na Meta. Conecte de novo e aceite todas as permissões pedidas.', { code, subcode, fatal: true, status: 502 });
    const base = erroDaMeta({ error: { ...erro, message: semSegredos(erro.message, segredos), error_user_msg: semSegredos(erro.error_user_msg, segredos) } });
    base.message = semSegredos(base.message, segredos);
    return base;
  }

  async function chamar(url, { method = 'GET', segredos, contexto } = {}) {
    let resposta;
    try {
      resposta = await buscar(url, { method, signal: AbortSignal.timeout(PRAZOS.chamadaMs) });
    } catch {
      // A mensagem da falha de rede traz a URL — com o segredo ou o token. Nada dela sai.
      throw new MetaApiError('Não foi possível falar com a Meta agora. Tente de novo em instantes.', { status: 502 });
    }
    let corpo = null;
    try { corpo = await resposta.json(); } catch { corpo = null; }
    if (!resposta.ok || corpo?.error) throw erroDaConexao(corpo, segredos, contexto);
    return corpo ?? {};
  }

  // D8: toda chamada com token leva a prova do segredo do app. A versão de hoje da página
  // de segurança usa HMAC-SHA256 de `token|tempo` com o segredo, e manda o tempo junto em
  // `appsecret_time`; a prova vence em 5 minutos, então é gerada a cada chamada.
  // https://developers.facebook.com/documentation/facebook-login/security#proof
  function comProva(token, parametros = {}) {
    const tempo = String(Math.floor(agora() / 1000));
    const prova = createHmac('sha256', appSecret).update(`${token}|${tempo}`).digest('hex');
    return new URLSearchParams({ ...parametros, access_token: token, appsecret_proof: prova, appsecret_time: tempo });
  }

  function tokenDaResposta(corpo) {
    if (typeof corpo?.access_token !== 'string' || !corpo.access_token) throw new MetaApiError('A Meta respondeu sem o acesso esperado. Conecte de novo.', { status: 502 });
    return corpo.access_token;
  }

  return {
    // O diálogo. Com configuration (Facebook Login for Business), `config_id` substitui
    // `scope` — a página recomenda não mandar os dois. Sem configuration, pedem-se os escopos.
    // https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow#logindialog
    // https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
    urlDeAutorizacao({ state, redirectUri }) {
      const parametros = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
      if (configId) parametros.set('config_id', configId);
      else parametros.set('scope', ESCOPOS.join(','));
      for (const [chave, valor] of Object.entries(PARAMETROS_EXTRAS_DO_DIALOGO[tipoDeToken] ?? {})) parametros.set(chave, valor);
      return `${URL_DO_DIALOGO}?${parametros}`;
    },

    // Troca o código pelo token, de servidor para servidor. O redirect precisa ser
    // exatamente o do diálogo.
    // https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow#exchangecode
    async trocarCodigo({ code, redirectUri }) {
      const parametros = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code });
      const corpo = await chamar(`${base}/oauth/access_token?${parametros}`, { segredos: [appSecret, code], contexto: 'troca' });
      return { token: tokenDaResposta(corpo), expiraEm: expiracao(corpo, agora()) };
    },

    // Token de usuário vira de longa duração (cerca de 60 dias). Token de sistema não vence
    // e não passa por aqui.
    // https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
    async estenderToken(token) {
      if (tipoDeToken !== 'user') throw new Error('Token de sistema não é estendido.');
      const parametros = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token });
      const corpo = await chamar(`${base}/oauth/access_token?${parametros}`, { segredos: [appSecret, token] });
      return { token: tokenDaResposta(corpo), expiraEm: expiracao(corpo, agora()) };
    },

    // Quem autorizou. Com token de sistema, o portfólio do cliente vem em client_business_id.
    // https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
    async quemSou(token) {
      const corpo = await chamar(`${base}/me?${comProva(token, { fields: CAMPOS_DO_PERFIL[tipoDeToken] })}`, { segredos: [appSecret, token] });
      if (typeof corpo.id !== 'string' || !ID_DA_META.test(corpo.id)) throw new MetaApiError('A Meta respondeu sem identificar a conta conectada.', { status: 502 });
      const negocio = typeof corpo.client_business_id === 'string' && ID_DA_META.test(corpo.client_business_id) ? corpo.client_business_id : null;
      return { id: corpo.id, nome: String(corpo.name ?? '').slice(0, 200), clientBusinessId: negocio };
    },

    // O que a pessoa concedeu e o que recusou no diálogo.
    // https://developers.facebook.com/documentation/facebook-login/guides/permissions/request-revoke
    async permissoes(token) {
      const corpo = await chamar(`${base}/me/permissions?${comProva(token)}`, { segredos: [appSecret, token] });
      const lista = Array.isArray(corpo.data) ? corpo.data : [];
      const nomes = (status) => lista.filter((item) => item?.status === status && typeof item.permission === 'string').map((item) => item.permission);
      return { concedidas: nomes('granted'), recusadas: nomes('declined') };
    },

    // Desautoriza o app para esta pessoa: todo token dela para o app deixa de valer.
    // https://developers.facebook.com/documentation/facebook-login/guides/permissions/request-revoke#revokelogin
    async revogar({ token, metaUserId }) {
      if (!ID_DA_META.test(String(metaUserId ?? ''))) throw new Error('Identificador de usuário da Meta inválido.');
      await chamar(`${base}/${metaUserId}/permissions?${comProva(token)}`, { method: 'DELETE', segredos: [appSecret, token] });
      return true;
    },
  };
}
