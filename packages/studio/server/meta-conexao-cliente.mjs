// O cliente do login da Meta: monta o endereço do diálogo, troca o código por token e
// pergunta à Graph API quem é a pessoa e o que ela autorizou. Recebe o `fetch` por
// parâmetro, como o cliente de públicos: os testes mostram cada chamada sem tocar a rede.
//
// O segredo do app e o token nunca saem daqui em mensagem de erro: a URL da troca leva o
// segredo (é assim que a documentação pede), e a de leitura leva o token.
import { createHmac } from 'node:crypto';
import {
  CAMPOS_DO_PERFIL, ESCOPOS, PAGINACAO, PARAMETROS_EXTRAS_DO_DIALOGO, PRAZOS, RAIZ_DA_GRAPH, URL_DO_DIALOGO, VERSAO_DA_GRAPH_API,
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

// D8: a prova do segredo do app. A página de segurança de hoje assina `token|tempo` com o
// segredo (HMAC-SHA256, hexadecimal) e manda o tempo junto em `appsecret_time`; a prova vence
// em 5 minutos, então é gerada a cada chamada. Exportada porque a Conversions API e os
// públicos, quando usam o token da conexão, assinam do mesmo jeito.
// https://developers.facebook.com/documentation/facebook-login/security#proof
export function provaDoSegredo({ token, appSecret, agora = Date.now() }) {
  const tempo = String(Math.floor(agora / 1000));
  return { appsecret_proof: createHmac('sha256', appSecret).update(`${token}|${tempo}`).digest('hex'), appsecret_time: tempo };
}

// Um id de conta de anúncios chega como `act_123` (campo `id`) ou `123` (`account_id`).
// Daqui para dentro, só os dígitos.
const CONTA = /^\d{1,20}$/;
export const soDigitosDaConta = (valor) => String(valor ?? '').trim().replace(/^act_/i, '');

function texto(valor, limite = 200) { return String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, limite); }

function expiracao(corpo, agora) {
  const segundos = Number(corpo?.expires_in);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(agora + segundos * 1000) : null;
}

// Roda `tarefa` sobre os itens com no máximo `limite` ao mesmo tempo; devolve os resultados na
// ordem dos itens. Uma falha derruba o conjunto, como na busca em fila.
async function emParalelo(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice]);
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
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
    return new URLSearchParams({ ...parametros, access_token: token, ...provaDoSegredo({ token, appSecret, agora: agora() }) });
  }

  // Lê uma aresta inteira, página por página, pelo cursor `after`. Cada página leva uma prova
  // nova; o `next` da Meta não é seguido porque traz o token na URL e a prova velha. Para no
  // teto de páginas mesmo que a Meta diga que há mais.
  // https://developers.facebook.com/docs/graph-api/results
  async function paginar(caminho, token, parametros = {}) {
    const itens = [];
    let depois = null;
    for (let pagina = 0; pagina < PAGINACAO.maximoDePaginas; pagina += 1) {
      const consulta = { ...parametros, limit: String(PAGINACAO.porPagina), ...(depois ? { after: depois } : {}) };
      const corpo = await chamar(`${base}/${caminho}?${comProva(token, consulta)}`, { segredos: [appSecret, token] });
      if (Array.isArray(corpo.data)) itens.push(...corpo.data);
      const cursor = corpo.paging?.cursors?.after;
      if (!corpo.paging?.next || typeof cursor !== 'string' || !cursor || cursor === depois) break;
      depois = cursor;
    }
    return itens;
  }

  function conta(item, negocio) {
    const id = soDigitosDaConta(item?.account_id ?? item?.id);
    if (!CONTA.test(id)) return null;
    return { id, nome: texto(item?.name) || `Conta ${id}`, negocio };
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

    // As contas de anúncios que a pessoa alcança, por portfólio: `/me/businesses` e, em cada
    // um, as contas próprias (`owned_ad_accounts`) e as de clientes (`client_ad_accounts`).
    // `/me/adaccounts` não aparece na referência do nó User (conferido em 02/10/2026) — por
    // isso não é usado. Conta pessoal fora de portfólio não aparece aqui.
    // https://developers.facebook.com/docs/graph-api/reference/user/businesses/
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/owned_ad_accounts
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/client_ad_accounts
    async contasDeAnuncios(token) {
      const negocios = (await paginar('me/businesses', token, { fields: 'id,name' }))
        .filter((item) => typeof item?.id === 'string' && ID_DA_META.test(item.id))
        .slice(0, PAGINACAO.maximoDeNegocios);
      // Cada portfólio busca as suas duas arestas em sequência; os portfólios andam juntos, com teto.
      // Juntar na ordem dos portfólios mantém o resultado igual ao da busca em fila.
      const achadasPorNegocio = await emParalelo(negocios, PRAZOS.portfoliosEmParalelo, async (negocio) => {
        const dono = { id: negocio.id, nome: texto(negocio.name) };
        const achadas = [];
        for (const aresta of ['owned_ad_accounts', 'client_ad_accounts']) {
          for (const item of await paginar(`${negocio.id}/${aresta}`, token, { fields: 'id,account_id,name' })) {
            const achada = conta(item, dono);
            if (achada) achadas.push(achada);
          }
        }
        return achadas;
      });
      const porId = new Map();
      for (const achadas of achadasPorNegocio) for (const achada of achadas) if (!porId.has(achada.id)) porId.set(achada.id, achada);
      return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },

    // Quando o token vence, perguntado à Meta. Usado quando a troca não trouxe `expires_in`.
    // A chamada leva o token do app no formato `{app-id}|{app-secret}`, que a página de
    // tokens de acesso documenta; `expires_at` e `data_access_expires_at` são unixtime. O que
    // 0 significa não está na referência: 0 ou ausente é tratado como "não informado".
    // https://developers.facebook.com/docs/graph-api/reference/debug_token/
    // https://developers.facebook.com/docs/facebook-login/guides/access-tokens#apptokens
    async inspecionarToken(token) {
      const parametros = new URLSearchParams({ input_token: token, access_token: `${appId}|${appSecret}` });
      const corpo = await chamar(`${base}/debug_token?${parametros}`, { segredos: [appSecret, token] });
      const data = (segundos) => (Number.isFinite(Number(segundos)) && Number(segundos) > 0 ? new Date(Number(segundos) * 1000) : null);
      return { expiraEm: data(corpo?.data?.expires_at), acessoAosDadosExpiraEm: data(corpo?.data?.data_access_expires_at) };
    },

    // Os pixels de uma conta de anúncios.
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/adspixels
    async pixels(token, adAccountId) {
      const contaId = soDigitosDaConta(adAccountId);
      if (!CONTA.test(contaId)) throw Object.assign(new Error('Conta de anúncios inválida.'), { status: 400, statusCode: 400 });
      const lista = await paginar(`act_${contaId}/adspixels`, token, { fields: 'id,name' });
      return lista
        .filter((item) => typeof item?.id === 'string' && CONTA.test(item.id))
        .map((item) => ({ id: item.id, nome: texto(item.name) || `Pixel ${item.id}` }));
    },

    // As Páginas que a pessoa administra — só para mostrar no cartão (nome e id).
    // https://developers.facebook.com/docs/graph-api/reference/user/accounts/
    async paginas(token) {
      const lista = await paginar('me/accounts', token, { fields: 'id,name' });
      return lista
        .filter((item) => typeof item?.id === 'string' && ID_DA_META.test(item.id))
        .map((item) => ({ id: item.id, nome: texto(item.name) || `Página ${item.id}` }));
    },

    // Os Termos de Públicos Personalizados da conta: `tos_accepted.custom_audience_tos === 1`
    // quando assinados. Qualquer outra resposta é "não aceitos".
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/custom-audience-terms-of-service
    async termosAceitos(token, adAccountId) {
      const contaId = soDigitosDaConta(adAccountId);
      if (!CONTA.test(contaId)) throw Object.assign(new Error('Conta de anúncios inválida.'), { status: 400, statusCode: 400 });
      const corpo = await chamar(`${base}/act_${contaId}?${comProva(token, { fields: 'tos_accepted' })}`, { segredos: [appSecret, token] });
      return Number(corpo?.tos_accepted?.custom_audience_tos) === 1;
    },
  };
}
