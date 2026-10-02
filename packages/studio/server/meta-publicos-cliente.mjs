// O cliente da Graph API para públicos personalizados de site. É a única parte do Studio que
// cria algo na conta de anúncios da Meta, e por isso é pequena e recebe o `fetch` por
// parâmetro: os testes mostram o corpo exato que sairia, sem nenhuma chamada real.
//
// Este token NÃO é o da Conversions API. O da Conversions API nasce no Gerenciador de
// Eventos, atribuído ao pixel, "sem pedir nenhuma permissão" (documentação da Conversions
// API); criar público é gerenciar a conta de anúncios, que exige a permissão
// `ads_management` (documentação de autorização da Marketing API). Por isso o Studio guarda
// um segundo token, só para isto.
// - https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started
// - https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization
import { VERSAO_DA_GRAPH_API } from './meta-config.mjs';

const RAIZ = 'https://graph.facebook.com';
const LIMITE_DE_PAGINAS = 50;
const TEMPO_LIMITE_MS = 15_000;
const CONTA = /^\d{1,20}$/;
// Códigos de limite de chamadas que a documentação lista para a conta de anúncios (80003 na
// leitura de públicos; 80000, 80004 e 80014 na página de limites) e os de uso geral.
// - https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting
// - https://developers.facebook.com/docs/graph-api/guides/error-handling
const LIMITE_DE_CHAMADAS = new Set([4, 17, 341, 80000, 80003, 80004, 80014]);
// Subcódigos que a página de Custom Audience mostra quando a Meta bloqueia um público por
// política de integridade.
// https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/custom-audience
const BLOQUEIO_DE_INTEGRIDADE = new Set([1713231, 1713228]);

// Erro já escrito para o dono, em português, sem token. `fatal` diz que insistir com os
// outros públicos da mesma rodada vai falhar pelo mesmo motivo (credencial ou permissão).
export class MetaApiError extends Error {
  constructor(message, { code = null, subcode = null, fatal = false, status = 502 } = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.subcode = subcode;
    this.fatal = fatal;
    this.status = status;
    this.statusCode = status;
  }
}

export function limpar(valor, token) {
  let texto = String(valor ?? '');
  if (token) texto = texto.split(token).join('[token]');
  return texto
    .replace(/https?:\/\/\S+/gi, '[endereço]')
    .replace(/access_token=\S+/gi, 'access_token=[token]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [token]')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function erroDaMeta(corpo, token) {
  const erro = corpo?.error ?? {};
  const code = Number.isInteger(erro.code) ? erro.code : null;
  const subcode = Number.isInteger(erro.error_subcode) ? erro.error_subcode : null;
  const detalhe = limpar(erro.error_user_msg || erro.message, token);
  if (code === 190) return new MetaApiError('A Meta recusou o token (inválido ou expirado). Gere outro token e salve de novo.', { code, subcode, fatal: true, status: 502 });
  if (code === 200) return new MetaApiError('O token não tem permissão para criar públicos nesta conta de anúncios. Ele precisa da permissão ads_management e de acesso à conta.', { code, subcode, fatal: true, status: 502 });
  if (code !== null && LIMITE_DE_CHAMADAS.has(code)) return new MetaApiError('A Meta recebeu muitas chamadas desta conta. Espere alguns minutos e tente de novo.', { code, subcode, status: 429 });
  if (subcode !== null && BLOQUEIO_DE_INTEGRIDADE.has(subcode)) return new MetaApiError('A Meta bloqueou este público por política de integridade. Revise o público no Gerenciador de Anúncios.', { code, subcode, status: 502 });
  // A documentação da Meta não lista um código para "termos não aceitos": chega como recusa
  // genérica. Em vez de adivinhar um código, a mensagem aponta a causa mais comum.
  if (code === 100) return new MetaApiError(`A Meta recusou os dados do público${detalhe ? ` (${detalhe})` : ''}. Se esta é a primeira vez nesta conta de anúncios, aceite os Termos de Públicos Personalizados no Gerenciador de Anúncios e tente de novo.`, { code, subcode, status: 502 });
  return new MetaApiError(`A Meta devolveu um erro${code !== null ? ` (código ${code})` : ''}${detalhe ? `: ${detalhe}` : '.'}`, { code, subcode, status: 502 });
}

function pixelDaRegra(regra) {
  try {
    const lida = typeof regra === 'string' ? JSON.parse(regra) : regra;
    const id = lida?.inclusions?.rules?.[0]?.event_sources?.[0]?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export function criarClienteDePublicos({ fetch: buscar = globalThis.fetch, token, contaDeAnuncios }) {
  const segredo = typeof token === 'string' ? token.trim() : '';
  if (!segredo) throw Object.assign(new Error('Informe o token de acesso da Meta.'), { status: 400, statusCode: 400 });
  const conta = String(contaDeAnuncios ?? '').trim().replace(/^act_/i, '');
  if (!CONTA.test(conta)) throw Object.assign(new Error('Informe o ID numérico da conta de anúncios.'), { status: 400, statusCode: 400 });
  const base = `${RAIZ}/${VERSAO_DA_GRAPH_API}/act_${conta}/customaudiences`;

  async function chamar(url, opcoes) {
    let resposta;
    try {
      resposta = await buscar(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    } catch {
      // A mensagem da falha de rede pode trazer a URL da chamada — e, na leitura, o token
      // vai na URL. Nada dela sai daqui.
      throw new MetaApiError('Não foi possível falar com a Meta agora. Tente de novo em instantes.', { status: 502 });
    }
    let corpo = null;
    try { corpo = await resposta.json(); } catch { corpo = null; }
    if (!resposta.ok || corpo?.error) throw erroDaMeta(corpo, segredo);
    return corpo ?? {};
  }

  return {
    // Cria um público de site. O token vai no corpo, como no `curl -F access_token=` da
    // documentação, e não na URL que acaba em registro de acesso. `rule` é a regra como
    // string JSON, e `prefill=1` traz a atividade de antes da criação (até 180 dias).
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences
    async criar({ nome, regra }) {
      const corpo = new URLSearchParams({ name: nome, rule: JSON.stringify(regra), prefill: '1', access_token: segredo });
      const resultado = await chamar(base, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo.toString() });
      if (typeof resultado.id !== 'string' || !resultado.id) throw new MetaApiError('A Meta respondeu sem identificador do público criado.', { status: 502 });
      return { id: resultado.id };
    },

    // Lista os públicos da conta (id, nome e a regra, de onde sai o pixel) para não criar o
    // mesmo público duas vezes. A leitura usa o token na query, como o exemplo da página.
    // Um cabeçalho `Authorization: Bearer` seria melhor, mas não achei isso nas páginas oficiais
    // da Meta (conferido em 02/10/2026) e a regra do projeto é não adivinhar integração.
    // https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences
    async listar() {
      const achados = [];
      let url = `${base}?${new URLSearchParams({ fields: 'id,name,rule', limit: '100', access_token: segredo })}`;
      for (let pagina = 0; url && pagina < LIMITE_DE_PAGINAS; pagina += 1) {
        const resultado = await chamar(url, { method: 'GET' });
        for (const item of Array.isArray(resultado.data) ? resultado.data : []) {
          if (typeof item?.id === 'string') achados.push({ id: item.id, nome: String(item.name ?? ''), pixelId: pixelDaRegra(item.rule) });
        }
        const proxima = resultado.paging?.next;
        // O `next` traz o token. Só se segue o que aponta para a própria Graph API.
        url = typeof proxima === 'string' && proxima.startsWith(`${RAIZ}/`) ? proxima : null;
      }
      return achados;
    },
  };
}
