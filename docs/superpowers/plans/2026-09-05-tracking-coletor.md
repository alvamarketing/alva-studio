# Coletor de tracking interno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar a cada projeto visitas, origem, UTMs, conversão por conteúdo e os marcos 25/50/75/100 da VSL, num coletor interno ao Studio, sem cookie, sem PII e sem sair para nenhum serviço externo.

**Architecture:** o coletor é compatível com o modelo do Umami (`website`/`session`/`event`/`event_data`) mas implementado no servidor Node puro que já existe, sobre o mesmo Postgres e o mesmo migrador com checksum. Um `tracker.js` servido de `'self'` posta em `POST /api/public/collect`; o endpoint resolve `tracker_public_id` para empresa e projeto **no servidor** e nunca aceita escopo vindo do navegador, como `getPublicVideo()` já faz. Os eventos da VSL e do formulário já são calculados hoje e descartados: `public/vsl-player.js:26` emite por `onEvent`, que tem no-op como padrão, e o runner de `server/dynamic-form.mjs:124` já sabe a etapa atual. A CSP com nonce das páginas `/f/...` entra **nesta fase**, antes do tracker, porque hoje essas páginas não emitem CSP nenhuma.

**Tech Stack:** JavaScript ESM, Node.js 22, PostgreSQL, `node:test`, HTML/CSS/JS sem framework adicional.

**Spec:** `docs/superpowers/specs/2026-09-05-tracking-analytics-design.md`, seções B e D; `produto/grafo.yaml`, nó `tracking_coletor`.

## Global Constraints

- Nenhum evento, sessão ou agregado pode cruzar empresa ou projeto. Toda leitura passa por `authorizedProject()`, como em `content-repository.mjs:191`.
- Zero PII: nome, e-mail, telefone, arquivos e respostas abertas nunca entram em `analytics_*`, em URL, em UTM ou em log. Só identificador e tipo de elemento.
- Sem cookie de identificação. `visitor_hash` = SHA-256 de sal do dia + `website_id` + IP + user agent; o sal gira a cada 24 h e o IP nunca é gravado.
- Nada sai do Studio nesta fase. Pixels de terceiro pertencem a `tracking_pixels`; envio server-side pertence a `tracking_conversoes`.
- A página da VSL continua sem qualquer script de terceiro; só o tracker de primeira parte.
- Retenção: eventos e `event_data` 90 dias; agregados diários 25 meses.
- Toda produção segue RED → GREEN → REFACTOR. Quem implementa não faz a revisão de aceite.
- Suites com `postgresFixture(t)` exigem Docker; as puras não. O padrão é `const { connectionString } = await postgresFixture(t); const database = createDatabase({ connectionString }); t.after(() => database.close()); await migrate(database);` dentro de cada `test(...)`, com `seed`/`row` locais ao arquivo.

---

### Task 1: Migração 011 e capacidade `analytics.read`

**Files:**
- Create: `packages/studio/server/db/migrations/011_analytics_collector.sql`
- Modify: `packages/studio/server/domain/access.mjs`
- Modify: `packages/studio/public/studio-shell.js`
- Test: `packages/studio/test/database-schema.test.mjs`
- Test: `packages/studio/test/access.test.mjs`
- Test: `packages/studio/test/studio-shell.test.mjs`

**Interfaces:**
- Produces: `analytics_websites`, `analytics_sessions`, `analytics_events`, `analytics_event_data`, `analytics_daily_rollup`.
- Todas com `company_id` e `project_id` e `FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)`, no padrão de `pages`, `forms` e `videos`.
- `analytics_websites`: `tracker_public_id` único global, `UNIQUE (company_id, project_id, environment)`.
- `analytics_events`: `event_type` em (`pageview`,`custom`), `event_name`, `url_path`, `url_query`, `tracking_event_id`, índice `(company_id, project_id, event_at DESC)`.
- Produces: `analytics.read` em `owner`, `admin`, `editor` e `analyst`.

- [ ] **Step 1: Escrever os testes que falham**

  Em `database-schema.test.mjs`, provar que as cinco tabelas existem, que a FK composta recusa `(company_id, project_id)` inconsistente, que `tracker_public_id` é único e que `event_type` recusa valor fora do CHECK. Em `access.test.mjs`, provar que `hasCapability('owner','analytics.read')` e `hasCapability('admin','analytics.read')` são verdadeiros e que nenhum papel perdeu capacidade existente. Em `studio-shell.test.mjs`, provar que o espelho de capacidades do cliente (`public/studio-shell.js:27`) casa com o servidor para os quatro papéis.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/database-schema.test.mjs packages/studio/test/access.test.mjs packages/studio/test/studio-shell.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Escrever a migração 011 sem tocar em nenhuma migração já aplicada. Acrescentar `analytics.read` às listas de `owner`, `admin` e `editor` em `ROLE_CAPABILITIES` e espelhar em `studio-shell.js`.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/database-schema.test.mjs packages/studio/test/access.test.mjs packages/studio/test/studio-shell.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): schema do coletor de analytics e capacidade de leitura`

**Pronto quando:** as três suites passam e `migrate()` roda duas vezes seguidas sem erro de checksum.

---

### Task 2: Repositório de analytics com isolamento e retenção

**Files:**
- Create: `packages/studio/server/repositories/analytics-repository.mjs`
- Create: `packages/studio/test/analytics-repository.test.mjs`

**Interfaces:**
- Produces: `resolveWebsite({ trackerPublicId })` → `{ websiteId, companyId, projectId }` ou `null`; nunca aceita escopo do chamador.
- Produces: `ingest({ websiteId, companyId, projectId, visitorHash, event })` → grava sessão (nova a cada 30 min de inatividade) e evento na mesma transação.
- Produces: `visitorHash({ websiteId, address, userAgent, at })` — sal do dia derivado internamente, IP nunca persistido.
- Produces: `summary({ companyId, projectId, actorId, from, to })` com `authorizedProject(..., capability: 'analytics.read')`.
- Produces: `purgeExpired({ eventDays = 90, rollupMonths = 25, limit })` → `{ removidos }`, em lotes.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: `resolveWebsite` devolve `null` para id inexistente e nunca vaza outra empresa; `summary` de uma empresa não enxerga evento de outra nem de outro projeto da mesma empresa; `summary` sem `analytics.read` responde 403 e projeto inexistente responde 404; dois eventos do mesmo visitante com 10 min de intervalo caem na mesma sessão e com 31 min abrem outra; o mesmo IP e user agent geram `visitorHash` diferente em dias diferentes; `purgeExpired` apaga evento de 91 dias e preserva agregado de 24 meses.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-repository.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Consultas sempre com `company_id` e `project_id` no `WHERE`. `ingest` numa transação por evento. `purgeExpired` com `DELETE ... WHERE ctid IN (SELECT ctid ... LIMIT $1)` para não travar a tabela.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-repository.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): repositório de analytics isolado por projeto`

**Pronto quando:** a suite passa e nenhuma consulta do arquivo aparece sem `company_id` no `WHERE`.

---

### Task 3: Validação de payload e limitador de taxa do coletor

**Files:**
- Create: `packages/studio/server/analytics-collect.mjs`
- Create: `packages/studio/test/analytics-collect.test.mjs`

**Interfaces:**
- Produces: `parseCollectPayload(raw, contentType)` → `{ trackerPublicId, event }` ou erro 400/413/415. Aceita `application/json` **e** `text/plain` (é o que `navigator.sendBeacon` envia). Teto de 64 KB.
- Produces: `createCollectLimiter({ now, maxPerMinute, maxTrackers })` → `{ allow(trackerPublicId) }`, independente do limitador de login de `auth.mjs:77`.
- Rejeita qualquer chave desconhecida no evento; `event_name` na lista fechada `pageview`, `form_start`, `form_step`, `form_submit_attempt`, `vsl_start`, `vsl_progress`, `vsl_complete`, `vsl_cta_click`, `vsl_error`.

- [ ] **Step 1: Escrever os testes que falham**

  Sem banco, no padrão de `webhook-worker.test.mjs` (dependências injetadas). Provar: `text/plain` aceito, `multipart/form-data` recusado com 415, 64 KB + 1 byte recusado com 413, `companyId`/`projectId`/`email` no corpo recusados com 400, `event_name` fora da lista recusado, e que o limitador libera até o teto, bloqueia acima, expira na janela seguinte e não cresce sem limite com muitos trackers distintos.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-collect.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Allowlist de chaves, não denylist. O limitador é um balde por `tracker_public_id` com teto de entradas e descarte do mais antigo — nunca um `Map` sem limite.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-collect.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): valida e limita o payload público do coletor`

**Pronto quando:** a suite passa sem Docker e nenhum campo fora da allowlist sobrevive ao parser.

---

### Task 4: Construtor de CSP com nonce

**Files:**
- Create: `packages/studio/server/content-security-policy.mjs`
- Create: `packages/studio/test/analytics-csp.test.mjs`

**Interfaces:**
- Produces: `formContentSecurityPolicy({ nonce, studioOrigin, actionOrigin, frameOrigins = [], pixelDomains = [], reportOnly })` → string.
- Base fechada: `default-src 'none'`; `script-src 'self' 'nonce-<valor>'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`; `img-src 'self' data: https:`; `media-src https:`; `connect-src 'self'` mais a origem do Studio; `frame-src` só com as origens de embed já resolvidas; `form-action` com a origem da ação; `frame-ancestors 'self'`; `base-uri 'none'`.
- Produces: `createNonce()` → 16 bytes aleatórios em base64.
- `pixelDomains` fica vazio nesta fase; o parâmetro existe para `tracking_pixels` não reabrir o módulo.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: nunca emite `'unsafe-inline'` em `script-src`; nonce diferente a cada chamada; `pixelDomains` vazio não deixa vírgula, espaço duplo nem diretiva órfã; domínio de pixel só aparece quando passado; modo `reportOnly` muda apenas o nome do cabeçalho, não a política.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-csp.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-csp.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): monta CSP com nonce para páginas públicas`

**Pronto quando:** a suite passa sem Docker.

---

### Task 5: Tracker leve sem PII

**Files:**
- Create: `packages/studio/public/tracker.js`
- Create: `packages/studio/test/analytics-tracker.test.mjs`

**Interfaces:**
- Produces: `createTracker({ trackerPublicId, endpoint, send, location, navigator })` → `{ pageview(), track(name, data) }`, com dependências injetáveis para teste.
- Envia por `navigator.sendBeacon` e cai para `fetch(..., { keepalive: true })`.
- Captura só: caminho, query já filtrada pelas cinco UTMs, domínio de referência, idioma, tela e os click IDs. **Nunca** lê `input`, `textarea`, `select`, `localStorage` de outro escopo nem valor de formulário.
- Boot automático a partir de `<script src="/tracker.js" data-alva-tracker="<id>">`.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: query com `?email=x@y.com&utm_source=meta` envia só `utm_source`; nenhum valor de campo do formulário aparece no corpo; usa `sendBeacon` quando existe e `fetch` keepalive quando não; falha de rede não lança para a página; sem `data-alva-tracker` o boot não faz requisição nenhuma.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-tracker.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Allowlist de parâmetros de URL, não denylist. Nenhum acesso ao DOM de formulário.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-tracker.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): tracker público de primeira parte sem PII`

**Pronto quando:** a suite passa sem Docker e um grep por `value`, `elements` e `FormData` no arquivo não encontra nada.

---

### Task 6: Nonce e eventos no formulário público

**Files:**
- Modify: `packages/studio/server/dynamic-form.mjs`
- Test: `packages/studio/test/dynamic-form.test.mjs`

**Interfaces:**
- `renderDynamicForm(form, actionUrl, { vslEmbedUrls, nonce, trackerPublicId })` — os dois novos são opcionais; sem eles o HTML sai como hoje.
- O `<script>` do runner recebe `nonce="<valor>"`; o tracker entra como `<script src="/tracker.js" data-alva-tracker="..." nonce="...">`.
- O runner emite `form_start` na primeira `showStep`, `form_step` com o índice a cada avanço e `form_submit_attempt` no início do `submit`. Só índice e id de tela — nunca resposta.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: `nonce` aparece no `<script>` do runner e no do tracker; sem `nonce` o HTML atual é preservado byte a byte; o runner referencia `form_start`, `form_step` e `form_submit_attempt`; nenhum trecho do runner lê `field.value` para o tracker; `renderCompletion` também aceita nonce.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/dynamic-form.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Ganchos no `const runner` de `dynamic-form.mjs:124`: dentro de `showStep`, logo após `progress.setAttribute('aria-valuenow', ...)`; e no callback de `submit`, logo após `event.preventDefault()`. O envio de evento é best-effort e envolvido em `try`.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/dynamic-form.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): instrumenta o formulário público e aceita nonce`

**Pronto quando:** a suite passa e o HTML sem `nonce`/`trackerPublicId` continua idêntico ao de hoje.

---

### Task 7: Eventos reais da VSL

**Files:**
- Modify: `packages/studio/public/vsl-player.js`
- Modify: `packages/studio/server/vsl-public.mjs`
- Test: `packages/studio/test/vsl-runtime.test.mjs`
- Test: `packages/studio/test/vsl-public.test.mjs`

**Interfaces:**
- `mountVslPlayer(container, config)` passa um `onEvent` real ao controlador, mapeando `start`/`milestone`/`complete`/`cta_click`/`error` para `vsl_start`/`vsl_progress`/`vsl_complete`/`vsl_cta_click`/`vsl_error`.
- `publicConfig(video)` em `vsl-public.mjs:43` passa a usar os marcos configurados e versionados da VSL, não o literal `[25, 50, 75, 100]`.
- A CSP da página da VSL ganha a origem do Studio em `connect-src`; `script-src` continua `'self'` e nenhum script de terceiro entra.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: uma VSL com marcos `[50, 90]` publica `[50, 90]` no `data-vsl-config`; cada marco dispara uma única vez; `vsl_cta_click` sai no clique; a CSP do embed inclui a origem do Studio em `connect-src` e continua sem `script-src` de terceiro; a URL da mídia não aparece em nenhum evento.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-runtime.test.mjs packages/studio/test/vsl-public.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-runtime.test.mjs packages/studio/test/vsl-public.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): liga os eventos da VSL ao coletor`

**Pronto quando:** as duas suites passam e o marco configurado chega ao player.

---

### Task 8: Fronteira pública do coletor em `index.mjs`

**Files:**
- Modify: `packages/studio/server/index.mjs`
- Test: `packages/studio/test/server.test.mjs`
- Test: `packages/studio/test/project-api.test.mjs`

**Interfaces:**
- Produces: `POST /api/public/collect` e `OPTIONS /api/public/collect`.
- Um predicado `publicCollect` isenta a rota da checagem de origem e de `Sec-Fetch-Site`, no mesmo lugar e no mesmo estilo de `publicProjectSubmission` (`index.mjs:219-232`).
- CORS pela mesma fonte das submissões: `content.publicationOrigins()` (`content-repository.mjs:800`); `OPTIONS` responde 204.
- `/tracker.js` entra no mapa `files`, ao lado de `/vsl-player.js`.
- As quatro respostas HTML públicas (`index.mjs:296`, `:304`, `:325`, `:334`) passam a emitir `Content-Security-Policy-Report-Only` com nonce por resposta.
- Laço de retenção chamando `purgeExpired`, no padrão de `startWebhookWorker`, com `unref()` e parada no `close` do servidor.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: `POST /api/public/collect` de origem publicada responde 204; de origem não publicada responde 403; `OPTIONS` responde 204 com `Access-Control-Allow-Origin`; `tracker_public_id` inexistente responde 404 sem revelar se o projeto existe; corpo de 65 KB responde 413; `Sec-Fetch-Site: cross-site` não bloqueia a rota; `GET /tracker.js` responde 200 com `text/javascript`; a resposta de `/f/...` traz CSP com `nonce-` e sem `'unsafe-inline'` em `script-src`; fechar o servidor para o laço de retenção.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  O escopo vem sempre de `resolveWebsite()`, nunca do corpo. Nenhuma resposta do coletor devolve conteúdo — só status.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): expõe o coletor público e a CSP das páginas de formulário`

**Pronto quando:** as duas suites passam e nenhuma rota autenticada mudou de comportamento.

---

### Task 9: Resumo autenticado por projeto

**Files:**
- Modify: `packages/studio/server/project-api.mjs`
- Modify: `packages/studio/server/repositories/analytics-repository.mjs`
- Create: `packages/studio/test/analytics-api.test.mjs`

**Interfaces:**
- Produces: `GET /api/projects/:projectId/analytics/summary?from=&to=` exigindo `analytics.read`.
- Devolve visitas, visitantes, origens, cinco UTMs, top rotas, conversões por conteúdo e funil da VSL por marco. Nunca devolve linha de evento crua nem `visitor_hash`.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: 401 sem sessão; 403 para papel sem `analytics.read`; 404 para projeto de outra empresa; intervalo inválido responde 400; a resposta não contém `visitor_hash` nem nenhum campo de resposta de formulário; o resumo de um projeto ignora eventos de outro projeto da mesma empresa.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-api.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Rota no mesmo estilo dos matchers existentes de `project-api.mjs`, com `sessionService.authorize(context, 'analytics.read', projectId)`.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-api.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): resumo de analytics autenticado por projeto`

**Pronto quando:** a suite passa e nenhum campo do resumo permite reidentificar um visitante.

---

### Task 10: Painel "Visitas nos últimos 7 dias"

Implementa a seção **"Visitas nos últimos 7 dias"** de `docs/wireframes/alva-studio-ui-reference.html` (dentro de `<section class="view" id="view-project">`, coluna esquerda do grid `.project-columns`, logo abaixo do cartão "Conteúdos do projeto"). Consome a Task 9. Reproduza a seção como ela está — não reinterprete o layout.

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/studio-dashboard.js`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/styles.css`
- Create: `packages/studio/test/analytics-panel.test.mjs`
- Test: `packages/studio/test/studio-dashboard.test.mjs`

**O que a seção contém, literalmente**

Marcação do wireframe, um único cartão com três blocos empilhados:

```html
<section class="surface analytics-card">
  <div class="surface-head">
    <div><h2>Visitas nos últimos 7 dias</h2>
      <span style="font-size:8px;color:var(--muted)">Umami · atualizado agora</span></div>
    <button class="button ghost">Abrir Analytics</button>
  </div>
  <div class="chart">
    <i style="height:38%"></i><i style="height:52%"></i><i style="height:45%"></i>
    <i style="height:72%"></i><i style="height:63%"></i><i style="height:89%"></i><i style="height:78%"></i>
  </div>
  <div class="journey">
    <span>Meta Ads</span><span class="material-symbols-outlined">arrow_forward</span>
    <span>/imobiliarias</span><span class="material-symbols-outlined">arrow_forward</span>
    <span>/diagnostico</span><span class="material-symbols-outlined">arrow_forward</span>
    <span>Lead</span>
  </div>
</section>
```

- **Textos visíveis, nesta ordem:** "Visitas nos últimos 7 dias"; "Umami · atualizado agora"; "Abrir Analytics"; as sete barras **sem rótulo, sem número e sem eixo**; e o funil "Meta Ads" → "/imobiliarias" → "/diagnostico" → "Lead", separado por três ícones `arrow_forward`.
- **Gráfico:** barras verticais em `div`/`i` com `height` inline em porcentagem. **Não é SVG, não é linha, não é sparkline.** Sete barras, uma por dia. Sem eixo X, sem eixo Y, sem linha de grade, sem valor numérico. As alturas de exemplo do wireframe são `38% 52% 45% 72% 63% 89% 78%`.
- **Funil:** quatro pills de largura igual (`flex:1`) intercalados por três setas de largura zero (`flex:0`).

Regras CSS do wireframe a reproduzir (traduzindo para os tokens do Studio, ver abaixo):

```css
.surface{padding:20px;border:1px solid var(--line);border-radius:15px;background:#fff}
.analytics-card{margin-top:15px}
.surface-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}
.surface-head h2{font-size:14px;margin:0}
.chart{height:145px;display:flex;align-items:end;gap:8px;padding-top:22px}
.chart i{flex:1;border-radius:5px 5px 2px 2px;background:linear-gradient(#286eea,#94b8ff);min-height:12px}
.journey{display:flex;align-items:center;gap:7px;margin-top:14px}
.journey span{flex:1;padding:9px;border-radius:9px;background:var(--cloud);font-size:8px;text-align:center}
.journey .material-symbols-outlined{flex:0;color:var(--soft);font-size:14px}
.button{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:10px 14px;font-size:12px;font-weight:650;cursor:pointer}
.button.ghost{border-color:transparent;background:transparent}
@media(max-width:900px){.project-columns{grid-template-columns:1fr}}
```

**Mapeamento de tokens — use os do Studio, não os do wireframe.** O wireframe nomeia `--blue #286eea`, `--blue-50 #edf4ff`, `--ink #101828`, `--muted #667085`, `--soft #98a2b3`, `--line #e1e7ef`, `--cloud #f6f8fb`. O Studio já tem os equivalentes em `packages/studio/public/styles.css:1`: `--alva-blue`, `--alva-highlight`, `--alva-ink`, `--alva-muted`, `--alva-soft`, `--alva-line`, `--alva-cloud`. Use os do Studio. O degradê da barra está hardcoded no wireframe (`#286eea → #94b8ff`) e deve virar `linear-gradient(var(--alva-blue), var(--alva-blue-light))`. **Não crie token novo.**

**Três desvios conscientes, a registrar na certificação:**

1. A legenda do wireframe diz "Umami · atualizado agora", mas a arquitetura aprovada é coletor interno, sem Umami. Escrever **"Coletor interno · atualizado agora"** e marcar como desvio de texto para o dono confirmar. Não deixe a palavra "Umami" na interface.
2. O wireframe **não tem** estado de carregamento, vazio nem erro — confirmado: o arquivo inteiro tem uma única regra `:hover` e nenhuma `:focus`. O painel real precisa dos três. Construa-os só com os tokens existentes, no estilo de `#project-status` e `projectOverviewModel`, sem inventar cor, raio ou sombra.
3. Barras sem rótulo não são acessíveis. Acrescente nome acessível por barra (dia e contagem) sem alterar nada do visual: `role="img"` com `aria-label` no `.chart` e `<title>`/`aria-label` por barra. Foco visível no botão segue o padrão já existente em `styles.css`.

**Interfaces:**
- Consumes: `GET /api/projects/:projectId/analytics/summary` (Task 9).
- Produces: `analyticsPanelModel(summary, { phase, error })` em `studio-dashboard.js` → `{ phase, bars: [{ dia, visitas, altura }], funnel: [...], updatedLabel }`, com `altura` normalizada pelo maior valor e piso de 12 px como no wireframe.
- O botão "Abrir Analytics" fica visível só com `analytics.read`; sem a capacidade, o cartão inteiro não é renderizado.

- [ ] **Step 1: Escrever os testes que falham**

  Em `analytics-panel.test.mjs`, sobre o modelo puro: sete barras sempre, mesmo com dias sem visita; a maior barra vira 100% e as demais são proporcionais; dia com zero respeita o piso mínimo; funil com menos de quatro etapas não quebra; `phase` cobre `loading`, `empty`, `error` e `ready`. Em `studio-dashboard.test.mjs`, sobre o contrato de DOM: o cartão usa `.surface.analytics-card`, `.chart`, `.chart i`, `.journey`; o título é exatamente "Visitas nos últimos 7 dias"; a palavra "Umami" não aparece; papel sem `analytics.read` não recebe o cartão; nenhum valor hexadecimal novo foi introduzido em `styles.css` para este bloco.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/analytics-panel.test.mjs packages/studio/test/studio-dashboard.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Inserir o cartão em `index.html` dentro de `.project-columns`, depois da `section` de Conteúdos (hoje em `packages/studio/public/index.html:157`). Buscar o resumo em `renderProject()` (`app.js:603`), reaproveitando `createLatestRequestGuard()` para descartar resposta atrasada ao trocar de projeto.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/analytics-panel.test.mjs packages/studio/test/studio-dashboard.test.mjs`

- [ ] **Step 5: Verificação visual em navegador**

  Abrir a visão de projeto e a seção "Visitas nos últimos 7 dias" do wireframe lado a lado, no mesmo viewport, em desktop e em 375 px de largura. Comparar altura do cartão, altura e espaçamento das barras, arredondamento, pills do funil e posição do botão. Salvar o screenshot da comparação.

- [ ] **Step 6: Commit** — `feat(studio): painel de visitas dos últimos 7 dias`

**Pronto quando:** as duas suites passam, o screenshot da comparação existe, nenhum token novo foi criado e os três desvios estão anotados para a certificação.

---

### Task 11: Tracker e CSP no snapshot publicado

**Files:**
- Modify: `packages/studio/server/publication-snapshot.mjs`
- Test: `packages/studio/test/publication-snapshot.test.mjs`

**Interfaces:**
- O HTML gerado em `publication-snapshot.mjs:112` passa `nonce` e `trackerPublicId` para `renderDynamicForm`.
- Como o snapshot é servido pela Vercel, e não pelo Studio, a política vai em `<meta http-equiv="Content-Security-Policy">`, sem `frame-ancestors` e sem `report-uri`, que só valem em cabeçalho. Emitir cabeçalho via `vercel.json` fica para `tracking_pixels`.
- O snapshot continua determinístico: o nonce entra no cálculo do hash, então dois builds do mesmo conteúdo precisam usar um nonce derivado do `snapshotHash`, nunca aleatório.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: dois builds do mesmo conteúdo produzem o mesmo `hash`; o HTML publicado traz a `<meta>` de CSP e o script do tracker com o mesmo nonce; a `<meta>` não contém `frame-ancestors`; projeto sem website de analytics publica sem tracker e sem quebrar.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/publication-snapshot.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/publication-snapshot.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): publica o tracker e a CSP no snapshot`

**Pronto quando:** a suite passa e o snapshot continua idempotente.

---

### Task 12: Certificação do sub-nó

**Files:**
- Create: `.estado/tracking_coletor.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/public/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`
- Modify: `packages/studio/README.md`

- [ ] **Step 1: Rodar a suíte completa uma vez**

  Run: `node --test packages/studio/test/*.test.mjs`

- [ ] **Step 2: Conferir o contrato de aceite**

  Confirmar, com duas empresas no mesmo banco: nenhum evento cruza empresa ou projeto; nenhuma coluna `analytics_*` contém resposta de formulário; o mesmo IP e user agent geram `visitor_hash` diferente em dias diferentes; o marco configurado da VSL chega ao player; a resposta de `/f/...` traz CSP com nonce; a limpeza apaga evento de 91 dias e preserva agregado. Quem construiu não faz esta conferência.

- [ ] **Step 2b: Conferir a fidelidade visual**

  Regra "Regra de fidelidade visual" do `AGENTS.md`. Comparar o painel entregue na Task 10 com a seção **"Visitas nos últimos 7 dias"** de `docs/wireframes/alva-studio-ui-reference.html`, em desktop e em 375 px, e anexar o screenshot. Conferir que nenhum token novo entrou em `packages/studio/public/styles.css` e que os três desvios da Task 10 — legenda sem "Umami", estados de carregando/vazio/erro ausentes no wireframe, e nomes acessíveis das barras — estão descritos por escrito.

- [ ] **Step 3: Atualizar mapas e README**

  Acrescentar `analytics-repository.mjs`, `analytics-collect.mjs`, `content-security-policy.mjs` ao `server/MAPA.md`; `tracker.js` ao `public/MAPA.md`; as suites `analytics*.test.mjs` ao `test/MAPA.md`; e uma seção curta no README descrevendo o coletor interno, a ausência de cookie e de PII, a retenção e a CSP das páginas públicas.

- [ ] **Step 4: Registrar o estado**

  Escrever `.estado/tracking_coletor.md` com `status: feito`, ressalvas, a seção do wireframe conferida com o caminho do screenshot, e a linha exigida pelo `passa_quando` do nó em `produto/grafo.yaml`, na forma `Prova: coletor sem PII, isolado por projeto, <N> testes verdes`. Rodar `vibe conferir tracking_coletor` e confirmar verde.

- [ ] **Step 5: Commit** — `docs: certifica o coletor de tracking`

**Pronto quando:** `vibe conferir tracking_coletor` passa, a suíte completa está verde e a verificação visual está registrada.

---

## Gate de homologação

Com duas empresas e dois projetos no mesmo banco, publicar uma landing page com VSL e um formulário de três etapas. Visitar as duas rotas por um link com `?utm_source=meta&utm_campaign=teste&fbclid=abc`, assistir à VSL até 75%, clicar no CTA, percorrer as três etapas e enviar. Confirmar no resumo do projeto: a visita, a origem, as UTMs, os marcos e a conversão aparecem no projeto certo e em nenhum outro. Confirmar no banco: nenhuma linha `analytics_*` contém nome, e-mail, telefone ou resposta aberta, e nenhum IP foi gravado. Confirmar no navegador: a página `/f/...` não gera violação de CSP no console e nenhum script de terceiro carrega em `/v/...`.

## Ordem e paralelismo

- Onda 1, quatro terminais: Tasks 1, 3, 4, 5 — arquivos disjuntos; 3, 4 e 5 nem dependem do schema.
- Onda 2, três terminais: Task 2 (depende de 1), Task 6 (depende de 4), Task 7.
- Onda 3, três terminais: Task 8 (depende de 2, 3, 4, 5, 6), Task 9 (depende de 2), Task 11 (depende de 4, 6).
- Onda 4: Task 10, sozinha — é a única que toca `public/index.html`, `public/app.js`, `public/studio-dashboard.js` e `public/styles.css`, e consome o endpoint da Task 9.
- Onda 5: Task 12, sozinha.

`server/index.mjs` só é tocado pela Task 8, `server/dynamic-form.mjs` só pela Task 6, `server/repositories/analytics-repository.mjs` pelas Tasks 2 e 9 em ondas diferentes, e todo o `public/` de painel só pela Task 10 — nenhuma onda tem dois terminais no mesmo arquivo.
