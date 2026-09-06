# Task 7 — runtime público de publicação (2026-09-06)

## Fatia integrada entregue

- `016_publication_runtime.sql` cria manifesto por empresa/projeto/ambiente/publicação, com snapshot, versão, origem, policy, providers, revogação e tabela de nonces consumidos.
- `PublicationRuntimeRepository` grava/consulta/revoga manifestos com escopo composto e reclama nonce uma única vez.
- `publication-runtime.mjs` valida manifesto público somente em produção, normaliza providers permitidos, assina/verifica HMAC com timestamp/nonce e rejeita replay; o segredo nunca aparece no payload.
- Loader acessível gera banner de consentimento, vincula consentimento a `publicationId + snapshotHash`, carrega Meta, GA4, TikTok, LinkedIn e Taboola somente após opt-in e marca a página para carregá-los uma única vez.

## Validação

- `node --test packages/studio/test/publication-runtime.test.mjs` — 4 pass, 0 fail.
- `node --check packages/studio/server/publication-runtime.mjs packages/studio/server/repositories/publication-runtime-repository.mjs` — passou.
- `git diff --check` — limpo.
- Teste PostgreSQL real comprova isolamento por projeto/ambiente, revogação e replay de nonce.

## Pendências reais para fechar Task 7

- Conectar `runtimeManifest` e os artefatos `/_alva/loader.js`, `/_alva/consent` e `/_alva/event` ao `PublicationSnapshotBuilder`/Publisher e às Functions da Vercel, preservando os testes existentes de manifesto/hash.
- Trocar o `ReplayStore` em memória pelo repositório PostgreSQL na fronteira HTTP e aplicar verificação de domínio/origem, versão e snapshot em cada chamada.
- Alimentar a policy publicada a partir de destinos cifrados sem expor tokens e estender a CSP de páginas; integrar o loader ao consentimento e ao outbox da Task 6 sem duplicar `tracking_event_id`.
- Criar tela Rastreamento e testes visuais desktop/mobile; homologar staging com publisher fake e depois com credencial de staging fornecida.

A entrega desta rodada é a base de dados e o núcleo criptográfico/loader testados; não declara a Task 7 completa enquanto as Functions, integração do snapshot e a tela não estiverem conectadas.

## Fix round 1 — fundação de segurança (2026-09-06)

- HMAC agora assina método, rota, publicação, ambiente, timestamp, nonce e SHA-256 UTF-8 do corpo exato, com comparação constante e nonce validado.
- `publication_id` tornou-se globalmente único; replay PostgreSQL permanece isolado por esse identificador global.
- Manifesto inclui `policyVersion`, origem/domínio canônicos e providers como objetos allowlisted com IDs públicos validados; tokens nunca entram no loader.
- A chave de consentimento inclui publicação, snapshot, policy, origem, domínio e ambiente. Loader oferece aceitar, recusar e revogar, e somente carrega providers habilitados após aceite.
- Claim de nonce limpa expirados dentro de transação antes do insert e possui índice de expiração.

## Validação da correção

- `node --test packages/studio/test/publication-runtime.test.mjs` — 4 pass, 0 fail.
- Cobertura inclui adulteração de método/rota/ambiente/corpo, expiração, concorrência PostgreSQL, unicidade entre projetos, seis dimensões de invalidação e ausência de provider não configurado.
- `node --check` dos módulos runtime/repositório e `git diff --check` — limpos.

## Política de conversões integrada (2026-09-06)

- O consentimento comercial resolve `pending`, `denied` ou `granted` no servidor por manifesto completo. O navegador não escolhe o estado no evento e hashes, PII, IP e user-agent dele são descartados ou recusados.
- `publication_runtime_consents` vincula a decisão a sujeito opaco e hash de escopo; mudança de escopo volta a `pending` e revogação só vale para eventos futuros.
- A allowlist cobre Meta (`fbc`, `fbp`), Google (`gclid`, `gbraid`, `wbraid`), TikTok (`ttclid`), LinkedIn (`li_fat_id` para `linkedin_tracking_uuid`) e Taboola (`tblci` para `taboola_click_id`). Pending/denied não têm PII/hash; granted normaliza e hasheia somente no servidor. Google recebe os quatro sinais sem `ads_data_redaction`.
- O serviço de fan-out persiste e encaminha NVS antes dos cinco adaptadores, preservando `tracking_event_id`; flag técnica ou provider desligado são os únicos gates. Os adaptadores são injetados e os testes não fazem egress real.
- Loader e aviso de privacidade usam “identificadores pseudônimos de atribuição” e explicam processamento limitado sem autorização de PII direta.

### Validação desta fatia

- Testes de policy, fan-out, gateway e runtime estão cobertos; a matriz 5×3 exercita todos os adaptadores e os três estados.
- Testes de outbox, schema e flags permanecem verdes.
- `php runtime/nvs/tests/consent-policy.php` — request capture dos cinco adaptadores reais em `pending`, `denied` e `granted`, aprovado; `php -l` de bootstrap e destinos aprovado.
- O bootstrap externo `/_alva/runtime.js?publicationId=…` resolve o manifesto pelo host e publicação no servidor; usa o snapshot e o escopo já persistidos, sem alterar o HTML canônico nem recalcular o hash do snapshot.

## Function Vercel e fronteira HTTP (2026-09-06)

- A publicação de produção acrescenta ao payload da Vercel, sem tocar em `snapshot.files` nem no hash, uma única Function `api/_alva/[...path].js`, seu módulo interno e rewrites para `/_alva/*` e `/api/public/forms/*`.
- A Function preserva corpo e cookie, repassa somente cabeçalhos públicos necessários e assina método, rota, publicação (`run.id`), ambiente, timestamp, nonce e hash SHA-256 do corpo. Ela recebe somente uma chave HMAC derivada por publicação/snapshot/ambiente; o segredo raiz não entra no HTML, nos arquivos gerados ou no browser.
- O Studio recusa acesso direto e verifica a assinatura contra o manifesto ativo, host público, publicação, snapshot e ambiente. O nonce é reclamado pela tabela PostgreSQL antes de loader, consentimento e formulário; replay, host, publicação, ambiente e assinatura inválidos falham.
- A submissão de formulário usa a decisão server-side ligada ao cookie HttpOnly e ao manifesto. IDs de atribuição da allowlist fechada são extraídos de query/cookies e entram na outbox; estado/hash/subject enviados pelo navegador não participam da decisão. A CSP do artefato usa `form-action 'self'` e adiciona somente domínios de providers habilitados.

### Validação da fronteira

- `node --test packages/studio/test/vercel-runtime-gateway.test.mjs packages/studio/test/runtime-gateway-security.test.mjs packages/studio/test/runtime-consent-gateway.test.mjs packages/studio/test/publication-runtime.test.mjs packages/studio/test/publication-service.test.mjs packages/studio/test/nvs-commercial-outbox.test.mjs` — aprovado.
- O E2E HTTP confirma loader e consentimento bloqueados sem gateway; via envelope assinado cria cookie HttpOnly, registra grant e envia formulário até a persistência de lead. Captura da Function confirma preservação de cookie/corpo, assinatura e ausência do segredo raiz.
- Nenhuma chamada externa à API da Vercel ocorreu: o publisher e a Function foram validados com request capture.
- `pnpm --dir packages/studio test` — 472 pass, 0 fail; `php runtime/nvs/tests/consent-policy.php` e os `php -l` aplicáveis — aprovados.

## Correção P1/P2 da revisão independente (2026-09-06)

- A Function lê somente a allowlist de click IDs do `Referer` da landing ao servir `runtime.js`, emite cookie curto HttpOnly/Secure/SameSite assinado pela chave derivada e nunca encaminha URL ou referrer bruto ao Studio. O Studio verifica assinatura e escopo antes de incluir os IDs na outbox.
- Ao confirmar domínio, o manifesto da mesma publicação é regravado com a origin/domínio verificados e o mesmo snapshot/providers/policy. Como origem integra o hash de escopo, qualquer consentimento anterior passa a `pending` no domínio novo.
- Loader inicializa Meta, GA4, TikTok, LinkedIn e Taboola depois de `granted`, uma vez, com IDs públicos e pageview básico sem PII. Pending e denied não carregam SDK.
- O overlay cria CSP para páginas sem policy, usa nonce derivado de escopo no bootstrap, preserva e estende CSP de formulários somente com Studio e SDKs habilitados, e força `form-action 'self'`.
- `publicationId` da query deve coincidir com o envelope assinado. `.env.example` e Compose documentam/passam a raiz HMAC sem valor real; `PIXELS_ENABLED=false` permanece explícito.

### Validação da correção

- Focados de runtime, consentimento, conversão e outbox: 49 pass, 0 fail. `pnpm --dir packages/studio test`: 474 pass, 0 fail.
- `php runtime/nvs/tests/consent-policy.php`: aprovado. `runtime/nvs/tests/integration.php` requer o serviço NVS local e ficou bloqueado com conexão recusada em `127.0.0.1/health/ready`; não houve egress externo.

## Correção CSP e bootstrap de pixels (2026-09-06)

- CSP agora separa hosts de script e coleta por provider: Meta/Facebook, Google Tag/Analytics, TikTok, LinkedIn e Taboola. Landing ganha as diretivas de estilo, fontes, imagem, mídia, frame, conexão, form e base equivalentes ao contrato de formulário; policy preexistente continua ampliada, não substituída.
- Meta, GA4, TikTok, LinkedIn e Taboola preparam suas filas/globais e pageview/configuração antes de anexar o SDK. GA4 recebe o ID na URL do loader; TikTok tem bootstrap sem depender de global pré-existente.

## Default-off no Compose (2026-09-06)

- `PIXELS_ENABLED` agora usa `${PIXELS_ENABLED:-false}` e a raiz HMAC é opcional no Compose enquanto pixels estão desligados. Se pixels forem ativados sem essa chave, a publicação falha antes de qualquer chamada à Vercel.

## Fechamento da revisão de SDK e CSP (2026-09-06)

- O bootstrap TikTok agora prepara `ttq`, `_i`, `_t` e `_o`, enfileira `load(pixelId)` e `page()` antes do SDK e carrega uma única vez `events.js?sdkid=<pixelId>&lib=ttq`. Não depende de `ttq` preexistente e continua condicionado a `granted`.
- Um teste DOM executável parametriza os cinco SDKs: confirma as filas/globais/configuração e pageview antes de cada anexo, os URLs públicos com ID e ausência de carregamento em `pending`. A matriz CSP confirma `script-src` e `connect-src` mínimos distintos para os cinco providers, nega host ausente e preserva iframe/VSL existente, fontes e assets em landing e formulário.
- O contrato default-off passou a ter asserção isolada no Compose, além do teste de `PublicationService` que recusa publicação de pixels sem HMAC.

### Validação final desta correção

- `node --test packages/studio/test/publication-runtime.test.mjs packages/studio/test/vercel-runtime-gateway.test.mjs packages/studio/test/publication-service.test.mjs packages/studio/test/runtime-health.test.mjs` — 29 pass, 0 fail.
- `php runtime/nvs/tests/consent-policy.php` — aprovado; `git diff --check` — limpo.
- `pnpm --dir packages/studio test` — 477 pass, 0 fail.

## Correção da fronteira interna de click IDs (2026-09-06)

- O sanitizador NVS normaliza os identificadores de LinkedIn e Taboola para os nomes canônicos únicos `linkedin_tracking_uuid` e `taboola_click_id`. A fronteira aceita esses nomes vindos do Studio e os aliases browser já aprovados (`li_fat_id` e `tblci`), sem aceitar campos desconhecidos, valores aninhados ou identificadores fora do formato permitido.
- Isso preserva o payload interno já emitido pelo Studio até os adapters sem alterar adapter, destino ou allowlist material; Taboola volta a receber o identificador obrigatório.

### Validação da correção de click IDs

- `php runtime/nvs/tests/consent-policy.php` — aprovado, incluindo canônicos, aliases e recusa de campo desconhecido/aninhado.
- Projeto Docker isolado `alva-task7-debug`: imagem NVS reconstruída e `php /app/tests/integration.php` aprovado. A primeira execução após rebuild encontrou somente payload de outbox persistido de antes da correção; com os volumes descartáveis do projeto recriados, o evento novo percorreu todos os destinos e a integração passou.

## Fechamento da Etapa 7 — aprovada (2026-09-06)

A Etapa 7 está concluída e aprovada no escopo local/fake sem egress. O aceite
abrange consentimento server-side somente em produção e invalidado por escopo,
HMAC com timestamp/nonce e replay PostgreSQL, rotas reservadas e artefato
imutável, CSP por provider, default-off, carregamento único após opt-in e a
matriz 5×3 dos cinco adaptadores com `tracking_event_id` preservado. A
publicação foi validada por publisher/Function fake e request capture local.

Não houve publicação real em staging, credenciais, DNS, egress real ou revisão
visual. A execução que exigia o serviço NVS local ficou bloqueada por conexão
recusada; as provas de policy e a integração Docker descartável registradas
acima foram aprovadas. Esses limites ficam explícitos e não são convertidos em
afirmações de homologação externa.

A VSL própria permanece fora da certificação V1. A próxima etapa é a **Task 9
— Asaas**, usando o port do IZI.
