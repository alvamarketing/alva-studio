# Tracking de pixels por projeto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publicar Meta, GA4, TikTok, LinkedIn e Taboola por projeto somente após consentimento opt-in no domínio publicado.

**Architecture:** `PublicationService` cria uma build reservation com `public_id` opaco antes do build; o snapshot recebe esse ID sem circularidade com hash. Depois cria/claim o `deployment_run` normal com `snapshot_hash NOT NULL`. O identificador de instância redundante foi removido porque não tinha função distinta do public ID. A Function first-party do deployment Vercel serve HTML, nonce/CSP por resposta, assets, consentimento e coletor. Ela encaminha ao Studio por HMAC derivado de segredo/key ID provisionados, que continua sendo autoridade de escopo, configuração e persistência. Uma projeção pública canônica e um artefato seguro persistido controlam Function, HTML, tracker, loader e rollback.

**Tech Stack:** JavaScript ESM, Node.js 22, PostgreSQL, Vercel Functions já usadas pela publicação, `node:test`, HTML/CSS/JS sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-05-tracking-pixels-design.md`; `docs/superpowers/specs/2026-09-05-tracking-analytics-design.md`, seções C–E; `produto/grafo.yaml`, nó `tracking_pixels`.

## Global Constraints

- Sem `tracking_conversoes`: nenhum token de mídia, fila, hash de PII, click ID server-side, `conversion_deliveries` ou chamada real a provider.
- Providers são somente `meta_pixel`, `ga4`, `tiktok_pixel`, `linkedin_insight`, `taboola_pixel`; URLs são literais no registro, nunca fornecidas por banco, UI ou cliente.
- Configuração e persistência usam `company_id`/`project_id`; mudanças autenticadas exigem `integration.manage`.
- Consentimento só vale com token opaco, aceite ativo, não expirado e versão de política definida no servidor.
- Sem aceite válido não pode existir SDK, imagem, beacon, `noscript` ou armazenamento de provider.
- Preview e `PIXELS_ENABLED=false` usam projeção vazia/CSP base. VSL não recebe pixel externo.
- `TRACKING_PROXY_MASTER_SECRET`, `TRACKING_PROXY_KEY_ID` de 128 bits e `STUDIO_TRACKING_ORIGIN` são pré-requisitos do proxy; ausentes no Studio ou Function significam falha fechada, sem pixels, consentimento ou coleta.
- Assinatura HMAC cobre, em sequência canônica com comprimento, timestamp, request ID, publicação, método, caminho e bytes do corpo; replay é consumido atomicamente por publicação/request ID.
- Testes usam doubles de DOM, fetch, Function e HMAC; nenhum endpoint externo é chamado.

## Estrutura de arquivos

- `server/pixel-registry.mjs`: providers, validadores, fontes/datas e allowlists CSP literais.
- `server/repositories/pixel-repository.mjs`: configurações, políticas, projeção e consentimentos transacionais.
- `server/publication-tracking-contract.mjs`: HMAC Studio ↔ Function.
- `server/repositories/tracking-proxy-secret-repository.mjs`: provisionamento, rotação e remoção do segredo do proxy.
- `api/public/[...path].mjs` e `vercel.json`: Function first-party e rewrite de todas as rotas públicas entregue pelo snapshot.
- `public/tracker.js`, `public/pixel-loader.js`, `tracking.public.json`: assets/contrato públicos do deployment.

### Task 1: Registro fechado, política e migration sem colisão

**Files:**
- Create: `packages/studio/server/pixel-registry.mjs`
- Create: `packages/studio/server/db/migrations/014_tracking_pixels.sql`
- Create: `packages/studio/test/pixel-registry.test.mjs`
- Modify: `packages/studio/test/database-schema.test.mjs`

**Interfaces:**
- `PIXEL_PROVIDERS` define os cinco slugs, identificador, pageview, allowlists por diretiva, fonte e `verifiedAt: '2026-09-05'` exatamente como a spec.
- `validatePixelConfiguration(provider, input)` aceita apenas `{ enabled, identifier }`; `providerOrigins(providers)` retorna união ordenada, sem `https:`, `*` ou origem de provider ausente.
- `project_tracking_policies`, `analytics_consents`, `tracking_proxy_secrets`, `tracking_proxy_requests`, `publication_build_reservations` e `publication_tracking_artifacts` seguem o modelo da spec, incluindo FKs compostas, índice parcial único de consentimento ativo, `UNIQUE(publication_id, request_id)`, `public_id` único separado de PK/run, reservation vinculada ao artifact e `deployment_runs.snapshot_hash` mantido obrigatório.

- [ ] Antes de criar a migration, rodar `ls packages/studio/server/db/migrations | sort -V`. `013_media_providers.sql` já ocupa o prefixo, portanto usar `014_tracking_pixels.sql`. Se outro arquivo tiver ocupado `014`, usar o menor prefixo livre acima do maior existente e atualizar testes no mesmo change set.
- [ ] Escrever testes RED: URL/snippet/domínio em input falham; Meta+GA4 não inclui os outros providers; origem/fonte/data do registro coincide com a spec e GA4 só aceita `www`/`region1`; FK/CHECK/índice parcial rejeitam escopo ou purpose inválidos e segundo aceite ativo concorrente; reservation tem PK interno e `public_id` opaco único distinto do run, estado/expiração válidos e é limpável; request ID só é único dentro da publicação; artifact exige reservation e run; `deployment_runs.snapshot_hash` continua `NOT NULL`.
- [ ] Rodar `node --test packages/studio/test/pixel-registry.test.mjs packages/studio/test/database-schema.test.mjs` e confirmar RED.
- [ ] Implementar registro/migration sem alterar migrations aplicadas.
- [ ] Rodar as mesmas suites e confirmar GREEN.

### Task 2: Repositório, política atual e consentimento concorrente

**Files:**
- Create: `packages/studio/server/repositories/pixel-repository.mjs`
- Create: `packages/studio/test/pixel-repository.test.mjs`

**Interfaces:**
- `savePolicy({ companyId, projectId, privacyPolicyUrl, policyVersion })` exige HTTPS/versão e fixa `consentExpiryDays: 365`.
- `list`, `saveProvider` e `publicProjection({ companyId, projectId, environment, pixelsEnabled })` usam apenas o registro e retornam valores públicos canônicos.
- `grantConsent`, `consentState` e `revokeConsent` fazem lock transacional por website/purpose/token hash e nunca retornam token/hash.

- [ ] Escrever testes RED com duas empresas/projetos: configuração/política não cruzam tenant; provider não habilita sem política; URL não HTTPS ou versão vazia falha; policy nova, expiração e revogação devolvem `denied`; duas concessões concorrentes deixam uma linha ativa; projeção não contém ID interno, HMAC, PII ou provider desabilitado.
- [ ] Rodar `node --test packages/studio/test/pixel-repository.test.mjs` e confirmar RED.
- [ ] Implementar `WHERE` sempre com `company_id` e `project_id`, lock antes de revogar/inserir e projeção ordenada por slug.
- [ ] Rodar a suite focada e confirmar GREEN.

### Task 3: API autenticada e tela “Rastreamento”

**Files:**
- Modify: `packages/studio/server/project-api.mjs`
- Modify: `packages/studio/server/index.mjs`
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/styles.css`
- Create: `packages/studio/test/pixel-api.test.mjs`
- Create: `packages/studio/test/pixel-settings.test.mjs`

**Interfaces:**
- `GET|PUT /api/projects/:projectId/tracking/policy`, `GET /api/projects/:projectId/tracking/pixels` e `PUT /api/projects/:projectId/tracking/pixels/:provider` exigem `integration.manage`.
- `trackingSettingsModel()` renderiza a seção **“Rastreamento”** do wireframe com URL/version e cinco linhas estáveis; sem a capacidade, não renderiza nem busca.

- [ ] Escrever testes RED: 401 sem sessão; 403 sem capacidade; 404 intertenant; body extra/provider desconhecido falha; UI não oferece token, URL de SDK ou snippet; texto informa que nova publicação aplica a mudança e pixels aguardam aceite.
- [ ] Rodar `node --test packages/studio/test/pixel-api.test.mjs packages/studio/test/pixel-settings.test.mjs` e confirmar RED.
- [ ] Implementar rotas antes dos matchers genéricos e a UI usando tokens existentes da seção **“Rastreamento”**, sem criar token visual.
- [ ] Rodar as suites focadas e confirmar GREEN; comparar em desktop e 375 px com o wireframe e guardar screenshot.

### Task 4: Segredo do proxy, instância de deployment e contrato autenticado

**Files:**
- Create: `packages/studio/server/publication-tracking-contract.mjs`
- Create: `packages/studio/server/repositories/tracking-proxy-secret-repository.mjs`
- Modify: `packages/studio/server/repositories/publication-repository.mjs`
- Modify: `packages/studio/server/publication-service.mjs`
- Modify: `packages/studio/server/index.mjs`
- Create: `packages/studio/test/publication-tracking-contract.test.mjs`
- Create: `packages/studio/test/tracking-proxy-secret.test.mjs`
- Modify: `packages/studio/test/publication-service.test.mjs`
- Modify: `packages/studio/test/analytics-http.test.mjs`

**Interfaces:**
- `ensureTrackingProxyEnvironment({ companyId, projectId, vercelProjectId, studioOrigin })` cria ou reaplica idempotentemente `TRACKING_PROXY_MASTER_SECRET` (env criptografada), `TRACKING_PROXY_KEY_ID` aleatório de 128 bits e `STUDIO_TRACKING_ORIGIN`; persiste referência/versionamento/key ID no Studio. `rotateTrackingProxyEnvironment` mantém `TRACKING_PROXY_PREVIOUS_MASTER_SECRET` por 15 min; `removeTrackingProxyEnvironment` remove os quatro envs e referências na desconexão.
- `reserveBuild({ companyId, projectId, environment, expectedRevision, requestedBy, idempotencyKey })` cria `publication_build_reservations` com PK interno e `publicId` opaco aleatório, separado de `deployment_run.id`, antes de `buildPublishableSnapshot`. `claimBuild({ reservationId, snapshotHash, manifest })` cria/claim o `deployment_run` somente após hash, mantém `snapshot_hash NOT NULL`, vincula artifact e supera a publicação anterior. `expireBuildReservations()` limpa reservations reserved/failed/expired.
- `signPublicationRequest({ timestamp, requestId, publicationId, snapshotHash, method, path, body, secret, trackingProxyKeyId, secretVersion })` e `verifyPublicationRequest(...)` usam HKDF-SHA-256 com `salt = trackingProxyKeyId` e `info` contendo public ID/versão, HMAC sobre sequência length-prefixed incluindo bytes do corpo e comparação timing-safe.
- `resolveActivePublication({ publicId, environment, snapshotHash })` aceita somente reservation não expirada/não falha/não superada, vinculada ao run ativo e ao artifact com hash/ambiente iguais. Só então `/internal/publications/:publicationId/collect` e `/internal/publications/:publicationId/consents` consomem `tracking_proxy_requests` atomicamente; replay idêntico devolve resposta persistida, corpo diferente falha e novo request ID pode ser retry legítimo.

- [ ] Escrever testes RED: provisionar duas vezes produz as mesmas referências e key ID; key IDs de dois projetos têm 128 bits e diferem; segredo, key ID ou Studio origin ausentes falham fechado; rotação aceita vN/vN-1 só durante 15 min e depois remove vN-1; desconexão remove todas as envs/referências; reservation gera public ID opaco antes do snapshot, distinto de PK/run; `deployment_run` só nasce após hash e mantém hash obrigatório; failure/expiry deixa reservation limpável; `resolveActivePublication` rejeita public ID expirado, falho, não vinculado, hash/ambiente divergente ou superado e aceita só o vinculado ao run ativo; assinatura válida aceita; timestamp, request ID, publicação, hash, método, caminho ou corpo alterados falham; replay idêntico não duplica consentimento, mesmo request ID com corpo diferente responde conflito e retry com novo ID é aceito.
- [ ] Rodar `node --test packages/studio/test/tracking-proxy-secret.test.mjs packages/studio/test/publication-tracking-contract.test.mjs packages/studio/test/publication-service.test.mjs packages/studio/test/analytics-http.test.mjs` e confirmar RED.
- [ ] Implementar provisão por API de environment variables Vercel sem registrar valor, HMAC antes de tocar dados e limpeza TTL de `tracking_proxy_requests`; não logar segredo, cabeçalho ou corpo.
- [ ] Rodar as suites focadas e confirmar GREEN.

### Task 5: Function Vercel, assets relativos e nonce/CSP por resposta

**Files:**
- Modify: `packages/studio/server/publication-snapshot.mjs`
- Modify: `packages/studio/server/content-security-policy.mjs`
- Modify: `packages/studio/server/publication-service.mjs`
- Create: `packages/studio/public/pixel-loader.js`
- Create: `packages/studio/test/publication-function.test.mjs`
- Create: `packages/studio/test/pixel-csp.test.mjs`
- Modify: `packages/studio/test/publication-snapshot.test.mjs`

**Interfaces:**
- Snapshot recebe `publicId` da build reservation e serializa-o como `publicationId` em `tracking.public.json`; inclui `api/public/[...path].mjs`, `vercel.json` com rewrite catch-all para a Function, `tracker.js`, `pixel-loader.js` e HTML template sem CSP final.
- Depois do build, o serviço claim a reservation criando o `deployment_run` com hash obrigatório e persiste `publication_tracking_artifacts` com manifesto, projeção, versões de assets, hash e vínculo a reservation/run; só marca `safe_at` após a homologação definida.
- Function gera nonce por resposta, lê env de origin/segredo e falha fechada se faltar uma delas; com ambas, busca projeção do próprio deployment, emite CSP e resolve páginas/assets, `POST /api/public/collect` e `GET|POST|DELETE /api/public/consents` no mesmo domínio.
- `formContentSecurityPolicy({ nonce, providerOrigins, ... })` usa apenas o registro; `/v/...` não recebe providers.

- [ ] Escrever testes RED: build reservation já tem `publicId` opaco quando o snapshot é construído e a projeção serializa exatamente esse valor; `deployment_run` só surge após hash e continua inválido sem `snapshot_hash`; Function encaminha somente `publicationId` que `resolveActivePublication` aceita para run/artifact/hash/ambiente atuais; duas respostas iguais têm nonces e CSPs diferentes; `vercel.json` encaminha página, asset, coleta e consentimento para a Function; origin/secret/key ID ausentes não entregam tracking nem aceitam mutação; snapshot traz assets/rotas relativos; mesmo public ID/input conserva hash e mudança de config/policy/asset muda hash; Meta só soma Meta; GA4 só permite `www`/`region1` e não inclui GTM, Google Ads, `https:`, `unsafe-eval` ou provider ausente; preview usa projeção vazia/CSP base; artefato só vira seguro após homologação.
- [ ] Rodar `node --test packages/studio/test/publication-function.test.mjs packages/studio/test/pixel-csp.test.mjs packages/studio/test/publication-snapshot.test.mjs` e confirmar RED.
- [ ] Implementar artefato da Function conforme Task 4, com `Cache-Control: no-store` para HTML/consentimento, `nosniff`, `no-referrer` e CSP em cabeçalho, sem meta como autoridade.
- [ ] Rodar as suites focadas e confirmar GREEN.

### Task 6: Loader, banner e consentimento no domínio publicado

**Files:**
- Modify: `packages/studio/public/pixel-loader.js`
- Create: `packages/studio/test/pixel-loader.test.mjs`
- Modify: `packages/studio/test/publication-function.test.mjs`

**Interfaces:**
- `bootPixelLoader({ doc, fetch, projection })` usa apenas caminhos relativos, consulta consentimento e renderiza banner; `loadEnabledProviders` recebe somente a projeção.
- Aceitar só carrega após POST com `Origin`, `requestId` novo e body mínimo; revogar usa DELETE com as mesmas proteções; reabrir preferências não usa `localStorage`.

- [ ] Escrever testes RED em DOM falso: denied, versão velha, expirado e kill switch não criam elemento externo; POST/DELETE sem Origin ou cross-site são recusados pela Function; POST bem-sucedido carrega somente providers habilitados uma vez; replay idêntico não duplica consentimento; DELETE impede nova inicialização; banner mostra URL/version do servidor; payload não contém PII, formId, VSL, URL de mídia ou tracking event ID.
- [ ] Rodar `node --test packages/studio/test/pixel-loader.test.mjs packages/studio/test/publication-function.test.mjs` e confirmar RED.
- [ ] Implementar banner acessível com foco inicial, Escape, “Aceitar”, “Continuar sem aceitar” e “Preferências de privacidade”. A segunda ação não persiste decisão nem chama provider.
- [ ] Rodar as suites focadas e confirmar GREEN.

### Task 7: Preview, kill switch, rollback e exclusão da VSL

**Files:**
- Modify: `packages/studio/server/publication-service.mjs`
- Modify: `packages/studio/server/vsl-public.mjs`
- Modify: `packages/studio/test/publication-service.test.mjs`
- Modify: `packages/studio/test/vsl-public.test.mjs`
- Modify: `packages/studio/test/vsl-runtime.test.mjs`

- [ ] Escrever testes RED: preview força `pixelsEnabled: false`; `PIXELS_ENABLED=false` força projeção/CSP base; rollback escolhe somente `publication_tracking_artifacts.safe_at` de produção e nunca a configuração atual; com cinco providers ativos, `/v/...` e `/embed/v/...` não incluem loader, config, script externo ou domínio de provider.
- [ ] Rodar `node --test packages/studio/test/publication-service.test.mjs packages/studio/test/vsl-public.test.mjs packages/studio/test/vsl-runtime.test.mjs` e confirmar RED.
- [ ] Implementar kill switch no Studio e Function e rollback por artefato armazenado, registrando ambos na auditoria. Não executar deploy real.
- [ ] Rodar as suites focadas e confirmar GREEN.

### Task 8: Certificação do nó

**Files:**
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/public/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`
- Create: `.estado/tracking_pixels.md`

- [ ] Rodar `node --test packages/studio/test/*.test.mjs` uma vez.
- [ ] Conferir com dois projetos/deployments: Function não aceita contrato de outro projeto, replay alterado ou segredo/key ID/origin ausente; cada key ID tem 128 bits e só deriva a chave do próprio `publicationId`; cookie/consentimento ficam no domínio correto; nova versão exige reaceite; rotação só aceita duas versões na janela; public ID é distinto de PK/run e resolução rejeita reservation vencida, falha, não vinculada, hash/ambiente divergente ou superada; `deployment_run` nunca fica sem hash; preview/kill switch não carregam provider; CSP só contém allowlist habilitada, com GA4 limitado a `www`/`region1`; rollback usa artefato `safe_at`; VSL continua sem pixels. Quem implementou não realiza esta conferência.
- [ ] Registrar `.estado/tracking_pixels.md` com prova do grafo, seção visual **“Rastreamento”**, screenshot e total de testes verdes. Atualizar MAPAs com arquivos realmente criados.

## Ordem de execução

1. Task 1 estabelece schema e registro.
2. Task 2 depende de 1.
3. Task 3 depende de 2; Task 4 pode iniciar após 1, mas serializa alterações em `index.mjs`.
4. Task 5 depende de 2 e 4.
5. Task 6 depende de 5; Task 7 depende de 5.
6. Task 8 é o gate final.

Nenhuma etapa publica em produção, chama SDK real ou faz request a provider externo.
