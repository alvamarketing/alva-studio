# Conectar com o Facebook (Meta) — especificação

02/10/2026. Substitui o preenchimento manual de ID da conta de anúncios, token e ID do pixel por um
botão **"Conectar com o Facebook"**: o cliente autoriza no pop-up da Meta e depois só escolhe, em
listas, a conta de anúncios e o pixel. Só o dono do Studio configura o app da Meta, uma vez.

Duas pesquisas independentes alimentaram este documento (regras oficiais da Meta; desenho no
código). Onde a Meta não confirmou em fonte oficial está marcado **NÃO CONFIRMADO** — nada foi
preenchido de memória.

## O que a Meta exige (resumo, com fonte)

- **Produto de login:** Facebook Login **for Business** (FLfB), o recomendado para tech providers.
  App do tipo **Business**. Uma "configuration" no painel define permissões, tipo de token e
  ativos, e dá um **Configuration ID** que entra no diálogo no lugar de `scope`.
  https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- **Tipos de token:** (a) **token de usuário**, longa duração ≈ 60 dias, sem refresh — vencido,
  só com novo login; (b) **Business Integration System User (BISU)**, "defaults to never expire",
  preso ao portfólio do cliente, só por authorization code, **só login web (não funciona no
  celular)**. A Meta indica o BISU para chamadas servidor-a-servidor de conversão.
  https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
- **Permissões:** `ads_management` (criar públicos), `ads_read` (listar e CAPI),
  `business_management`; `pages_read_engagement` e `pages_show_list` são dependências.
  https://developers.facebook.com/documentation/development/permissions
- **Para contas de OUTRAS empresas:** Acesso Avançado + App Review + Business Verification (CNPJ) +
  Access Verification (Tech Provider). Prazos reais: **NÃO CONFIRMADO** (a doc diz "within a week" numa
  página e "several weeks" noutra).
  https://developers.facebook.com/documentation/development/release/business-verification
  https://developers.facebook.com/documentation/development/release/access-verification
- **Sem aprovação:** quem tem papel no app (Admin, Developer, Tester) usa normalmente com Standard
  Access. Tester só pode ser funcionário ou quem age em nome do dono — **não usar cliente como
  atalho de teste** (política da Meta).
  https://developers.facebook.com/documentation/development/graph-api/overview/access-levels
  https://developers.facebook.com/documentation/development/build-and-test/app-roles
- **Fluxo:** `https://www.facebook.com/v26.0/dialog/oauth` (client_id, redirect_uri, state,
  config_id, response_type=code) → `GET graph.facebook.com/v26.0/oauth/access_token` (do servidor)
  → opcional `fb_exchange_token` → `debug_token`. Redirect URI com correspondência exata, HTTPS.
  https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
- **Token inválido:** erros 190 (subcódigos 458/460/463/467), 102; só se resolve com novo login.
  https://developers.facebook.com/docs/graph-api/guides/error-handling
- **Termos de Públicos Personalizados:** `GET act_<id>?fields=tos_accepted` devolve
  `{"tos_accepted":{"custom_audience_tos":1}}` quando assinados. Quem assina é uma **pessoa** (não
  system user) do portfólio; o link é
  `https://business.facebook.com/ads/manage/customaudiences/tos/?act=<ID>`. Sem aceite a API devolve
  erro 200 / subcódigo 1870090. Se um app pode aceitar pelo cliente: **NÃO CONFIRMADO** — tratar como
  "o cliente aceita pelo link".
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account
- **Contas e pixels (conferido pelo builder da F2 em 02/10/2026):** `/me/adaccounts` não aparece
  na referência do nó User — **não é usado**. A F2 usa `/me/businesses` →
  `/{business_id}/owned_ad_accounts` e `/client_ad_accounts` (contas pessoais fora de portfólio
  não aparecem), `act_<id>/adspixels`, `/me/accounts` (Páginas, só nome) e
  `act_<id>?fields=tos_accepted`. Paginação pelo cursor `after`, com teto de páginas.
  https://developers.facebook.com/docs/graph-api/reference/user/businesses/
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/owned_ad_accounts
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/client_ad_accounts
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/adspixels
  https://developers.facebook.com/docs/graph-api/reference/user/accounts/
  https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/custom-audience-terms-of-service
  https://developers.facebook.com/docs/graph-api/results
- **Contas e pixels (pesquisa original):** `/me/adaccounts` **NÃO CONFIRMADO** na v26. Documentados:
  `/me/businesses` → `/{business_id}/owned_ad_accounts` e `/client_ad_accounts`;
  `act_<id>/adspixels`; `/{business_id}/owned_pixels` e `/client_pixels`; com BISU,
  `/me?fields=client_business_id`. O builder confere cada um na documentação antes de usar.
- **Conversions API:** `POST /{pixel_id}/events`. O caminho manual de hoje (token do Gerenciador de
  Eventos) dispensa App Review; o do FLfB/BISU exige aprovação. Se um "Facebook representative" é
  obrigatório: **NÃO CONFIRMADO**.
  https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started
- **Obrigações:** política de privacidade pública; **callback de exclusão de dados** (POST com
  `signed_request` HMAC-SHA256, resposta `{url, confirmation_code}`); **callback de desautorização**
  (formato do payload **NÃO CONFIRMADO** em fonte oficial; para BISU, webhooks
  `business_integration_install/uninstall/update`); botão de desconectar no Studio; guardar token
  criptografado; verificar validade ao menos diariamente; `appsecret_proof` nas chamadas de servidor.
  https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback
- **App Review:** pede screencast do login e de **métricas de anúncio** aparecendo no produto
  (impressões, gasto, cliques…). **O Studio hoje não mostra isso — maior risco de rejeição.**
  https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide

## Decisões (tomadas em 02/10/2026)

| # | Decisão |
|---|---|
| D1 | Conexão **da empresa** (uma pessoa conecta; vale para todos os projetos). A escolha de conta de anúncios e pixel é **do projeto**. Uma conexão por empresa por ora; a tabela tem `id` próprio para afrouxar depois. |
| D2 | O preenchimento manual **continua**, como "Prefiro preencher manualmente". A origem gravada no projeto (`manual` ou `connection`) vale; nunca as duas ao mesmo tempo. |
| D3 | O tipo de token é **parâmetro** (`user` ou `system_user`). ~~A CAPI só usa a conexão se o token for `system_user` (não vence); com token de usuário (≈60 dias) a conexão escolhe só o pixel e o token da CAPI segue colado — vencimento silencioso perderia conversões.~~ **Mudada em 02/10/2026 (ver D3′).** |
| D3′ | **02/10/2026, pedido do dono (tudo automático):** a CAPI **usa o token da conexão mesmo sendo `user`** (≈60 dias). Mitigações obrigatórias, todas com teste: (i) o vencimento (`token_expires_at`, do `expires_in` da troca por token longo) aparece no cartão como "vence em N dias", com aviso destacado e **Reconectar** quando faltam ≤ 7 dias; (ii) token vencido pela data, recusado (190/102) ou conexão desfeita fazem a entrega falhar **sem retentar**, com o motivo `destination_connection_needs_reconnect` na tela de eventos, a conexão marcada `needs_reconnect` e o destino "Meta" mostrando "Precisa reconectar" — nunca falha silenciosa; (iii) a origem gravada é uma só (`token_source`: `connection` apaga o token colado; colar um token volta para `manual`), e trocar o manual pela conexão exige confirmação na tela. O destino guarda só o pixel: o token é decifrado da conexão da empresa a cada envio, assinado com `appsecret_proof`. |
| D4 | `/privacidade` é página pública exigida pela Meta; o texto é do dono (o Studio entrega um rascunho para revisão, sem valor jurídico). |
| D5 | Redirect fixo: `PUBLIC_ORIGIN + /conexoes/meta/retorno`. Trocar o domínio exige atualizar o app na Meta. |
| D6 | Exclusão de dados apaga a pessoa (token, id, nome, escopos). **Não** apaga as escolhas de conta e pixel dos projetos (dado da empresa). |
| D7 | Segredo do `state`: derivado por HKDF de `TRACKING_MASTER_KEY` (`alva/meta-oauth-state/v1`), sem variável nova. |
| D8 | `appsecret_proof` em toda chamada de servidor; o worker recebe `META_APP_SECRET`. |
| D9 | **Redirecionamento na mesma aba**, não pop-up: no celular `window.open` depois de um `await` é bloqueado, e o facebook.com corta `window.opener`. |
| D10 | Desconectar **nunca** apaga os públicos já criados na conta de anúncios nem os registros de `meta_audiences`. Escrito em teste. |

## Arquitetura

**Segurança do retorno.** O cookie de sessão é `SameSite=Strict`: no redirect vindo de facebook.com
ele não vai. Por isso o retorno é uma **página estática fora de `/api/`** (`GET /conexoes/meta/retorno`,
que já passa pela exceção de navegação de topo), cujo JS (arquivo externo, sem inline) lê `code`,
`state` e `error`, limpa a barra com `history.replaceState` e faz `POST /api/companies/:id/meta-connection/finish`
same-origin — com cookie, Origin e CSRF normais. A conclusão é rota autenticada comum presa à sessão,
o que impede "fixação de conexão".

**`state`:** `base64url(payload).base64url(HMAC-SHA256)`, `payload = {v:1, n, c, p, u, s:sha256(sessionId), exp}`,
10 min, **uso único** (`UPDATE … SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL AND
expires_at>now() AND company_id=$2 AND user_id=$3 AND session_hash=$4`), consumido **antes** de trocar
o código com a Meta.

**Token:** cifrado em `meta_connections.encrypted_token` (AES-256-GCM, `SecretVault`, chave
`TRACKING_MASTER_KEY`, escopo/AAD `meta-connection:{companyId}:{metaUserId}`). Nunca em log, erro,
resposta ou HTML.

**Dados — migração 035 (F2):** `meta_project_selections` (empresa, projeto, conta, pixel, nomes,
`automatic`, `connection_id` com `ON DELETE SET NULL` — desconectar mantém a escolha como histórico,
D6/D10). O worker passa a receber `META_APP_ID`/`META_APP_SECRET` (compose) para assinar a CAPI.

**Dados — migração 034 (a 033 já existe):** `meta_connections`, `meta_oauth_states`,
`meta_data_deletion_requests`; `ALTER meta_audience_credentials` (+`source`, +`connection_id`,
`encrypted_token` aceita NULL com CHECK). `tracking_destinations` sem mudança de schema: a configuração
cifrada da Meta ganha `token_source: 'manual'|'connection'`.

**Rotas:**

| Método | Caminho | Permissão |
|---|---|---|
| GET | `/api/companies/:id/meta-connection` | integration.manage |
| POST | `/api/companies/:id/meta-connection/start` `{projectId}` → `{url}` | integration.manage |
| POST | `/api/companies/:id/meta-connection/finish` `{code\|error, state}` | integration.manage |
| DELETE | `/api/companies/:id/meta-connection` | integration.manage |
| GET | `/api/companies/:id/meta-connection/ad-accounts` | integration.manage |
| GET | `/api/projects/:pid/meta-connection/pixels?adAccountId=` | integration.manage |
| GET | `/api/projects/:pid/meta-connection` (estado do projeto: escolha, destino, Páginas, vencimento, termos) | integration.manage |
| PUT | `/api/projects/:pid/meta-connection/selection` `{adAccountId, pixelId, substituirManual?, automatica?}` · GET lê a escolha | integration.manage |
| GET | `/conexoes/meta/retorno` (HTML estático) | público |
| POST | `/conexoes/meta/desautorizar`, `/conexoes/meta/exclusao` (`signed_request`) | público, assinado |
| GET | `/conexoes/meta/exclusao/:codigo`, `/privacidade` | público |

`/api/session` expõe `runtime.metaConexao: true` só quando `META_APP_ID` e `META_APP_SECRET` existem.

**Variáveis novas:** `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` (opcional),
`META_TOKEN_TYPE` (`user`|`system_user`, padrão `user`). `META_REDIRECT_URI` não é exigida: deriva de
`PUBLIC_ORIGIN`. Tudo da Meta num módulo só, `server/meta-config.mjs` (versão, escopos, URL do
diálogo, códigos de erro, prazos).

**Interface** (contrato visual: wireframe "Empresa e equipe"; cartão `.surface` + `.surface-head`, só
tokens existentes): cartão **"Conta da Meta"** no topo da aba Rastreamento das Configurações do
projeto. Estados: desligado (sem `runtime.metaConexao`: não aparece) → não conectado (**Conectar com
o Facebook** + "Prefiro preencher manualmente") → abrindo → conectado (nome, "conectado por X", listas
de conta e pixel, Desconectar) → vence em breve → precisa reconectar (190/463/467) → permissão faltando.

## Fases

| Fase | Entrega | Tamanho | Precisa da Meta aprovar? |
|---|---|---|---|
| F0 | Dono cria o app Business, FLfB, Configuration, URIs, testadores | pequeno (dono) | não |
| F1 | `meta-config`, migração 034, state, repositório, rotas start/finish/estado/desconectar, página de retorno, flag, variáveis, cartão mínimo (conectar/estado/desconectar); tudo com `fetch` falso | médio | não |
| F2 | Listas de contas e pixels, `tos_accepted` + link dos termos, escolha pela conexão, públicos usando o token da conexão, convivência com o manual | médio | não (conta do dono) |
| F3 | Ciclo de vida: 190 → reconectar, aviso de vencimento, callbacks de desautorização e exclusão, página de status, `/privacidade` | pequeno/médio | não; é pré-requisito do App Review |
| F4 | Pixel/CAPI pela conexão (`token_source`), conforme D3 | médio | não |
| F5 | Business Verification, Access Verification, App Review (e talvez tela de métricas de anúncio), abrir para clientes | pequeno de código, grande de espera | **sim** |

## Riscos e o que continua em aberto

- Sem F5, só quem tem papel no app usa o botão; **o preenchimento manual segue sendo o caminho dos clientes**.
- O screencast do App Review exige métricas de anúncio na tela; o Studio não tem. Decidir antes de enviar.
- BISU não funciona no celular; o dono trabalha muito pelo celular. Por isso o tipo de token é parâmetro.
- Itens **NÃO CONFIRMADOS** acima são verificados pelo builder na documentação oficial antes de depender deles.
