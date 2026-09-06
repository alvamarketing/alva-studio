# Tracking de pixels por projeto — desenho do nó `tracking_pixels`

## Objetivo e fronteira

Adicionar Meta Pixel, GA4 (`gtag.js`), TikTok Pixel, LinkedIn Insight Tag e Taboola por projeto. Cada provider só carrega depois de consentimento publicitário **opt-in** registrado no domínio publicado; a CSP permite apenas as origens literais dos providers habilitados. O escopo cobre configuração, projeção pública, função first-party da publicação, consentimento, CSP e pixels no navegador.

Não cria token de API de mídia, fila, hash de lead, click ID server-side, `conversion_deliveries` ou conversão server-to-server. Isso pertence exclusivamente a `tracking_conversoes`. O coletor interno continua sem cookie de identificação e sem PII.

## Arquitetura decidida

O snapshot Vercel inclui uma função first-party no mesmo projeto e domínio publicado. Um `vercel.json` gerado encaminha todas as rotas públicas à função, que serve cada página com nonce aleatório de 16 bytes por resposta e CSP no cabeçalho; serve `tracker.js`, `pixel-loader.js` e a projeção pública; registra/revoga consentimento e recebe o coletor em caminhos relativos. Assim o navegador não depende de CORS nem de assets ausentes no domínio publicado.

`TRACKING_PROXY_MASTER_SECRET` é um segredo aleatório de 32 bytes e `TRACKING_PROXY_KEY_ID` é um identificador aleatório não secreto de 128 bits por integração de projeto. Ambos, junto de `STUDIO_TRACKING_ORIGIN`, são provisionados como envs do projeto Vercel antes do primeiro deployment com tracking; o segredo é env criptografada e também fica cifrado no cofre do Studio, enquanto o key ID fica persistido no Studio como metadado. `ensureTrackingProxyEnvironment` cria/atualiza o conjunto idempotentemente por API de environment variables e falha fechado se faltar origem HTTPS, segredo, key ID ou confirmação dos três envs. A Function e o Studio derivam a mesma chave com HKDF-SHA-256 (`salt = TRACKING_PROXY_KEY_ID`, `info = 'alva/tracking-proxy/' + publicationId + '/v' + secretVersion`), sem expor a raiz. Rotação provisiona nova raiz/version como `TRACKING_PROXY_MASTER_SECRET`, mantém `TRACKING_PROXY_PREVIOUS_MASTER_SECRET` por até 15 minutos e aceita só as duas versões nessa janela; depois remove a anterior. Desconectar remove master, previous, key ID e origin do Vercel, além dos segredos/metadados no Studio, com auditoria e testes de idempotência.

A função não é uma segunda autoridade de dados. Ela encaminha coleta e consentimento ao Studio por `POST /internal/publications/:publicationId/{collect|consents}`, onde `publicationId` é o `public_id` opaco da reservation, nunca o PK interno ou `deployment_run.id`. Cada pedido assina uma sequência canônica com comprimento de `timestamp`, `requestId`, `publicationId`, `snapshotHash`, `method`, `path` e **os bytes do corpo** com a chave HKDF; o hash do corpo é guardado apenas para comparação/replay. O Studio resolve o public ID somente se a reservation estiver vinculada a run ativo, ambiente esperado e artifact com hash igual ao assinado; reservations expiradas, falhas, não vinculadas ou superadas são rejeitadas. `tracking_proxy_requests` guarda `publication_id`, `request_id`, hash do pedido, resposta e expiração curta; `UNIQUE(publication_id, request_id)` é consumido atomicamente. Replay idêntico retorna a resposta já persistida sem repetir a mutação; mesmo ID com corpo distinto falha; retry legítimo usa novo `requestId`. O cookie opaco só existe no domínio Vercel; o Studio persiste apenas SHA-256 dele.

`PublicationService` cria `publication_build_reservations` antes do build, com PK UUID interno e `public_id` opaco aleatório único, empresa, projeto, estado e expiração. O identificador de instância redundante foi removido: não tinha função distinta de `public_id`. O snapshot recebe esse public ID, portanto a projeção usa `publicationId` sem circularidade com hash. Após o build, o serviço cria/claim o `deployment_run` normal com `snapshot_hash NOT NULL`, vincula reservation e artifact e marca a publicação anterior como superada; não se relaxa a regra de `deployment_runs.snapshot_hash`. Reservations expiradas, falhas, não vinculadas ou superadas são limpáveis e nunca resolvem o endpoint interno. O publisher gera uma única projeção pública canônica por projeto/ambiente, `tracking.public.json`, a partir de `PixelRepository.publicProjection()`. Ela alimenta HTML, função, tracker e loader e contém somente `formatVersion`, `publicationId`, `snapshotHash`, `trackerPublicId`, `policyUrl`, `policyVersion`, `consentExpiryDays`, `pixelsEnabled` e `{ provider, identifier }[]` habilitados. Não contém IDs internos de tenant, URL interna, chave HMAC, cookie, PII, evento de formulário, VSL, lead ou segredo. A projeção e a versão dos assets entram no fingerprint e no hash do snapshot; mudar configuração, política ou asset altera o hash.

## Modelo de dados e configuração

1. `project_integrations` mantém um registro de produção para `meta_pixel`, `ga4`, `tiktok_pixel`, `linkedin_insight` e `taboola_pixel`, contendo somente uma identificação pública validada. URL, snippet, token e chave são rejeitados.
2. `project_tracking_policies` contém `company_id`, `project_id`, `environment`, `privacy_policy_url`, `policy_version`, `consent_expiry_days` e `updated_at`. URL HTTPS e versão não vazia são obrigatórias antes de habilitar pixels. A expiração é fixa em 365 dias nesta fase.
3. `analytics_consents` contém `company_id`, `project_id`, `website_id`, `purpose = 'advertising'`, `consent_token_hash`, `policy_version`, `granted_at`, `revoked_at`, `expires_at` e evidência mínima `{ source: 'banner', publicationId }`. Índice parcial único impede mais de um aceite ativo por `(website_id, purpose, consent_token_hash)`.
4. `tracking_proxy_secrets` registra por projeto `tracking_proxy_key_id` de 128 bits, versão atual/anterior, IDs das env vars Vercel, janela de rotação e nomes dos segredos cifrados no cofre. Não armazena raiz em claro.
5. `tracking_proxy_requests` contém `publication_id`, `request_id`, `request_hash`, `response_status`, `response_body`, `consumed_at` e `expires_at`; o par publicação/request é único e a limpeza apaga registros vencidos em lote.
6. `publication_build_reservations` contém `id` interno, `public_id` opaco único, `company_id`, `project_id`, `environment`, `state`, `expires_at`, `created_at`, `claimed_at`, `failed_at` e `superseded_at`. `publication_tracking_artifacts` vincula reservation e run a manifesto, `tracking.public.json`, `asset_versions`, hash, `safe_at` e status. Rollback só seleciona artefato de produção com `safe_at` preenchido.
7. `grantConsent` roda em transação sob lock de website/purpose/hash; revoga o ativo antes de inserir o novo. `revokeConsent` toma o mesmo lock. Concorrência aceitar/revogar é determinística e concessão repetida válida devolve o mesmo resultado.
8. A versão vem de `project_tracking_policies`, nunca do navegador. URL ou versão nova invalida aceite anterior; reaceite também é exigido após 365 dias.

`GET /api/projects/:projectId/tracking/pixels`, `PUT /api/projects/:projectId/tracking/pixels/:provider` e `GET|PUT /api/projects/:projectId/tracking/policy` exigem `integration.manage`. A interface implementa a seção **“Rastreamento”** do wireframe: política URL/versão e uma linha por provider com interruptor, identificador e estado de publicação. Não exibe token, URL de SDK ou snippet.

## Consentimento e segurança pública

O banner começa fechado. “Aceitar” chama a função do domínio publicado, que valida `Origin` igual à origem HTTPS canônica da publicação, confere a projeção do deployment e persiste o aceite pelo túnel autenticado antes de responder. Emite `Set-Cookie: alva_ad_consent=<32 bytes base64url>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`. “Continuar sem aceitar” não cria cookie, consentimento ou chamada de provider. “Preferências de privacidade” reabre o painel; revogar é `DELETE`, revoga no Studio e expira o cookie no mesmo domínio.

`GET /api/public/consents` devolve somente `{ advertising: 'granted' | 'denied', policyVersion }`. Ausência de cookie, versão antiga, expiração, revogação ou kill switch devolvem `denied`. `POST` e `DELETE` aceitam até 4 KB e **exigem** `Origin` igual à origem HTTPS canônica; ausência ou origem cross-site falha. `GET` pode omitir `Origin` para navegação normal, mas quando presente também precisa ser canônico. Coleta permanece em 64 KB. As respostas usam `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `X-Content-Type-Options: nosniff`.

## Registro de providers e CSP

`pixel-registry.mjs` é a autoridade fechada sobre provider, identificador, evento padrão e allowlist. Cada entrada registra fonte oficial e `verifiedAt: '2026-09-05'`.

| Provider | `script-src` | `connect-src` | `img-src` | Fonte |
| --- | --- | --- | --- | --- |
| Meta | `https://connect.facebook.net` | `https://www.facebook.com` | `https://www.facebook.com` | [Meta Pixel](https://developers.facebook.com/docs/meta-pixel/get-started) |
| GA4 | `https://www.googletagmanager.com` | `https://www.google-analytics.com`, `https://region1.google-analytics.com` | `https://www.google-analytics.com` | [Google tag CSP](https://developers.google.com/tag-platform/security/guides/csp) |
| TikTok | `https://analytics.tiktok.com` | `https://analytics.tiktok.com` | `https://analytics.tiktok.com` | [TikTok Pixel](https://ads.tiktok.com/help/article/tiktok-pixel) |
| LinkedIn | `https://snap.licdn.com` | `https://snap.licdn.com`, `https://px.ads.linkedin.com` | `https://px.ads.linkedin.com` | [LinkedIn Insight Tag](https://business.linkedin.com/advertise/ads/insight-tag) |
| Taboola | `https://cdn.taboola.com` | `https://trc.taboola.com` | `https://trc.taboola.com` | [Taboola Pixel](https://help.taboola.com/hc/en-us/articles/360002100673) |

Não há `https:`, `*`, domínio configurável, GTM genérico, Google Ads, `unsafe-eval` ou `unsafe-inline` adicional. Para GA4 o suporte é deliberadamente restrito a `www.google-analytics.com` e `region1.google-analytics.com`; qualquer endpoint adicional exige revisão do registro, fonte e testes. A base CSP permanece fechada; a policy é a união ordenada das diretivas da tabela apenas para providers habilitados. A função insere nonce novo em scripts first-party e entrega `Content-Security-Policy` no cabeçalho; meta CSP não é a autoridade.

`pixel-loader.js` recebe a projeção apenas da função. Antes de consentimento `granted`, não cria SDK, imagem, beacon, `noscript` ou armazenamento de provider. Após aceite, inicializa cada SDK uma vez e envia só pageview padrão. Não envia evento de formulário, VSL, lead, identificador de formulário, URL de mídia, `tracking_event_id`, IP, user agent, e-mail, telefone ou resposta.

`/v/...` e `/embed/v/...` ficam fora da projeção de pixels: sem loader, provider, CSP ampliada ou script de terceiro. O tracker first-party do coletor continua somente para eventos internos.

## Ambientes, kill switch e rollback

`preview` sempre publica `pixelsEnabled: false`, lista vazia e CSP base, mesmo que produção esteja configurada. Não há aceite publicitário nem SDK de produção em preview. O kill switch global `PIXELS_ENABLED=false`, lido pela função e pelo Studio, força a mesma projeção vazia antes de qualquer resposta ou encaminhamento. Para rollback, a publicação restaura somente manifesto/projeção/assets de `publication_tracking_artifacts` de produção com `safe_at`, sem reconstruir HTML com a configuração atual. Kill switch, rotação de segredo e rollback entram na auditoria de publicação.

## Critérios de aceite

- Configuração, política e consentimentos não cruzam empresa/projeto; mutação autenticada exige `integration.manage`.
- Provisionar, reprovisionar, rotacionar e desconectar o proxy é idempotente; segredo/origem ausentes bloqueiam pixels, consentimento e coleta com segurança.
- O domínio publicado serve assets, consentimento e coleta relativos; a função só encaminha ao Studio com HMAC HKDF válido, deployment ativo, timestamp e request ID aceitos. Replay idêntico não repete efeito, divergente falha e retry com novo ID funciona.
- Sem consentimento válido, nenhuma origem de provider é chamada. Aceitar grava antes de carregar; revogar, expirar ou trocar versão bloqueia a próxima carga.
- CSP por resposta tem nonce novo, base fechada e exatamente as origens literais habilitadas; preview e kill switch usam a base sem provider.
- Uma build reservation gera `public_id` opaco antes do build; após hash, o `deployment_run` normal é criado/claim com `snapshot_hash NOT NULL`. O endpoint resolve o public ID somente para reservation vinculada/ativa com environment e hash esperados; falhas, expirações e superações são limpas/rejeitadas e o artefato seguro persistido é a única fonte de rollback.
- GA4 só autoriza `www.google-analytics.com` e `region1.google-analytics.com`; a suite falha para hosts Google adicionais.
- VSL não contém pixels ou origens de terceiros, mesmo com os cinco providers ativos.
- Testes usam mocks de DOM/fetch/função e jamais chamam Meta, Google, TikTok, LinkedIn ou Taboola.
