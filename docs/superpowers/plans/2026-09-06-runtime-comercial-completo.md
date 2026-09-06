# Alva Studio Commercial Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entregar a V1 comercial do Alva Studio com páginas, quizzes, analytics, tracking, cobrança e agentes por projeto; a VSL própria fica planejada para a V2.

**Architecture:** a V1 usa o Studio como control plane Node/PostgreSQL, Umami 3.3.1 e NVS Core 0.3.10 como sidecars internos com bancos isolados, e Vercel para snapshots publicados. A V2 adicionará R2 e worker FFmpeg para VSL própria.

**Tech Stack V1:** Node.js 22 ESM, PostgreSQL, Umami 3.3.1, PHP, MariaDB 11.4, Docker Compose/Coolify, Vercel, node:test.

**Tech Stack V2:** Cloudflare R2, FFmpeg e HLS para mídia própria.

**Spec:** `docs/superpowers/specs/2026-09-06-runtime-comercial-completo-design.md`

## Global Constraints

- O Studio é a única interface do cliente; painéis e credenciais internos nunca são expostos.
- Cada leitura e escrita carrega empresa, projeto e ambiente derivados da sessão ou publicação.
- Nenhuma etapa é marcada pronta apenas por mock; o serviço real em container faz parte do aceite.
- Subagentes não fazem push, publicação, DNS, cobrança real ou egress com credencial real.
- Toda tela cita e compara a seção correspondente de `docs/wireframes/alva-studio-ui-reference.html`.

**Ordem de entrega V1:** Tasks 6 → 7 → 9 → 10 → 11. A Task 8 e qualquer infraestrutura de mídia própria pertencem à V2 e não bloqueiam a V1.

---

### Task 1: Restabelecer uma linha de base verdadeira

**Files:** `produto/grafo.yaml`, `.estado/tracking_coletor.md`, documentação de execução.

**Interfaces:** produz feature flags `UMAMI_RUNTIME_ENABLED`, `NVS_RUNTIME_ENABLED`, `PIXELS_ENABLED`, `MEDIA_PIPELINE_ENABLED` e `BILLING_ENFORCEMENT`, todas seguras/desligadas por padrão.

- [x] Remover afirmações de conclusão incompatíveis com motores reais e dividir os nós em runtime, provisionamento, integração e homologação.
- [x] Cobrir por teste que nenhuma UI ou API anuncia motor ativo com a flag desligada.
- [x] Registrar o checkpoint de resgate `4c5224a` e o baseline 393/393 na certificação.
- [x] Rodar `pnpm test:studio` e `git diff --check`; submeter o diff a revisão independente e commitar.

### Task 2: Criar o runtime Docker/Coolify

**Files:** Dockerfiles, Compose de desenvolvimento/homologação e runbook de operação.

**Interfaces:** serviços `studio-web`, `studio-worker`, `studio-media-worker`, `studio-postgres`, `umami`, `umami-postgres`, `nvs`, `nvs-mariadb`; endpoints `/health/live` e `/health/ready`.

- [x] Fixar imagens por versão e digest; manter bancos e painéis em rede privada.
- [x] Executar migrações e health checks sem setup manual.
- [x] Criar backup/restore testável e provar que reinício preserva os três bancos.
- [x] Testar a composição real, revisar segredos e commitar.

### Task 3: Incorporar o NVS Core 0.3.10

**Files:** vendor versionado do Core, imagem PHP e extensão Alva externa ao vendor.

**Interfaces:** `/internal/v1/properties`, `/internal/v1/events`, `/internal/v1/status` com HMAC, timestamp e nonce; coleta pública preserva `lib/nvs.js` e `ingest.php`.

- [x] Registrar origem, versão, contrato e hash; aplicar patches de forma reproduzível.
- [x] Isolar toda operação por `property_id` e cifrar segredos por propriedade.
- [x] Manter Meta/TikTok e adicionar destinos Google, LinkedIn e Taboola via outbox idempotente.
- [x] Rodar testes PHP/MariaDB reais, revisão independente e commit.

### Task 4: Provisionar Umami e NVS por projeto

**Files:** nova migração forward-only, repositórios, worker e APIs do projeto.

**Interfaces:** `POST /api/projects/:id/tracking/provision`, `GET /tracking/status`, `POST /tracking/retry`, `PUT /tracking/destinations/:provider`.

- [x] Criar bindings `project + environment + engine` e fila com lease, retry, backoff e dead-letter.
- [x] Criar website Umami e propriedade NVS de forma idempotente; preview e produção não compartilham identidade.
- [x] Bloquear publicação nova sem bindings prontos, preservando snapshots antigos.
- [x] Testar dois tenants, falhas parciais e containers reais; revisar e commitar.

### Task 5: Cortar analytics para o Umami real

**Files:** cliente Umami, adaptador de leitura, runtime publicado e painel Analytics.

**Interfaces:** manter `GET /api/projects/:id/analytics/summary`; adicionar `/journey` e `/events`; o DTO nunca expõe IDs remotos.

- [x] Publicar o script Umami real pelo gateway interno e enviar eventos seguros de formulário/VSL.
- [x] Fazer o painel ler agregados reais do Umami e desativar novas escritas no coletor legado.
- [x] Preservar o histórico legado por 90 dias sem dupla contagem.
- [x] Provar pageview, UTMs, jornada, retenção e isolamento; revisar visualmente e commitar.

### Task 6: Conectar eventos comerciais ao NVS

**Files:** tracking runtime, submissão de formulário, cliente interno NVS e painel de conversões.

**Interfaces:** `tracking_event_id` opaco e persistente; NVS recebe `lead`, `initiate_checkout`, `purchase` e eventos VSL configurados.

- [x] Emitir lead somente após persistência da submissão e reutilizar o ID em retries.
- [x] Normalizar/hash de contato apenas no servidor; proibir PII, IP e user-agent em Analytics e logs.
- [x] Deduplicar por propriedade, evento e destino; mostrar tentativas e erros sanitizados no Studio.
- [x] Testar ingestão/fan-out real NVS, revisão e commit.

### Task 7: Finalizar consentimento, pixels e publicação

**Files:** migração forward-only, PublicationService, Function Vercel, loader/banner e tela Rastreamento.

**Interfaces:** rotas reservadas `/_alva/loader.js`, `/_alva/consent`, `/_alva/event`; manifesto inclui `publicationId`, `snapshotHash`, policy e providers.

- [x] Aceitar consentimento apenas em produção e invalidá-lo por mudança de URL, versão, domínio ou snapshot.
- [x] Assinar chamadas com HMAC/nonce/timestamp e impedir replay; artefato seguro é imutável e não removível.
- [x] Carregar Meta, GA4, TikTok, LinkedIn e Taboola uma vez, somente após opt-in.
- [x] Validar publicação de staging com publisher/Function fake e request capture local, CSP, revogação e dois tenants, sem egress nem credenciais reais. Publicação Vercel real, revisão visual e commit permanecem fora desta validação.
- [x] Parametrizar os cinco adaptadores (Meta, Google, TikTok, LinkedIn e Taboola) em `pending`/`denied`/`granted`: uma chamada por estado, `tracking_event_id` preservado, sem PII/hash nos dois primeiros e egress ausente somente com flag técnica ou provider desligado.

**Fechamento da Etapa 7 (2026-09-06):** aprovada para a validação local/fake sem egress descrita acima. Não houve publicação real em staging, uso de credenciais, DNS ou revisão visual; esses itens permanecem pendentes para a homologação apropriada. A VSL própria permanece fora da certificação V1, e a próxima etapa é a Task 9 — Asaas, usando o port do IZI.

**Política de consentimento:** eventos comerciais e seu `tracking_event_id` são
emitidos em `pending`, `denied` e `granted`. Nos dois primeiros estados, o
payload fica limitado a tempo, conteúdo, valor/moeda e identificadores
pseudônimos de atribuição allowlisted (fbc, fbp, gclid, gbraid, wbraid, ttclid
e equivalentes aprovados). Dados pessoais diretos e hashes ficam proibidos.
Somente o servidor pode normalizar e gerar hashes no estado `granted`; o
navegador não declara consentimento nem envia hashes. O consentimento é
escopado por projeto, domínio, ambiente, snapshot, publicação e policyVersion, e sua
revogação vale apenas para eventos futuros. O gateway resolve o estado somente
do manifesto server-side; eventos são persistidos/deduplicados no Studio, encaminhados ao NVS e enviados
aos adaptadores externos habilitados nos três estados; somente flags técnicas
ou providers desabilitados bloqueiam egress.

## V2 — Mídia própria

A Task 8 fica fora da certificação V1 e será retomada somente após a V1 comercial estar homologada.

### Task 8: Entregar VSL própria com R2 e HLS

**Files:** schema de mídia, cliente R2, media worker, gateway de playback, biblioteca e tela “Configure sua VSL”.

**Interfaces:** upload multipart, biblioteca por projeto, retry; VSL recebe `mediaAssetId`; `/media/v/:publicId/:version/master.m3u8` resolve versão publicada.

- [ ] Upload direto ao R2 com limite técnico de 2 GB por arquivo e 50 GB por empresa.
- [ ] Gerar HLS H.264/AAC 1080/720/480 sem upscale, segmentos de 4 s e poster WebP.
- [ ] Entregar playback assinado, versões imutáveis, limpeza segura e compatibilidade YouTube/Vimeo.
- [ ] Completar controles, progresso realmente assistido, retomada, CTA, embed, analytics e acessibilidade.
- [ ] Homologar Chrome/Safari/celular, páginas/quizzes, screenshots, revisão e commit.

### Task 9: Concluir cobrança Asaas

**Files:** migração forward-only, billing policy/service/worker, gates e tela “Empresa e equipe”.

**Interfaces:** manter `GET /api/billing`, `POST /checkout`, `POST /cancel` e webhook 64 KB; bloqueios retornam `billing_access_required`.

- [ ] Corrigir expiração, cancelamento tardio, tipos de webhook, pedido expirado, auditoria e limites transacionais.
- [ ] Manter plano inicial com 5 projetos, 10 membros e 5 domínios; preço configurável e produção bloqueada enquanto draft.
- [ ] Homologar checkout, webhook, reconciliação e cancelamento no Asaas Sandbox.
- [ ] Revisar segurança/visual, rodar suíte e commitar.

### Task 10: Expor agentes MCP por projeto

**Files:** migração de chaves/runs, servidor MCP, APIs administrativas e tela de conexão.

**Interfaces:** `POST /mcp`, JSON-RPC 2.0; Bearer `alva_…`; ferramentas fechadas para leitura, analytics, leads, validação e rascunhos.

- [ ] Guardar apenas hash, prefixo, escopos, validade, limites e auditoria.
- [ ] Implementar initialize, ping, tools/list e tools/call com idempotência.
- [ ] Impedir publicação, domínio, tracking, equipe e cobrança por qualquer ferramenta.
- [ ] Testar duas chaves/projetos, expiração, revogação e revisão; commitar.

### Task 11: Piloto comercial e certificação

**Files:** runbooks, matriz E2E e certificações `.estado`.

**Interfaces V1:** um projeto de staging percorre criação → provisão → publicação → visita → lead → conversão → cobrança → agente. Mídia/VSL própria é critério da V2.

- [ ] Restaurar backups e testar rollback de publicação.
- [ ] Executar matriz contra containers reais, Vercel de staging e Asaas Sandbox. R2 fica na certificação V2.
- [ ] Verificar todas as telas em 1440×900 e 390×844 por revisor independente.
- [ ] Fazer revisão final ampla, suíte completa, inventário de segredos e commit; produção permanece aguardando aprovação explícita.
