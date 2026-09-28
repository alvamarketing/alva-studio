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

---

## O que já foi consertado (27/09)

| Achado | Commit |
|---|---|
| Telefone com código do país e hash por formato de plataforma (M4, T3, G3) | `e1ade5c` |
| Consentimento do Google no formato da Data Manager API (G1) | `e1ade5c` |
| Graph API v26.0, token como `access_token` (M1, M2) | `32bf58d` |
| Resposta de cada plataforma lida pelo corpo, 40100 do TikTok volta a tentar (M9, T5) | `32bf58d` |
| Ajuda do modo de teste sem a promessa falsa (M3) | `32bf58d` |
| TikTok recebe `page.url`, `ip` e `user_agent` (T1, T2) | `9bd14ac` |
| Taboola: script e evento do pixel, ID da conta e nome do evento do Realize (B1–B4) | `c806649` |
| Código base oficial dos pixels da Meta e do TikTok (M8, T4) | `d3617fe` |
| Recarregar a página de obrigado não conta outro lead (critério 10) | `d9c03ef` |
| `_fbc` e `_fbp` do pixel lidos no envio, `_fbc` prevalece (M6) | `8bb71c5` |
| Cookie `_ttp` do TikTok em `user.ttp`, e IP no LinkedIn (`PLAINTEXT_IP_ADDRESS`) | ver commit abaixo |
| Meta exige a página e o navegador em evento de site (M7) — ✔︎ lido: "event_source_url is required for website events", "client_user_agent is required for website events". O formulário aberto direto no Studio passa a levar o navegador da própria requisição | ver commit abaixo |

## O que ficou pendente

- **Compra pelo webhook de pagamento.** Chega sem o navegador de quem comprou, e a Meta
  exige o navegador em evento de site. Hoje essas compras não vão para a Meta. O
  conserto é o checkout guardar o navegador no início e reusá-lo na compra — é trabalho
  da feature de checkout, não do rastreamento.
- **Códigos de erro do S2S da Taboola.** A página oficial (`/pixel/docs/s2s-error-codes`)
  responde "Page Not Found"; a entrega da Taboola é lida só pelo status HTTP.
- **Google e LinkedIn: token.** Decisões 2 e 3, acima.

## Segunda revisão independente (27/09)

Consertado: publicar quebrava com Google Ads ou LinkedIn configurado (`f654a17`);
o formulário publicado não tinha a proteção contra reenvio (`433ba7e`); IP de proxy
no envio direto, e conversão disparando depois de revogar a medição (`648c8bb`).

Menores, registrados:
- Taboola salva antes de a tela pedir o ID da conta e os nomes de evento continua
  "configurada"; os leads dela falham com o motivo na tela, mas nada pede para completar.
- Dois envios idênticos no mesmo instante (clique duplo sem JavaScript) passam juntos pela
  checagem de reenvio. Não há trava.
- Itens que já estavam na fila antes destes commits não têm os hashes novos nem, às vezes,
  página e navegador; falham com motivo na tela. Não há produção rodando com fila cheia.
- **Consentimento negado:** IP e navegador seguem para as plataformas mesmo quando a pessoa
  recusa a medição (e-mail e telefone não). Decisão do dono em 27/09: mandar sempre.

## Decisões tomadas em 27/09

1. Telefone sem código do país é tratado como brasileiro (+55).
2. IP e navegador vão sempre pelo servidor, inclusive com consentimento negado (dono).
3. Google Ads: a tela avisa que o token colado expira e não se renova; a conexão direta
   com o Google (app no Google Cloud) fica para depois.
4. LinkedIn: a tela avisa nos últimos 10 dias dos 60 de validade do token, e quando vence.
