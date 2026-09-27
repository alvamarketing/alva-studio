# Auditoria dos destinos de conversão contra a documentação oficial

27/09/2026. Cada destino do rastreamento — Meta, TikTok, Google Ads, LinkedIn e
Taboola — foi conferido contra o portal de developers da própria plataforma. Regra
do dono: **nunca adivinhar**. Todo fato abaixo tem a página oficial ao lado; o que a
documentação não diz está marcado como não confirmado.

Quem leu: um subagente por plataforma, e as afirmações que mudam código foram
relidas por mim no navegador (marcadas com ✔︎ lido).

---

## Meta — Conversions API e Pixel

| # | O que o código fazia | O que a Meta documenta | Gravidade |
|---|---|---|---|
| M1 | Graph API `v20.0` | v20.0 ficou disponível até **24/09/2026**. A atual é a **v26.0** ✔︎ lido — [changelog](https://developers.facebook.com/docs/graph-api/changelog) | **quebra**: nenhum evento chegaria |
| M2 | Token no cabeçalho `Authorization: Bearer` | O endpoint documentado é `.../{PIXEL_ID}/events?access_token={TOKEN}`; a página não fala em Bearer ✔︎ lido — [using the API](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api) | risco de quebra |
| M3 | O modo de teste prometia "não entra nos dados das campanhas" | "Events sent with test_event_code are **not dropped**. They flow into Events Manager and are used for targeting and ads measurement purposes." ✔︎ lido — mesma página | **promessa falsa na tela** |
| M4 | Telefone: só tira o que não é dígito | Tirar símbolos, letras e zeros à esquerda; **sempre com código do país**, "even if all of your data is from the same country". Formato: só dígitos (`16505551212`) ✔︎ lido — [customer information](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters) | perde correspondência |
| M5 | E-mail: trim + minúsculas | Igual ✔︎ lido — mesma página | correto |
| M6 | `fbc` montado com índice de subdomínio fixo `1`, e o cookie `_fbc` do pixel não é lido | Preferir o `_fbc` que o pixel grava; montar à mão só sem ele. O índice é "o domínio em que o cookie está definido" ✔︎ lido — [fbp e fbc](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc) | perde dado com o pixel ligado |
| M7 | `event_source_url` e `client_user_agent` somem quando não há valor | Obrigatórios para eventos de site — [parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters) | a conferir: quando falta |
| M8 | Stub do `fbq` próprio | O código base oficial define `callMethod`, `push`, `loaded`, `version`, `queue` — [pixel get started](https://developers.facebook.com/docs/meta-pixel/get-started) | risco; usar o oficial |
| M9 | Recusa lida pelo status HTTP (401/403) | Token inválido é `OAuthException` código 190 — [handle errors](https://developers.facebook.com/docs/graph-api/guides/error-handling); o status HTTP exato não confirmado | motivo errado na tela |

Confirmado correto: endpoint `/{pixel_id}/events`, `test_event_code` no nível de
cima ✔︎, deduplicação por `event_name` + `event_id` em 48h, nomes `Lead`,
`InitiateCheckout`, `Purchase`.

## TikTok — Events API 2.0 e Pixel

| # | O que o código fazia | O que o TikTok documenta | Gravidade |
|---|---|---|---|
| T1 | Não manda `page.url` | `page.url` é **obrigatório** para eventos web — [setup guide web](https://business-api.tiktok.com/portal/docs/setup-guide-for-web/v1.3) | quebra/perde dado |
| T2 | Não manda `user.ip` nem `user.user_agent` | Recomendados, em texto puro — [parameters](https://business-api.tiktok.com/portal/docs/parameters/v1.3) | perde correspondência |
| T3 | Telefone: só dígitos | **E.164 com `+`** e código do país, depois SHA-256 ✔︎ lido — [parameters](https://business-api.tiktok.com/portal/docs/parameters/v1.3) | perde correspondência |
| T4 | Stub do `ttq` próprio | Código base oficial com `ttq.methods`, `setAndDefer`, `instance` — [install pixel](https://business-api.tiktok.com/portal/docs/install-pixel-using-code/v1.3) | risco; usar o oficial |
| T5 | Recusa lida só pelo status HTTP | Checar o campo `code` do corpo — [responses and errors](https://business-api.tiktok.com/portal/docs/responses-and-errors/v1.3) | recusa aparece como entregue |

Confirmado correto: endpoint v1.3, cabeçalho `Access-Token`, `test_event_code` no
nível de cima (a dúvida anterior está resolvida), nomes `Lead`/`InitiateCheckout`/
`Purchase`, `ttq.track(nome, {}, {event_id})`, URL do script, deduplicação.
Modo de teste do pixel do navegador é pelo QR code da aba Test Events, não por
parâmetro.

## Google Ads — Data Manager API

| # | O que o código fazia | O que o Google documenta | Gravidade |
|---|---|---|---|
| G1 | `consent` com `adUserData`, `adPersonalization`, `adStorage`, `analyticsStorage` e valores `GRANTED`/`DENIED` | O objeto `Consent` tem **só** `adUserData` e `adPersonalization`, com valores **`CONSENT_GRANTED`/`CONSENT_DENIED`** — [Consent](https://developers.google.com/data-manager/api/reference/rest/v1/Consent) | **quebra** provável: corpo inválido |
| G2 | Token OAuth colado à mão pelo dono | Credencial por Application Default Credentials: cliente OAuth com refresh token, ou conta de serviço com impersonation; escopo `datamanager` (sensível, exige verificação do app) — [set up access](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access) | **quebra**: o token expira e não há como renovar |
| G3 | Telefone só dígitos; e-mail trim + minúsculas | Telefone **E.164 com `+`**; e-mail em minúsculas, e em gmail.com/googlemail.com sem pontos e sem sufixo `+` — [formatting](https://developers.google.com/data-manager/api/devguides/concepts/formatting) | perde correspondência |

Confirmado correto: endpoint `datamanager.googleapis.com/v1/events:ingest`,
`operatingAccount`, `productDestinationId`, `adIdentifiers` (gclid/gbraid/wbraid),
`eventTimestamp` RFC 3339, `encoding: HEX`. Janela: 90 dias após o clique.

## LinkedIn — Conversions API

Tudo o que o código usa está confirmado: endpoint `/rest/conversionEvents`,
cabeçalhos `Linkedin-Version` e `X-Restli-Protocol-Version: 2.0.0`, corpo, URN,
ids aceitos, `li_fat_id` → `LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID`, escopos
`rw_conversions` + `r_ads` — [conversions API](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api).
A versão padrão `202608` vale; a mais antiga no ar é `202510`.

Não confirmado: a página da Conversions API não diz como normalizar o e-mail antes
do hash; o Studio usa minúsculas sem espaços nas pontas. A mesma página aceita o IP de
quem converteu como identificador (`PLAINTEXT_IP_ADDRESS`) ✔︎ lido — o Studio já tem
esse IP e ainda não o manda.

Riscos: o token dura **60 dias** ([authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)),
e renovar por programa é só para parceiros aprovados; conversão com mais de 90
dias é recusada.

## Taboola — S2S e Pixel

| # | O que o código fazia | O que a Taboola documenta | Gravidade |
|---|---|---|---|
| B1 | Script `cdn.taboola.com/libtrc/unip/loader.js` | `cdn.taboola.com/libtrc/unip/<account_id>/tfa.js` — [base pixel](https://developers.taboola.com/pixel/docs/add-the-base-pixel-manually) | **quebra**: pixel não carrega |
| B2 | `_tfa.push({notify:'page_view', id})` | `_tfa.push({notify:'event', name:'page_view', id})` — mesma página | **quebra** |
| B3 | O nome do evento no S2S é o interno (`lead`) | "the event name must match exactly the conversion name entered in Realize, otherwise Taboola will not receive the event" — [postback URL](https://developers.taboola.com/pixel/docs/the-postback-url) | **quebra silenciosa** |
| B4 | Nenhum campo de configuração; o pixel lê um `account_id` que a tela nunca pede | O pixel precisa do Account ID numérico — [your account id](https://developers.taboola.com/pixel/docs/your-account-id) | pixel nunca carrega |

Confirmado correto: endpoint S2S `trc.taboola.com/actions-handler/log/3/s2s-action`,
parâmetro `click-id`, e que o S2S não exige credencial (a conta sai do click id).

---

## O que isto muda na régua

- **Critério 15** prometia "sem afetar os dados reais". A Meta documenta o contrário.
  O modo de teste passa a ser o que ele é: ver o evento chegar na aba Eventos de
  Teste — e a tela avisa que a Meta conta esses eventos.
- **Critério 10** (conferido por revisor independente): recarregar a página de
  obrigado reenvia o formulário e gera um segundo lead, com outro id.

## Decisões do dono

1. **Telefone sem código do país.** As três plataformas exigem o código. Proposta:
   número com 10 ou 11 dígitos sem código é tratado como brasileiro (+55).
2. **Google Ads.** Funcionar de verdade exige que a Alva tenha um app no Google Cloud,
   com tela "Conectar com Google" e verificação do escopo `datamanager` pelo Google.
   Isso é conta do dono, não código.
3. **LinkedIn.** O token vence em 60 dias. Proposta: a tela avisa antes de vencer.
