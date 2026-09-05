# Worker de Webhook Seguro — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar webhooks de formulários SaaS em fila, depois de persistir a submissão, com tentativas auditáveis, idempotência e bloqueio de SSRF/DNS rebinding.

**Architecture:** A transação que cria `form_submissions` também cria uma entrega pendente usando o webhook congelado em `form_versions.schema`. Um processo separado reclama itens com lease e `FOR UPDATE SKIP LOCKED`, resolve e valida todos os endereços DNS, conecta ao IP aprovado mantendo Host/SNI originais e registra tentativa, retry ou conclusão sem guardar resposta remota nem expor respostas em logs. A semântica é at-least-once; a mesma chave idempotente acompanha todas as tentativas para o receptor deduplic possíveis reenvios.

**Tech Stack:** JavaScript ESM, Node.js 22 (`dns`, `net`, `https`, `crypto`), PostgreSQL, `node:test` e adapters injetáveis para relógio, DNS e transporte.

**Spec:** `produto/grafo.yaml` → nó `worker_webhook`; `docs/superpowers/specs/2026-09-04-alva-studio-saas-design.md`; auditoria de `packages/studio/server/outbound-webhook.mjs`, `packages/studio/server/repositories/content-repository.mjs`, `packages/studio/server/index.mjs` e testes em 2026-09-05.

## Global Constraints

- Preservar o contrato multiempresa: toda entrega carrega `company_id`, `project_id`, `form_id`, `form_version_id` e `submission_id`, com FKs compostas.
- A submissão e a entrega entram na mesma transação; se o enqueue falhar, a submissão também falha.
- O webhook vem do snapshot publicado `form_versions.schema.webhook`; editar o rascunho depois não muda entregas existentes.
- `form_submissions.tracking_status` pertence ao futuro `tracking_analytics` e não representa webhook.
- Nenhum egress ocorre no request público. A resposta de conclusão volta assim que submissão + fila são persistidas.
- Aceitar somente HTTPS, sem credenciais, fragmento, porta diferente de 443, hostname local/single-label ou IP não global.
- Resolver DNS em toda tentativa; rejeitar a resposta inteira se qualquer A/AAAA for privada, reservada ou inválida; conectar diretamente ao IP aprovado sem nova resolução.
- Não seguir redirects. Não registrar respostas do formulário, corpo remoto, query/path completos do webhook, cookies, segredos ou `DATABASE_URL`.
- Retry apenas para timeout, falha transitória de rede, 408, 425, 429 e 5xx; 2xx conclui; demais HTTP e destino inseguro vão para `dead`.
- Política inicial: máximo 6 tentativas, timeout de 10 s e atrasos de 0, 1 min, 5 min, 30 min, 2 h e 12 h; `Retry-After` válido pode aumentar o próximo horário até o teto de 12 h.
- Payload máximo de 5 MiB, alinhado ao limite público atual.
- O modo JSON legado e webhooks de página ficam fora deste nó. `tracking_analytics`, pixels e evento `lead` também ficam fora.
- Homologação usa PostgreSQL local e adapters falsos. Nenhum hostname é resolvido pela rede e nenhum request HTTPS externo real é enviado.

## Divisão implementador/revisor

- Cada Task vai para um **implementador** novo, que lê somente este plano, o diff acumulado e os arquivos listados, executa RED/GREEN e registra `.superpowers/sdd/2026-09-05-worker-webhook/task-N-report.md`.
- Um **revisor independente** recebe o commit/diff e o relatório, não edita código, executa os comandos da Task e registra `task-N-review.md` com `Approved` ou findings `Critical/Important/Minor`.
- Finding volta ao implementador; o mesmo revisor confirma o fix. Quem implementa nunca assina o gate da própria Task.
- O nó só recebe `status: feito` depois do revisor final executar a homologação local completa e verificar que os adapters reais de DNS/HTTPS não foram chamados nos testes.

---

### Task 1: Persistência da fila e invariantes de tenant

**Implementador:** banco e contrato de estados. **Revisor:** migração, FKs, upgrade e concorrência estrutural.

**Files:**
- Create: `packages/studio/server/db/migrations/006_webhook_delivery_queue.sql`
- Modify: `packages/studio/test/database-schema.test.mjs`
- Modify: `packages/studio/server/MAPA.md`

**Interfaces:**
- Produces: tabelas `webhook_deliveries` e `webhook_delivery_attempts`.
- Estados: `pending | processing | retry | delivered | dead`; outcomes: `delivered | retry | dead`.

- [ ] **Step 1: Escrever o teste de migração falho**

Adicionar as duas tabelas a `expectedTables` e provar as FKs compostas, unicidade por submissão, checks de estado/contagem e upgrade 001–005 → 006:

```js
assert.ok(tableNames.has('webhook_deliveries'));
assert.ok(tableNames.has('webhook_delivery_attempts'));
await assert.rejects(
  () => database.query(
    `INSERT INTO webhook_deliveries
       (company_id, project_id, form_id, form_version_id, submission_id, target_url)
     VALUES ($1, $2, $3, $4, $5, 'https://hooks.example.test/lead')`,
    [otherCompanyId, projectId, formId, versionId, submissionId],
  ),
  violates,
);
```

- [ ] **Step 2: Confirmar o RED**

Run: `node --test --test-name-pattern="webhook|migrador" packages/studio/test/database-schema.test.mjs`

Expected: falhar porque a migração/tabelas ainda não existem.

- [ ] **Step 3: Criar a migração 006**

Implementar o schema abaixo, incluindo `UNIQUE (company_id, project_id, form_id, id)` em `form_submissions` para suportar a FK composta:

```sql
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_company_project_form_id_unique
  UNIQUE (company_id, project_id, form_id, id);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  form_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  target_url text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 6),
  max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 6),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_http_status integer CHECK (last_http_status BETWEEN 100 AND 599),
  last_error_code varchar(60),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id),
  FOREIGN KEY (company_id, project_id, form_id)
    REFERENCES forms(company_id, project_id, id),
  FOREIGN KEY (company_id, project_id, form_id, form_version_id)
    REFERENCES form_versions(company_id, project_id, form_id, id),
  FOREIGN KEY (company_id, project_id, form_id, submission_id)
    REFERENCES form_submissions(company_id, project_id, form_id, id)
);

CREATE INDEX webhook_deliveries_due
  ON webhook_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX webhook_deliveries_lease
  ON webhook_deliveries (lease_expires_at)
  WHERE status = 'processing';

CREATE TABLE webhook_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES webhook_deliveries(id),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 6),
  outcome varchar(20) NOT NULL CHECK (outcome IN ('delivered', 'retry', 'dead')),
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  error_code varchar(60),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  UNIQUE (delivery_id, attempt_number)
);
```

- [ ] **Step 4: Rodar GREEN e regressão de schema**

Run: `node --test packages/studio/test/database-schema.test.mjs packages/studio/test/project-content.test.mjs`

Expected: exit 0; migração reaplica por checksum, dados 001–005 atualizam e FKs impedem cruzamento de tenant.

- [ ] **Step 5: Revisão independente da Task 1**

O revisor confere que não existe cascade que apague tentativa/auditoria, que `submission_id` é único e que nenhuma coluna reutiliza `tracking_status`. Aprovar antes do commit seguinte.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/db/migrations/006_webhook_delivery_queue.sql packages/studio/test/database-schema.test.mjs packages/studio/server/MAPA.md
git commit -m "feat: cria fila persistente de webhooks"
```

---

### Task 2: Política de destino, DNS e transporte pinado

**Implementador:** política pura e transporte HTTPS. **Revisor:** SSRF, rebinding, redirects, TLS e ausência de egress nos testes.

**Files:**
- Modify: `packages/studio/server/outbound-webhook.mjs`
- Create: `packages/studio/test/outbound-webhook.test.mjs`
- Modify: `packages/studio/test/MAPA.md`

**Interfaces:**
- Produces: `validateWebhookUrl(value) -> canonicalUrl`.
- Produces: `resolveWebhookDestination(url, { lookup }) -> { url, addresses }`.
- Produces: `createPinnedWebhookTransport({ request, timeoutMs, maxBodyBytes }).post({ destination, headers, body })`.

- [ ] **Step 1: Escrever testes falhos de URL e IP**

Cobrir HTTPS 443 válido; HTTP, credenciais, fragmento, porta customizada, `localhost`, hostname sem ponto e IP literal inválidos. A lista de bloqueio inclui IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, multicast/reservado `224/4` e IPv6 unspecified/loopback, IPv4-mapped, `fc00/7`, `fe80/10`, `ff00/8`, `2001:db8/32`.

```js
for (const value of [
  'http://hooks.example.com/x',
  'https://user:pass@hooks.example.com/x',
  'https://localhost/x',
  'https://hooks/x',
  'https://hooks.example.com:8443/x',
  'https://127.0.0.1/x',
  'https://[::1]/x',
]) assert.throws(() => validateWebhookUrl(value), /HTTPS válido/);
```

- [ ] **Step 2: Escrever testes falhos de DNS/rebinding**

O resolver falso retorna todos os formatos abaixo sem rede:

```js
await assert.rejects(
  () => resolveWebhookDestination('https://hooks.example.com/x', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  }),
  /destino público/,
);
```

Também provar: zero respostas e erro DNS são retryable; resposta privada/mista é terminal `unsafe_destination`; endereços repetidos são normalizados; o transporte recebe um IP já aprovado, `servername`/`Host` originais e nunca chama lookup novamente.

- [ ] **Step 3: Confirmar o RED**

Run: `node --test packages/studio/test/outbound-webhook.test.mjs`

Expected: falhar porque as interfaces novas ainda não existem.

- [ ] **Step 4: Implementar validação, resolução e POST pinado**

Usar somente módulos nativos. A requisição deve ter `method: 'POST'`, `hostname: approvedIp`, `servername: originalHostname`, `port: 443`, `path: pathname + search`, `Host: originalHost`, certificado validado pelo hostname original e abort após 10 s. O transporte não segue o cabeçalho `Location`; classificar toda resposta 3xx como terminal. Limitar a leitura da resposta a 64 KiB e descartá-la; nunca retorná-la nem registrá-la.

- [ ] **Step 5: Rodar GREEN e revisão de segurança**

Run: `node --test packages/studio/test/outbound-webhook.test.mjs`

Expected: exit 0 com adapters falsos; contador do lookup real e do `https.request` real permanece zero.

O revisor tenta bypasses com IPv4 em IPv6, hostname com ponto final, caixa, `%2f`, credenciais codificadas, múltiplas respostas DNS e redirect. Rejeitar qualquer segundo lookup entre aprovação e conexão.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/outbound-webhook.mjs packages/studio/test/outbound-webhook.test.mjs packages/studio/test/MAPA.md
git commit -m "feat: protege destinos de webhook contra SSRF"
```

---

### Task 3: Enqueue atômico após submissão persistida

**Implementador:** repositório da fila e integração transacional. **Revisor:** atomicidade, snapshot publicado e compatibilidade HTTP.

**Files:**
- Create: `packages/studio/server/repositories/webhook-delivery-repository.mjs`
- Modify: `packages/studio/server/repositories/content-repository.mjs`
- Modify: `packages/studio/server/index.mjs`
- Modify: `packages/studio/test/project-content.test.mjs`
- Modify: `packages/studio/test/project-api.test.mjs`
- Modify: `packages/studio/server/MAPA.md`

**Interfaces:**
- Produces: `WebhookDeliveryRepository.enqueue(client, { companyId, projectId, formId, formVersionId, submissionId, targetUrl })`.
- `ContentRepository` usa `constructor(database, { webhookDeliveries = new WebhookDeliveryRepository(database) } = {})`; testes podem injetar falha sem desligar a fila por acidente na composição SaaS.
- Public submission continues to return completion HTML and `X-Webhook-Delivery: pending` only when a delivery was queued.

- [ ] **Step 1: Escrever os testes falhos de atomicidade**

Em `project-content.test.mjs`, publicar um formulário com webhook A, submeter, editar o rascunho para webhook B e provar que a fila guarda A. Submissão sem webhook não cria entrega. Instalar um trigger de teste que falha em `webhook_deliveries` e provar que a contagem de `form_submissions` não aumenta.

```js
const delivery = await database.query(
  `SELECT company_id, project_id, form_id, form_version_id, submission_id, target_url, status
   FROM webhook_deliveries WHERE submission_id = $1`,
  [submitted.id],
);
assert.equal(delivery.rows[0].target_url, 'https://hooks.example.test/a');
assert.equal(delivery.rows[0].status, 'pending');
```

- [ ] **Step 2: Confirmar o RED**

Run: `node --test --test-name-pattern="webhook|submiss" packages/studio/test/project-content.test.mjs packages/studio/test/project-api.test.mjs`

Expected: falhar porque a submissão ainda não cria fila real.

- [ ] **Step 3: Implementar o enqueue dentro da transação existente**

Em `submitPublishedForm`, inserir `form_submissions`, extrair `form.schema.webhook`, validar/canonicalizar e chamar `webhookDeliveries.enqueue(client, ...)` antes do commit. A mesma transação grava `audit_events.action = 'webhook.queued'`, sem respostas ou URL completa nos metadados. Retornar:

```js
webhookDelivery: targetUrl
  ? { id: delivery.id, status: 'pending', executed: false }
  : { id: null, status: 'not_configured', executed: false }
```

Não colocar `answers` na fila: o worker lê a submissão persistida ao reclamar a entrega. Não alterar `tracking_status`.

- [ ] **Step 4: Rodar GREEN e testes HTTP**

Run: `node --test packages/studio/test/project-content.test.mjs packages/studio/test/project-api.test.mjs`

Expected: exit 0; conclusão pública continua imediata, header permanece `pending`, fetch/DNS injetados não são chamados no request.

- [ ] **Step 5: Revisão independente da Task 3**

O revisor força falha antes/depois do enqueue, troca o webhook do rascunho e cruza empresa/projeto nos IDs. Aprovar somente se a transação não deixar submissão órfã nem entrega sem submissão.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/repositories/webhook-delivery-repository.mjs packages/studio/server/repositories/content-repository.mjs packages/studio/server/index.mjs packages/studio/test/project-content.test.mjs packages/studio/test/project-api.test.mjs packages/studio/server/MAPA.md
git commit -m "feat: enfileira webhook junto da submissao"
```

---

### Task 4: Worker, leases, tentativas e auditoria

**Implementador:** máquina de entrega. **Revisor:** concorrência, retries, idempotência e ausência de PII em auditoria/log.

**Files:**
- Modify: `packages/studio/server/repositories/webhook-delivery-repository.mjs`
- Create: `packages/studio/server/webhook-worker.mjs`
- Create: `packages/studio/test/webhook-worker.test.mjs`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`

**Interfaces:**
- Repository produces: `claimDue({ workerId, now, limit, leaseMs })`, `recordOutcome({ deliveryId, workerId, attempt, outcome })` and `releaseExpired({ now })`.
- Worker produces: `createWebhookWorker({ queue, resolveDestination, transport, clock, workerId, batchSize }).runOnce()`.
- Stable headers: `Idempotency-Key: <delivery.id>`, `X-Alva-Delivery-Id: <delivery.id>`, `X-Alva-Event: form.submitted`.

- [ ] **Step 1: Escrever testes falhos de claim e lease**

Com duas instâncias do repositório, executar `claimDue` simultaneamente e confirmar que cada entrega aparece em no máximo um lote. Avançar o relógio além do lease e confirmar recuperação. O claim usa:

```sql
SELECT id FROM webhook_deliveries
WHERE (
  status IN ('pending', 'retry') AND next_attempt_at <= $1
) OR (
  status = 'processing' AND lease_expires_at <= $1
)
ORDER BY next_attempt_at, created_at
FOR UPDATE SKIP LOCKED
LIMIT $2;
```

- [ ] **Step 2: Escrever testes falhos de resultados e idempotência**

Cobrir: 204 entrega; 503 → retry; timeout → retry; 400 → dead; DNS inseguro → dead; sexta falha → dead; `Retry-After`; crash após claim → lease recuperado. Todas as tentativas usam o mesmo `Idempotency-Key`. O payload é estável:

```js
{
  id: delivery.id,
  type: 'form.submitted',
  occurredAt: submission.submittedAt,
  data: {
    submissionId: submission.id,
    companyId: delivery.companyId,
    projectId: delivery.projectId,
    formId: delivery.formId,
    formVersionId: delivery.formVersionId,
    answers: submission.answers,
  },
}
```

- [ ] **Step 3: Confirmar o RED**

Run: `node --test packages/studio/test/webhook-worker.test.mjs`

Expected: falhar porque claim/outcomes/worker ainda não existem.

- [ ] **Step 4: Implementar a máquina de estados**

`claimDue` incrementa `attempt_count`, grava lease e carrega submissão + tenant em uma transação curta; nenhuma transação fica aberta durante DNS/HTTPS. `recordOutcome` verifica `status = 'processing' AND lease_owner = workerId`, insere exatamente uma linha em `webhook_delivery_attempts`, atualiza a entrega e adiciona `audit_events` com `webhook.delivered`, `webhook.retry_scheduled` ou `webhook.dead`. O evento `webhook.queued` já foi gravado atomicamente na Task 3.

Auditoria contém apenas delivery id, attempt, outcome, status HTTP, error code e próximo horário. Mensagens são códigos fechados (`timeout`, `dns_temporary`, `unsafe_destination`, `network_error`, `http_retryable`, `http_terminal`, `payload_too_large`); não guardar stack, respostas, body, URL completa nem answers.

- [ ] **Step 5: Rodar GREEN e regressão de tenancy**

Run: `node --test packages/studio/test/webhook-worker.test.mjs packages/studio/test/tenancy.test.mjs packages/studio/test/project-content.test.mjs`

Expected: exit 0; duas instâncias não entregam a mesma lease simultaneamente; retry conserva id e payload; auditoria não contém PII de fixture.

- [ ] **Step 6: Revisão independente da Task 4**

O revisor simula queda entre resposta 204 e `recordOutcome`: o lease deve permitir reenvio com a mesma chave, documentando at-least-once sem alegar exactly-once. Verifica ainda que erro de banco não imprime o payload.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/server/repositories/webhook-delivery-repository.mjs packages/studio/server/webhook-worker.mjs packages/studio/test/webhook-worker.test.mjs packages/studio/server/MAPA.md packages/studio/test/MAPA.md
git commit -m "feat: entrega webhooks com retry e idempotencia"
```

---

### Task 5: Processo do worker e homologação local sem egress

**Implementador:** entrypoint e ciclo de vida. **Revisor final:** boot, shutdown, homologação ponta a ponta e prova de zero egress externo.

**Files:**
- Create: `packages/studio/server/webhook-worker-entry.mjs`
- Create: `packages/studio/test/webhook-worker-integration.test.mjs`
- Modify: `packages/studio/package.json`
- Modify: `packages/studio/README.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`

**Interfaces:**
- Command: `pnpm --dir packages/studio worker:webhook`.
- Entry: `startWebhookWorker({ connectionString, databaseFactory, migrateFn, workerFactory, signal, log })`.
- Loop awaits `runOnce()` before the next poll; SIGINT/SIGTERM stop polling, await current attempt up to 10 s and close PostgreSQL once.

- [ ] **Step 1: Escrever teste falho do boot e shutdown**

Provar `DATABASE_URL` obrigatória sem imprimir valor, migração antes do loop, ausência de loops sobrepostos, encerramento idempotente e fechamento do banco quando boot falha.

- [ ] **Step 2: Escrever homologação ponta a ponta com adapters falsos**

O teste deve:

1. subir PostgreSQL local;
2. publicar formulário com `https://hooks.example.test/lead`;
3. submeter resposta e confirmar HTML imediato + fila `pending`;
4. rodar `runOnce()` com lookup falso retornando `93.184.216.34` e transporte falso retornando 503;
5. avançar relógio, rodar de novo com 204 e confirmar uma entrega, duas tentativas, mesma chave e auditoria sanitizada;
6. rodar novamente e confirmar zero chamadas adicionais;
7. repetir com DNS privado/misto e confirmar `dead` antes do transporte;
8. afirmar contadores `realDnsCalls === 0` e `realHttpsCalls === 0`.

- [ ] **Step 3: Confirmar o RED**

Run: `node --test packages/studio/test/webhook-worker-integration.test.mjs`

Expected: falhar porque o entrypoint/loop ainda não existe.

- [ ] **Step 4: Implementar o entrypoint mínimo**

Adicionar ao `packages/studio/package.json`:

```json
"worker:webhook": "node --env-file-if-exists=.env server/webhook-worker-entry.mjs"
```

Logs operacionais aceitos: worker iniciado/parado, contagem do lote e códigos agregados. Nunca interpolar `DATABASE_URL`, target URL, payload, resposta, cookie ou erro bruto.

- [ ] **Step 5: Rodar o gate focalizado**

Run: `node --test --test-concurrency=1 packages/studio/test/database-schema.test.mjs packages/studio/test/project-content.test.mjs packages/studio/test/project-api.test.mjs packages/studio/test/outbound-webhook.test.mjs packages/studio/test/webhook-worker.test.mjs packages/studio/test/webhook-worker-integration.test.mjs`

Expected: exit 0; teste de integração declara explicitamente zero DNS/HTTPS reais.

- [ ] **Step 6: Revisor final executa regressão completa**

Run: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`

Expected: exit 0, sem mudança no `tracking_status`, isolamento de tenant preservado e modo legado sem egress.

Run: `node --check packages/studio/server/outbound-webhook.mjs && node --check packages/studio/server/repositories/webhook-delivery-repository.mjs && node --check packages/studio/server/webhook-worker.mjs && node --check packages/studio/server/webhook-worker-entry.mjs && git diff --check`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/server/webhook-worker-entry.mjs packages/studio/test/webhook-worker-integration.test.mjs packages/studio/package.json packages/studio/README.md packages/studio/server/MAPA.md packages/studio/test/MAPA.md
git commit -m "feat: homologa worker de webhook localmente"
```

---

### Task 6: Consolidar gate e estado do grafo

**Implementador:** somente documentação após aprovação. **Revisor final:** confirma que o SHA/diff aprovado é o mesmo documentado.

**Files:**
- Modify: `produto/grafo.yaml`
- Create: `.estado/worker_webhook.md`

**Interfaces:**
- Produces: nó `worker_webhook` com `estado: feito` e evidência reproduzível.

- [ ] **Step 1: Registrar a homologação aprovada**

Somente depois dos Steps 5 e 6 da Task 5 passarem, atualizar `passa_quando` do nó com o comando focalizado e marcar `estado: feito`. Não alterar stack, pais ou o escopo de `tracking_analytics`.

- [ ] **Step 2: Criar o estado no formato do vibe**

```markdown
---
no: worker_webhook
status: feito
---
Homologado na data ISO do gate registrada pelo revisor, com PostgreSQL local, DNS e transporte HTTPS injetados; nenhuma resolução ou requisição externa real foi executada. A linha seguinte registra a contagem observada dos testes, a política de retry e a semântica at-least-once.
```

Registrar data e contagem somente a partir da evidência do revisor, sem antecipar valores.

- [ ] **Step 3: Rodar verificação do grafo e diff final**

Run: `vibe proximo`

Expected: `worker_webhook` deixa de aparecer entre os nós liberados; nenhum nó bloqueado por ele perde dependência.

Run: `git diff --check && git status --short`

Expected: apenas arquivos previstos pelo plano e artefatos SDD ignorados.

- [ ] **Step 4: Revisão documental independente**

O revisor compara `.estado/worker_webhook.md`, `produto/grafo.yaml`, resultados dos testes e commit final. Se houver divergência, status volta para `falta-contexto`; não declarar feito por suposição.

- [ ] **Step 5: Commit**

```bash
git add produto/grafo.yaml .estado/worker_webhook.md
git commit -m "docs: conclui gate do worker de webhook"
```

## Gate de homologação local

O gate passa somente quando, no mesmo SHA revisado:

- submissão válida e enqueue são atômicos;
- duas empresas/projetos não conseguem cruzar fila, tentativa ou auditoria;
- duas instâncias usam `SKIP LOCKED` sem claim simultâneo;
- lease vencida recupera crash com a mesma chave idempotente;
- destino privado, resposta DNS mista e tentativa de rebinding falham antes do transporte;
- 2xx, 4xx terminal, 408/425/429/5xx, timeout e sexta tentativa produzem os estados esperados;
- o request público não faz DNS/HTTPS e continua retornando a confirmação depois do commit;
- corpo remoto, respostas, webhook completo e segredos não aparecem em auditoria/log;
- `tracking_status` permanece reservado para `tracking_analytics`;
- a suíte focalizada e a suíte completa passam com contadores de DNS/HTTPS reais em zero.
