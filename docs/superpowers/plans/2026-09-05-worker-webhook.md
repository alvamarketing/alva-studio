# Leads e webhook básico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tornar respostas utilizáveis no Studio com lista por projeto, CSV por formulário e entrega webhook HTTPS básica sem perder o lead quando o destino falhar.

**Architecture:** o repositório PostgreSQL permanece a fonte de verdade e oferece uma consulta paginada por projeto. A API autentica leitura e gera CSV no servidor. A entrega webhook ocorre somente após o commit da resposta, registra `delivered` ou `failed` em `tracking_status` e nunca reverte o lead.

**Tech Stack:** JavaScript ESM, PostgreSQL, Node.js 22, `node:test`, HTML/CSS/JS sem framework adicional.

**Spec:** `produto/grafo.yaml`, nó `leads_integracoes`.

## Global Constraints

- A lista, o CSV e o webhook nunca podem misturar empresas ou projetos.
- Vercel continua configurada e publicada por projeto; este plano não altera hospedagem.
- Webhook aceita somente HTTPS sem credenciais, rejeita endereços locais/privados após resolução DNS, usa timeout de 3000 ms e não segue redirecionamentos.
- Testes usam `dnsLookup` e `webhookFetch` controlados; nenhum egress externo real.
- Fila, retry, idempotência de entrega, auditoria completa e defesa contra DNS rebinding pertencem ao nó `worker_webhook`.
- Toda produção segue RED → GREEN → REFACTOR; quem implementa não faz a revisão de aceite.

---

### Task 1: Lista paginada e CSV de leads

**Files:**
- Create: `packages/studio/server/leads-csv.mjs`
- Modify: `packages/studio/server/repositories/content-repository.mjs`
- Modify: `packages/studio/server/project-api.mjs`
- Test: `packages/studio/test/project-api.test.mjs`
- Test: `packages/studio/test/leads-csv.test.mjs`

**Interfaces:**
- Produces: `content.projectSubmissions({ companyId, projectId, actorId, formId, limit, cursor })` → `{ items, nextCursor }`.
- Each item: `{ id, formId, formName, answers, submittedAt, webhookStatus }`.
- Produces: `renderLeadsCsv({ formName, fields, submissions })` → UTF-8 CSV string beginning with BOM.
- Produces: `GET /api/projects/:projectId/leads?formId=&limit=&cursor=` and `GET /api/projects/:projectId/leads.csv?formId=`.

- [ ] **Step 1: Write failing repository/API and serializer tests**

  Cover `submission.read`, company/project isolation, newest-first cursor pagination, optional `formId`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition`, stable headers, quotes/newlines, arrays and spreadsheet-formula prefixes (`=`, `+`, `-`, `@`). CSV without `formId` returns 400 so columns cannot silently mix unrelated forms.

- [ ] **Step 2: Run focused tests and confirm RED**

  Run: `node --test packages/studio/test/leads-csv.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 3: Implement the minimum query, cursor validation, CSV escaping and routes**

  Clamp `limit` to 1–100. Cursor is the opaque pair `submittedAt|id`, encoded with base64url; invalid cursor returns 400. CSV columns are `Recebida em`, `Formulário`, followed by current form field titles in editor order and any historical answer IDs in lexical order. Prefix dangerous spreadsheet values with `'` before RFC-4180 quoting.

- [ ] **Step 4: Run focused tests and confirm GREEN**

  Run: `node --test packages/studio/test/leads-csv.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 5: Commit**

  Commit message: `feat(studio): lista e exporta leads por projeto`

---

### Task 2: Entrega webhook básica pós-persistência

**Files:**
- Modify: `packages/studio/server/outbound-webhook.mjs`
- Modify: `packages/studio/server/repositories/content-repository.mjs`
- Modify: `packages/studio/server/index.mjs`
- Test: `packages/studio/test/project-api.test.mjs`
- Test: `packages/studio/test/server.test.mjs`
- Create: `packages/studio/test/outbound-webhook.test.mjs`

**Interfaces:**
- Produces: `deliverWebhook({ url, event, fetchImpl, dnsLookup, timeoutMs = 3000 })` → `{ status: 'delivered'|'failed' }` without returning remote response bodies.
- Produces: `content.markSubmissionTracking({ companyId, projectId, formId, submissionId, status })` scoped by all four identifiers.
- Payload: `{ eventId, event: 'form.submitted', companyId, projectId, formId, submittedAt, answers }`.

- [ ] **Step 1: Write failing delivery and integration tests**

  Prove successful POST, timeout, remote non-2xx, redirect, localhost/private IPv4/IPv6, DNS resolving to private address, no credential leakage, response persisted before delivery, `tracking_status` updated, and failed delivery still returns the form completion with the saved lead.

- [ ] **Step 2: Run focused tests and confirm RED**

  Run: `node --test packages/studio/test/outbound-webhook.test.mjs packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 3: Implement the minimum safe best-effort delivery**

  Resolve all destination addresses once and reject loopback, private, link-local, multicast and unspecified ranges. Call `fetchImpl` with JSON, `redirect: 'error'`, `AbortSignal.timeout(3000)` or equivalent injected timeout, and no forwarded request headers. Catch all delivery errors after persistence, store `failed`, and expose only `X-Webhook-Delivery: delivered|failed`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

  Run: `node --test packages/studio/test/outbound-webhook.test.mjs packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 5: Commit**

  Commit message: `feat(studio): entrega webhook básico de formulário`

---

### Task 3: Superfície de leads no Studio

**Files:**
- Create: `packages/studio/public/leads-ui.js`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/styles.css`
- Create: `packages/studio/test/leads-ui.test.mjs`
- Modify: `packages/studio/test/studio-dashboard.test.mjs`

**Interfaces:**
- Consumes: `GET /api/projects/:projectId/leads` and `/api/projects/:projectId/leads.csv?formId=` from Task 1.
- Produces: pure helpers in `leads-ui.js` for row normalization, answer display and CSV URL generation.
- Produces: filtro `Leads` no projeto, lista paginada, filtro por formulário e ação `Exportar CSV`.

- [ ] **Step 1: Write failing UI-model and DOM-contract tests**

  Prove empty/loading/error states, escaped answer display, delivery label, form filter, next-page cursor and CSV link bound to the selected project/form. Analyst with `submission.read` can read/export; roles without it do not see the surface.

- [ ] **Step 2: Run focused tests and confirm RED**

  Run: `node --test packages/studio/test/leads-ui.test.mjs packages/studio/test/studio-dashboard.test.mjs`

- [ ] **Step 3: Implement helpers and wire the existing project view**

  Add `Leads` to `#project-content-filter`. When selected, fetch only the active project, render semantic rows and a native download link. Cancel/ignore stale responses when project or company changes. Keep page/form/VSL rendering unchanged.

- [ ] **Step 4: Run focused tests and confirm GREEN**

  Run: `node --test packages/studio/test/leads-ui.test.mjs packages/studio/test/studio-dashboard.test.mjs`

- [ ] **Step 5: Commit**

  Commit message: `feat(studio): adiciona painel de leads`

---

### Task 4: Certificação do nó

**Files:**
- Create: `.estado/leads_integracoes.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/public/MAPA.md`

- [ ] **Step 1: Run the full Studio suite once**

  Run: `node --test packages/studio/test/*.test.mjs`

- [ ] **Step 2: Verify the acceptance contract**

  Confirm: saved lead appears in the project list and CSV; controlled HTTPS receiver gets only the correct project event; failure keeps the lead; no real network or production change occurred.

- [ ] **Step 3: Record status and maps**

  Write `.estado/leads_integracoes.md` with `status: feito`, exact test count and explicit deferred scope for `worker_webhook`.

- [ ] **Step 4: Commit**

  Commit message: `docs: certifica leads e integrações`
