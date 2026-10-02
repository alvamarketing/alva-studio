// Tudo o que é específico da Meta num lugar só: versão da Graph API, escopos, endereço do
// diálogo, códigos de erro e prazos. Quando a Meta aposentar uma versão ou mudar uma regra,
// a troca acontece aqui e o resto do Studio não precisa saber.
// Contrato: docs/specs/2026-10-02-conectar-com-facebook.md.

// A versão da Graph API em vigor. A v20.0 ficou no ar até 24/09/2026; cada versão dura
// cerca de dois anos. https://developers.facebook.com/docs/graph-api/changelog
// (As páginas de 02/10/2026 ainda mostram exemplos com a v25.0; a v26.0 é a que o Studio já
// usa na Conversions API e nos públicos.)
export const VERSAO_DA_GRAPH_API = 'v26.0';
export const RAIZ_DA_GRAPH = 'https://graph.facebook.com';

// O diálogo de login no fluxo manual (sem SDK): client_id, redirect_uri, state e, com o
// Facebook Login for Business, config_id no lugar de scope.
// https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
// https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
export const URL_DO_DIALOGO = `https://www.facebook.com/${VERSAO_DA_GRAPH_API}/dialog/oauth`;

// Só é usado quando não há configuration (META_LOGIN_CONFIG_ID): com ela, as permissões são
// as que o dono marcou no painel. ads_management cria públicos; ads_read lista contas e
// alimenta a CAPI; business_management e as duas de página são dependências.
// https://developers.facebook.com/documentation/development/permissions
export const ESCOPOS = Object.freeze(['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement']);

// D5: o redirect é fixo. Trocar o domínio exige atualizar o app no painel da Meta.
export const CAMINHO_DO_RETORNO = '/conexoes/meta/retorno';

export const TIPOS_DE_TOKEN = Object.freeze(['user', 'system_user']);

// Token de sistema (BISU) só sai por authorization code. No SDK isso é
// `response_type: 'code'` mais `override_default_response_type: true`; a página do FLfB
// mostra esse par só no FB.login(). Que o diálogo manual aceite o mesmo parâmetro na URL
// é NÃO CONFIRMADO — por isso ele fica aqui, fácil de tirar, e só vale para system_user.
// https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
export const PARAMETROS_EXTRAS_DO_DIALOGO = Object.freeze({
  user: Object.freeze({}),
  system_user: Object.freeze({ override_default_response_type: 'true' }),
});

// O que se pergunta ao /me. client_business_id só existe no token de sistema.
// https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
export const CAMPOS_DO_PERFIL = Object.freeze({ user: 'id,name', system_user: 'id,name,client_business_id' });

export const PRAZOS = Object.freeze({
  // O state vale 10 minutos (spec, "state").
  stateMs: 10 * 60_000,
  // O mesmo teto que o cliente de públicos usa para cada chamada à Graph API.
  chamadaMs: 15_000,
});

// Token que só se resolve com novo login: 190 (com ou sem subcódigo 458/460/463/467) e 102.
// https://developers.facebook.com/docs/graph-api/guides/error-handling
const TOKEN_INVALIDO = new Set([190, 102]);
export const SUBCODIGOS_DE_TOKEN = Object.freeze({ 458: 'app_removido', 460: 'senha_trocada', 463: 'expirado', 467: 'invalido' });
export const tokenInvalido = ({ code } = {}) => TOKEN_INVALIDO.has(code);

// Permissão: 10 e a faixa 200–299, como na mesma página de erros. A página é desenhada por
// JavaScript e não abriu como texto em 02/10/2026 — a faixa é a que o cliente de públicos já
// trata como "sem permissão" (código 200); confirmar antes de depender dela na F3.
export const faltaPermissao = ({ code } = {}) => code === 10 || (Number.isInteger(code) && code >= 200 && code <= 299);

const APP_ID = /^\d{1,32}$/;
const CONFIG_ID = /^\d{1,32}$/;

function texto(valor) { return typeof valor === 'string' ? valor.trim() : ''; }

// Devolve null quando falta META_APP_ID ou META_APP_SECRET: o recurso fica desligado e o
// preenchimento manual segue sendo o caminho. Valor presente e errado é erro de quem
// configurou o servidor — melhor parar na subida do que falhar na frente do cliente.
export function lerConfiguracaoDaMeta(env = process.env, { publicOrigin = '' } = {}) {
  const appId = texto(env.META_APP_ID);
  const appSecret = texto(env.META_APP_SECRET);
  if (!appId || !appSecret) return null;
  if (!APP_ID.test(appId)) throw new Error('META_APP_ID deve ser o número do app no painel da Meta.');
  const tipoDeToken = texto(env.META_TOKEN_TYPE) || 'user';
  if (!TIPOS_DE_TOKEN.includes(tipoDeToken)) throw new Error('META_TOKEN_TYPE deve ser "user" ou "system_user".');
  const configId = texto(env.META_LOGIN_CONFIG_ID) || null;
  if (configId && !CONFIG_ID.test(configId)) throw new Error('META_LOGIN_CONFIG_ID deve ser o número da configuration do Facebook Login for Business.');
  const origem = texto(publicOrigin);
  const configuracao = {
    appId,
    configId,
    tipoDeToken,
    // Sem PUBLIC_ORIGIN (só no ambiente local), vale a origem de quem pediu. Em produção a
    // origem pública manda sempre, para o redirect bater com o cadastrado na Meta.
    redirecionamento: (origemDaRequisicao = '') => `${origem || origemDaRequisicao}${CAMINHO_DO_RETORNO}`,
    toJSON: () => ({ appId, configId, tipoDeToken }),
    toString: () => `[configuração da Meta ${appId}]`,
  };
  // O segredo do app não é enumerável: um JSON.stringify ou um console.log descuidado não o
  // leva para log nem para resposta.
  Object.defineProperty(configuracao, 'appSecret', { value: appSecret, enumerable: false });
  return Object.freeze(configuracao);
}
