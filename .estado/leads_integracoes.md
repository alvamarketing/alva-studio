---
no: leads_integracoes
status: feito
---

# Leads e integrações

O nó entrega lista paginada de leads por projeto, exportação CSV por formulário e webhook HTTPS best-effort após a persistência. A consulta exige `submission.read` e escopa empresa/projeto; o CSV usa BOM UTF-8, colunas determinísticas, RFC-4180 e neutralização de fórmulas. O webhook envia somente JSON do evento `form.submitted`, sem credenciais/cabeçalhos da requisição, com timeout, bloqueio de destinos locais/privados e atualização escopada de `delivered`/`failed`.

## Verificação

- Suíte executada uma única vez: `node --test packages/studio/test/*.test.mjs`.
- Resultado exato: 278 testes, 278 pass, 0 fail, 0 cancelled, 0 skipped, duração 35002.255958 ms.
- Evidência de aceite: `packages/studio/test/project-api.test.mjs` cobre lista/CSV, evento do projeto correto, persistência antes da entrega e lead preservado quando a entrega falha; `packages/studio/test/outbound-webhook.test.mjs` cobre HTTPS controlado, timeout, não-2xx, redirect e destinos privados.
- Nenhuma rede real ou produção foi usada; os testes injetam `dnsLookup`/`webhookFetch` controlados.

## Preocupação resolvida

`packages/studio/test/server.test.mjs` falhava porque `/app.js` importa `/leads-ui.js`, mas `packages/studio/server/index.mjs` não o expunha no mapa público (404). Corrigido no commit `da427c0` ao registrar `/leads-ui.js` no mapa `files` de `server/index.mjs`, com asserção de regressão em `server.test.mjs`. Suíte completa reexecutada de forma independente após o fix: 278/278 aprovados. Certificação final atualizada de `DONE_WITH_CONCERNS` para `DONE`.

## Escopo diferido: worker_webhook

Ficam fora deste nó fila durável, retry, leases, idempotência de entrega, auditoria completa e defesa contra DNS rebinding. Esses itens pertencem ao nó `worker_webhook`.
