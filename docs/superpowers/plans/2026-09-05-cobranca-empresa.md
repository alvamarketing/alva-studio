# Cobrança empresarial do Alva Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cobrar uma única assinatura mensal por empresa com Checkout Asaas, inbox de webhook e reconciliação durável, e acesso/limites aplicados somente após ativação explícita do enforcement.

**Architecture:** catálogo, ativação e contrato vivem no PostgreSQL por empresa e ambiente; `entitlements` é a projeção de acesso usada pelo roteador somente quando `BILLING_ENFORCEMENT` está válido. O pedido recebe referência externa imutável antes de egress. No primeiro Checkout, o Studio omite customer e `customerData`, deixando o Asaas coletar CPF/CNPJ hospedado; customer e assinatura só são vinculados pela primeira cobrança reconsultada. Cada rota de webhook autentica e persiste uma inbox única, responde 200 e deixa um worker reconciliar pedidos/renovações/órfãos e confirmar pagamento, assinatura e entitlement numa transação.

**Tech Stack:** JavaScript ESM, Node.js 22, PostgreSQL, `pg`, `node:test`, HTML/CSS/JS sem dependência nova e API Asaas somente por adaptador servidor.

**Spec:** `docs/superpowers/specs/2026-09-05-cobranca-empresa-design.md`; `produto/grafo.yaml`, nó `cobranca_empresa`.

## Global Constraints

- Uma assinatura, conta de cobrança, pedido e entitlement pertencem a `company_id`; identificadores do navegador nunca definem esse escopo.
- O primeiro corte vende somente `studio-essential-v1`, mensal, com 5 projetos ativos, 10 membros ativos e 5 domínios publicados. Não implementar créditos, pacotes, add-ons, trial, cupom ou uso variável.
- `price_cents` só sai do catálogo privado do servidor e é convertido a decimal Asaas por string exata, nunca por ponto flutuante. Catálogo draft, preço fictício ou ativação inválida recusam egress antes de criar customer, checkout ou assinatura.
- `RECEIVED` e `CONFIRMED`, depois de reconsulta ao Asaas, são os únicos estados que concedem acesso `active`.
- Sandbox e produção são isolados em todas as tabelas, buscas, clientes, callbacks e credenciais. As únicas rotas públicas são `/api/billing/webhooks/asaas/sandbox` e `/api/billing/webhooks/asaas/production`; ambiente nunca vem do corpo. Testes nunca usam uma credencial real.
- `BILLING_ENFORCEMENT` só aceita `off`, `sandbox` ou `production` e começa desligado: tenants existentes conservam acesso pleno. Quando habilitado e válido para o mesmo ambiente, `read_only` permite leitura autorizada e billing e bloqueia mutações do Studio com 402 `billing_access_required`. Páginas públicas existentes não são afetadas.
- Sandbox tem grace padrão de sete dias; produção só concede grace se `grace_days`, plano, preço, aprovador, data e checklist constarem da ativação privada.
- Segredos, token do webhook, URLs completas de checkout e payloads brutos nunca entram no navegador, fixture, log, auditoria ou resposta HTTP.
- A referência visual é a seção **“Empresa e equipe”** (`#view-settings`) de `docs/wireframes/alva-studio-ui-reference.html`. A interface usa o `design_system` já aprovado; se ele ainda não estiver disponível, a tarefa visual fica bloqueada e não cria tokens ou CSS paralelo.
- Toda produção segue RED → GREEN → REFACTOR. Quem implementa não certifica o nó.

---

### Task 1: Fixar contrato comercial, ativação e schema financeiro

**Files:**
- Create: `packages/studio/server/db/migrations/015_billing_company.sql`
- Create: `packages/studio/test/billing-schema.test.mjs`

**Interfaces:**
- Produces `plans`, `billing_activation`, `billing_accounts`, `payment_orders`, `subscriptions`, `payments`, `billing_webhook_inbox`, `billing_reconciliation_jobs` e `entitlements`.
- Produces o plano `studio-essential-v1` como `draft`, `monthly`, BRL, limites `{ projects: 5, members: 10, publishedDomains: 5 }`; a fixture de teste usa `price_cents = 9900`, valor explicitamente não comercial.
- `payment_orders.external_reference` é exatamente `alva-studio:<environment>:<order_uuid>`, imutável e único no ambiente; `payments.provider_payment_id`, inbox `provider_event_id`, `billing_accounts.provider_customer_id`, `subscriptions.provider_subscription_id` e `payment_orders.provider_checkout_id` são únicos dentro de `environment` quando presentes; `billing_accounts` também é único em `(company_id, environment)`.

- [ ] **Step 1: Escrever testes RED**

  Em `billing-schema.test.mjs`, com `postgresFixture(t)`, provar que as nove tabelas e checks existem; que centavos não positivos, moeda diferente de BRL e intervalos fora de `monthly` falham; que `company_id` de uma assinatura/pedido não pode apontar a plano ou projeto de outra empresa; que os dois ambientes coexistem sem compartilhar conta, pagamento ou inbox; que `UNIQUE (environment, provider_event_id)` funciona; que `external_reference` é único e não pode ser atualizado; que a empresa pode criar outro pedido somente depois do primeiro encerrar, com nova referência; que o índice parcial recusa dois pedidos abertos ou duas assinaturas abertas da mesma empresa e ambiente; que `grace_until` só existe em assinatura `past_due`; e que `migrate()` é repetível.

- [ ] **Step 2: Rodar e confirmar RED**

  Run: `node --test packages/studio/test/billing-schema.test.mjs`

- [ ] **Step 3: Implementar migração aditiva**

  Criar `015_billing_company.sql` usando UUIDs, `timestamptz`, FKs por empresa e `jsonb` para limites congelados. `013_media_providers.sql` e `014_tracking_pixels.sql` estão reservadas; se `015` tiver sido ocupada, usar o próximo prefixo livre e atualizar todas as referências deste plano no mesmo diff. Não alterar migrações já aplicadas.

- [ ] **Step 4: Rodar e confirmar GREEN**

  Run: `node --test packages/studio/test/billing-schema.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): cria contrato de cobrança por empresa`

**Pronto quando:** a migração é checksum-safe, preserva isolamento de empresa, contém somente o plano único em draft e tem inbox/reconciliação duráveis.

---

### Task 2: Política de assinatura e entitlement sem rede

**Files:**
- Create: `packages/studio/server/billing-policy.mjs`
- Create: `packages/studio/test/billing-policy.test.mjs`

**Interfaces:**
- Produces `accessForSubscription(subscription, activation, now)` → `{ accessState: 'active'|'read_only', effectiveUntil }`, incluindo `grace_until`.
- Produces `canMutateWithEntitlement(entitlement, { method, path })` → boolean; permite somente `POST /api/billing/checkout`, `POST /api/billing/cancel` e `POST /api/logout` em `read_only`.
- Produces `isConfirmingPaymentStatus(status)` para `RECEIVED` e `CONFIRMED`, `enforcementIsValid(activation, plan)` e `billingAccessForCompany({ enforcement, entitlement })`.

- [ ] **Step 1: Escrever testes RED**

  Cobrir todos os seis estados de assinatura, incluindo `cancel_at_period_end` antes e depois de `current_period_end`, e `past_due` antes/depois de `grace_until`; provar que somente os dois estados confirmados do pagamento ativam acesso; que enforcement off devolve `active` sem limites para tenant existente; que produção sem plano/preço/aprovador/data/checklist/grace explícito é inválida; e que GET permanece permitido em `read_only`, `PUT /api/projects/x` e `POST /api/projects` são bloqueados e os três caminhos permitidos seguem liberados.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-policy.test.mjs`

- [ ] **Step 3: Implementar funções puras**

  Usar conjuntos fechados de estados; datas inválidas retornam `read_only`; não importar banco, ambiente ou `process.env` neste módulo.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/billing-policy.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): define política de acesso da assinatura`

**Pronto quando:** toda transição de acesso é determinística e testada sem Asaas.

---

### Task 3: Repositório financeiro, inbox e reconciliação por empresa

**Files:**
- Create: `packages/studio/server/repositories/billing-repository.mjs`
- Create: `packages/studio/test/billing-repository.test.mjs`

**Interfaces:**
- Produces `BillingRepository.getOverview({ companyId, environment })` → plano, ativação, assinatura, entitlement e último pedido, sem IDs ou URLs secretos.
- Produces `prepareCheckout({ companyId, userId, environment, now })` → pedido `creating`, existente aberto, ou erro de assinatura/pedido em preparação; grava a referência determinística do UUID do pedido antes de egress.
- Produces `claimCheckout({ orderId })`, `saveCheckout({ orderId, checkout })`, `receiveInboxEvent(input)`, `enqueueReconciliation(input)`, `claimNextBillingJob()`, `recordConfirmedPayment(input)` e `markReviewRequired(input)`; confirmação e deduplicação final são transacionais.

- [ ] **Step 1: Escrever testes RED com PostgreSQL**

  Provar que `getOverview` de empresa A não devolve linhas da empresa B; que dois `prepareCheckout` concorrentes criam um único pedido aberto; que `claimCheckout` aceita uma única transição `creating → submitting`; que pedido `submitting` é reapresentado e ganha job de reconciliação sem criar outro; que após cancelamento/expiração a mesma empresa cria segundo pedido com outra referência; que inbox duplicada retorna o mesmo registro; que primeira confirmação só vincula customer/subscription com referência do pedido coincidente; que renovação com customer/subscription divergentes vira revisão e não cria pagamento; que pagamento repetido retorna `{ duplicate: true }`; que dois pagamentos distintos da mesma assinatura atualizam o período para a maior data; que job órfão não cria pagamento; e que evento sandbox não toca entitlement de produção.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-repository.test.mjs`

- [ ] **Step 3: Implementar consultas com escopo e locks**

  Usar `withTransaction`, `SELECT ... FOR UPDATE` sobre pedido, assinatura e entitlement, mais o índice único de pagamento como defesa final. `receiveInboxEvent` só grava metadados mínimos e gera job, nunca efeito financeiro. `recordConfirmedPayment` compara valor decimal exato/moeda/ambiente e referência ao snapshot congelado antes de inserir pagamento. Na primeira confirmação ele vincula customer/subscription apenas com a referência do pedido coincidente; nas renovações exige os dois vínculos persistidos. Divergência chama `markReviewRequired` e não atualiza pagamento, assinatura, grace ou entitlement. Reutilizar o padrão de lease, `FOR UPDATE SKIP LOCKED` e backoff de `webhook-repository.mjs` para jobs.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/billing-repository.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): persiste pedidos e entitlements por empresa`

**Pronto quando:** concorrência, renovação, inbox, órfãos e isolamento não dependem do handler HTTP.

---

### Task 4: Adaptador Asaas e validação de configuração

**Files:**
- Create: `packages/studio/server/asaas-billing.mjs`
- Create: `packages/studio/test/asaas-billing.test.mjs`

**Interfaces:**
- Produces `createAsaasClient({ environment, apiKey, fetchImpl })` com `createSubscriptionCheckout`, `getPayment`, `findByExternalReference`, `listSubscriptionPayments` e `updateSubscriptionEndDate`.
- Produces `validateCheckoutUrl(url, environment)`; aceita só HTTPS e host oficial do checkout do ambiente.
- Produces `billingRuntimeConfig(env)` → configurações privadas separadas para Sandbox/produção, com base URL, token e site origin; o roteador escolhe ambiente pela rota, nunca pelo payload.

- [ ] **Step 1: Escrever testes RED**

  Injetar `fetchImpl` falso e provar corpo de primeiro checkout mensal sem preço vindo do cliente, `externalReference = alva-studio:<environment>:<order_uuid>`, **sem** campos `customer` ou `customerData`, conversão exata `9900 → "99.00"`, URL Sandbox aceita apenas no Sandbox, URL HTTP/host arbitrário recusada, chave/token ausentes recusados e que mensagens de erro não contêm a chave, token, CPF ou CNPJ de teste. Cobrir checkout de segundo ciclo usando apenas `customer` já reconciliado, sem `customerData`.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/asaas-billing.test.mjs`

- [ ] **Step 3: Implementar cliente mínimo**

  Encapsular URLs/base URL por ambiente, `Authorization` somente no servidor, timeout e JSON limitado. O cancelamento chama update de `endDate`, nunca DELETE. Consultar a documentação oficial do Asaas no momento da implementação para confirmar nomes de campos e eventos; nenhuma chave real é usada nessa consulta ou teste.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/asaas-billing.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): adiciona adaptador Asaas de servidor`

**Pronto quando:** o restante do Studio depende de uma interface pequena, testável, decimalmente exata e sem segredo ou CPF/CNPJ exposto.

---

### Task 5: Serviço de checkout e cancelamento do proprietário

**Files:**
- Create: `packages/studio/server/billing-service.mjs`
- Create: `packages/studio/test/billing-service.test.mjs`

**Interfaces:**
- Produces `BillingService.checkout({ context, environment })` → `{ orderId, provider: 'asaas', checkoutUrl }`.
- Produces `BillingService.cancel({ context })` → `{ status, currentPeriodEnd, cancelAtPeriodEnd: true }`.
- Consumes `BillingRepository`, cliente Asaas e configuração privada; exige `context.role === 'owner'` via a capacidade `billing.manage` antes de qualquer chamada remota.

- [ ] **Step 1: Escrever testes RED**

  Provar que admin/editor/analyst não chamam o cliente; que checkout não recebe preço/plano/empresa/ambiente do browser; que primeiro checkout omite customer/customerData; que draft, preço fictício, enforcement invalidado ou ativação de produção sem aprovador/data/checklist recusam antes de qualquer chamada do cliente; que segundo clique reutiliza pedido pending; que timeout após envio deixa `submitting` e enfileira reconciliação; que URL recusada não é devolvida; que o serviço não vincula customer/subscription da resposta de criação; que segundo ciclo só usa customer já reconciliado; e que cancelamento aceita somente a assinatura da empresa atual, atualiza `endDate` e segunda chamada é idempotente.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-service.test.mjs`

- [ ] **Step 3: Implementar fluxo ordenado**

  Primeiro validar ativação, depois `prepareCheckout`, `claimCheckout`, cliente remoto e `saveCheckout`; enfileirar reconciliação antes da resposta. No primeiro ciclo, montar o payload sem customer/customerData. Não capturar timeout convertendo-o em novo pedido. O cancelamento atualiza fim do período no provedor, persiste `cancel_at_period_end` e retorna estado público. Cobrança futura já gerada vai a revisão, sem cancelamento ou estorno automático.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/billing-service.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): prepara checkout e cancelamento empresarial`

**Pronto quando:** apenas o proprietário da empresa correta consegue iniciar ou cancelar contrato.

---

### Task 6: Inbox autenticada e worker de reconciliação Asaas

**Files:**
- Create: `packages/studio/server/asaas-webhook.mjs`
- Create: `packages/studio/server/billing-reconciliation-worker.mjs`
- Create: `packages/studio/test/asaas-webhook.test.mjs`
- Create: `packages/studio/test/billing-reconciliation-worker.test.mjs`

**Interfaces:**
- Produces `createAsaasWebhookHandler({ repository, webhookToken, environment })` → handler que recebe corpo bruto e devolve 200 após gravar/reconhecer inbox e job.
- Produces `processDueBillingJobs({ repository, asaas, audit, now })` e `startBillingReconciliationWorker(...)`; o worker reconsulta pagamentos, pedidos em `submitting`/`pending`, assinaturas para renovação e eventos órfãos.
- A inbox consome `provider_event_id`, tipo e payment id; a verdade financeira vem de `asaas.getPayment(id)`. `provider_payment_id` permanece a chave do efeito financeiro.

- [ ] **Step 1: Escrever testes RED**

  Provar token ausente/incorreto com 401 sem banco ou cliente Asaas; inbox válida responde 200 sem chamar `getPayment`; mesmo `provider_event_id` duas vezes cria uma inbox/job; primeira cobrança reconsultada com valor/moeda/ambiente divergente ou referência de outro pedido falha sem vínculo ou entitlement; primeira cobrança válida vincula customer/subscription uma vez; `PENDING` não ativa e agenda retry; `RECEIVED` cria pagamento e entitlement; duas jobs concorrentes para o mesmo payment id ativam uma vez; renovação aumenta período somente quando customer/subscription coincidem com o vínculo; divergência em qualquer dos dois vira `review_required` sem efeito financeiro; `submitting` e `pending` são encontrados pela referência daquele pedido; reembolso, chargeback, `SUBSCRIPTION_DELETED` precoce e evento órfão viram `review_required`; e job esgotado vira dead-letter sem apagar inbox.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/asaas-webhook.test.mjs packages/studio/test/billing-reconciliation-worker.test.mjs`

- [ ] **Step 3: Implementar autenticação e reconciliação**

  Comparar token com `timingSafeEqual` após normalizar buffers de mesmo tamanho. Limitar corpo a 64 KB, validar JSON e não persistir o corpo; armazenar hash SHA-256 e metadados normalizados na inbox. O handler nunca reconsulta nem concede acesso. O worker reutiliza lease/backoff/dead-letter; na primeira confirmação, exige a referência exata do pedido antes de gravar customer/subscription; nas renovações, exige os dois vínculos já gravados. Só então chama `recordConfirmedPayment`.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/asaas-webhook.test.mjs packages/studio/test/billing-reconciliation-worker.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): reconcilia cobrança Asaas por inbox idempotente`

**Pronto quando:** webhook retorna rápido, queda entre egress e resposta é recuperável e duplicidade/ordem de entrega não liberam acesso duas vezes.

---

### Task 7: Conectar rotas de billing e a fronteira pública

**Files:**
- Modify: `packages/studio/server/index.mjs`
- Modify: `packages/studio/server/project-api.mjs`
- Create: `packages/studio/test/billing-http.test.mjs`

**Interfaces:**
- Adds `GET /api/billing`, `POST /api/billing/checkout` e `POST /api/billing/cancel` ao `createProjectApi` autenticado.
- Adds `POST /api/billing/webhooks/asaas/sandbox` e `POST /api/billing/webhooks/asaas/production` antes do encaminhamento autenticado em `index.mjs`; cada rota escolhe seu ambiente/segredo/base URL privados e não abre outros `/api/*`.

- [ ] **Step 1: Escrever testes RED**

  Exercitar app HTTP com banco/cliente injetados: sem sessão recebe 401 nos três endpoints autenticados; admin recebe 403 para checkout/cancelamento; proprietário de A não enxerga billing de B; origem cruzada não acessa checkout; cada webhook com seu token correto alcança somente o handler de sua rota sem cookie; token Sandbox na rota produção falha; e GET ou outro caminho sob `/api/billing/webhooks/asaas/` não é tratado como público.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-http.test.mjs`

- [ ] **Step 3: Implementar o roteamento mínimo**

  Instanciar repositório, serviço, inbox e worker apenas no modo PostgreSQL. Mover a exceção de origem para os dois predicados exatos de webhook e POST; manter `X-Frame-Options` e `Referrer-Policy` da resposta global. O processo pode iniciar com enforcement desligado e sem egress válido; a configuração só é exigida quando endpoint de checkout ou worker precisa chamar Asaas.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/billing-http.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): expõe rotas seguras de cobrança`

**Pronto quando:** as duas rotas webhook são as únicas superfícies sem sessão e a API financeira não vaza entre empresas ou ambientes.

---

### Task 8: Aplicar entitlements no servidor e nos limites de criação

**Files:**
- Modify: `packages/studio/server/project-api.mjs`
- Modify: `packages/studio/server/repositories/company-repository.mjs`
- Modify: `packages/studio/server/repositories/project-repository.mjs`
- Modify: `packages/studio/server/repositories/publication-repository.mjs`
- Create: `packages/studio/test/billing-access.test.mjs`

**Interfaces:**
- `BillingRepository.entitlementFor({ companyId, environment })` é consultado após a sessão e antes de mutações não financeiras somente com enforcement válido.
- `CompanyRepository.invite`/ativação de membership, `ProjectRepository.create` e criação de domínio consomem limites `{ members, projects, publishedDomains }` dentro de suas transações; domínio conta somente quando é `production` e `verified`.

- [ ] **Step 1: Escrever testes RED**

  Provar que enforcement off mantém empresa sem assinatura em acesso pleno; que enforcement on com empresa `read_only` ainda lê páginas, formulários, membros e billing, mas recebe 402 para criar/editar/apagar página, formulário, VSL, projeto, membro, integração ou publicação; provar que os três endpoints de billing continuam disponíveis. Cobrir sexto projeto, décimo primeiro membro e sexto domínio `production + verified` com 409; domínio preview ou pendente não consome o limite; testar duas criações concorrentes no limite e verificar que apenas uma vence.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-access.test.mjs`

- [ ] **Step 3: Implementar barreira e contadores transacionais**

  Colocar a guarda única em `project-api.mjs` imediatamente após `sessionService.require`, antes de despachar rotas mutáveis. Nos três repositórios, bloquear a linha de entitlement (`FOR UPDATE`) e contar somente registros ativos no mesmo `company_id`; nunca confiar em contador da interface.

- [ ] **Step 4: Rodar GREEN**

  Run: `node --test packages/studio/test/billing-access.test.mjs`

- [ ] **Step 5: Commit**

  `feat(studio): aplica acesso e limites da assinatura`

**Pronto quando:** o plano é uma defesa do servidor, não uma indicação visual.

---

### Task 9: Experiência de Configurações e retorno do checkout

**Files:**
- Modify: `packages/studio/public/owner.js`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/studio-shell.js`
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/styles.css` ou a folha canônica do `design_system`
- Create: `packages/studio/test/billing-ui.test.mjs`

**Interfaces:**
- Adds a aba `Plano e cobrança` em Configurações, carregada por `GET /api/billing`.
- Adds `billing` ao estado de sessão/shell para que ações de escrita existentes sejam desabilitadas somente quando enforcement válido retorna `accessState === 'read_only'`; enforcement off preserva a experiência atual. O servidor continua autoritativo.
- Proprietário chama checkout/cancelamento; os demais só leem estado e limites.

- [ ] **Step 1: Escrever testes RED**

  Provar renderização de nome do plano, estado, fim de período, grace quando aplicável e três barras de uso; que Proprietário vê CTA de checkout/cancelamento e outro papel não; que botão fica ocupado durante requisição e não faz segundo POST; que retorno `?billing=return` diz “aguardando confirmação” e relê estado sem prometer acesso; que enforcement off não desabilita ações atuais; e que `read_only` sob enforcement válido remove ou desabilita ações de escrita já visíveis.

- [ ] **Step 2: Rodar RED**

  Run: `node --test packages/studio/test/billing-ui.test.mjs`

- [ ] **Step 3: Implementar sem CSS paralelo**

  Usar a seção **“Empresa e equipe”** do wireframe: cartão `plan-hero`, barras `usage` e abas `settings-nav` do `design_system`. Exibir preço somente vindo da resposta do catálogo; se plano/ativação estão inválidos, informar que a contratação ainda não está disponível e não chamar checkout. Redirecionar exclusivamente para a URL já validada pelo servidor; após retorno, fazer polling curto e botão “Atualizar status”.

- [ ] **Step 4: Rodar GREEN e verificar visualmente**

  Run: `node --test packages/studio/test/billing-ui.test.mjs`

  Abrir Configurações lado a lado com `#view-settings` em desktop e 375 px; salvar as duas capturas em `.estado/screenshots/` para a certificação. Não substituir tokens, cores, raios ou sombras.

- [ ] **Step 5: Commit**

  `feat(studio): mostra plano e cobrança nas configurações`

**Pronto quando:** a tela não afirma pagamento pelo retorno do navegador e segue o contrato visual existente.

---

### Task 10: Auditoria, documentação e certificação Sandbox

**Files:**
- Modify: `packages/studio/README.md`
- Modify: `packages/studio/MAPA.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/test/database-schema.test.mjs`
- Create: `.estado/cobranca_empresa.md`

**Interfaces:**
- Documenta as variáveis privadas, as duas rotas de webhook, o fluxo de reversão para enforcement off/read-only, grace, reconciliação e o fato de que produção exige plano, preço, autor, data e checklist aprovados.
- Certificação contém a frase exigida pelo grafo: `Prova: cobrança sandbox confirmada, webhook idempotente, N testes verdes`.

- [ ] **Step 1: Rodar a matriz final**

  Run: `node --test packages/studio/test/billing-*.test.mjs packages/studio/test/database-schema.test.mjs packages/studio/test/access.test.mjs packages/studio/test/studio-shell.test.mjs`

  Em seguida: `node --test packages/studio/test/*.test.mjs`

- [ ] **Step 2: Homologar somente Sandbox**

  Com autorização específica e credenciais Sandbox, configurar somente `/api/billing/webhooks/asaas/sandbox`, ativar um catálogo Sandbox válido, concluir uma assinatura Sandbox controlada, entregar o mesmo `provider_event_id` duas vezes, simular timeout após egress e conferir recuperação por job, pedido, customer reconciliado, pagamento, assinatura, grace e entitlement Sandbox. Não usar chave, URL, cliente ou webhook de produção.

- [ ] **Step 3: Revisão independente de aceite**

  Confirmar que preço, ambiente e identificação de empresa não vieram do browser; que CPF/CNPJ só aparece no Checkout Asaas; que nenhum segredo/payload bruto aparece em logs ou resposta; que inbox deduplica evento e pagamento continua a única chave financeira; que timeout é recuperado por reconciliação; que enforcement off mantém tenants atuais plenos; que rotas públicas existentes continuam acessíveis; que screenshots referenciam **“Empresa e equipe”**; e que nenhuma migração aplicada foi editada.

- [ ] **Step 4: Atualizar MAPAs e certificação**

  Registrar os módulos e testes novos nos MAPAs existentes e escrever `.estado/cobranca_empresa.md` somente depois da homologação Sandbox e da revisão. Executar `vibe conferir cobranca_empresa --antes` antes da prova e `vibe conferir cobranca_empresa` depois.

- [ ] **Step 5: Commit**

  `docs(studio): certifica cobrança empresarial sandbox`

**Pronto quando:** o gate do grafo passa com evidência Sandbox e não houve ativação de produção.

## Cobertura da especificação

- Oferta única, ativação, limites e preço não aprovado: Tasks 1, 2, 3 e 9.
- Estados de assinatura, grace e enforcement: Tasks 2, 3 e 8.
- Checkout/cancelamento seguro, primeiro checkout sem customer/customerData, vínculo reconsultado e idempotência: Tasks 3, 4, 5 e 7.
- Inbox autenticada, reconsulta, reconciliação e pagamento idempotente: Task 6.
- Isolamento de tenant, ambientes e segredos: Tasks 1, 3, 4, 6 e 7.
- UX em Configurações e fidelidade visual: Task 9.
- Testes, Sandbox e certificação: todas as tasks, especialmente Task 10.
