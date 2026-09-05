status: feito
certificacao: DONE_WITH_CONCERNS

# Leads e integrações

O nó entrega lista paginada de leads por projeto, exportação CSV por formulário e webhook HTTPS best-effort após a persistência. A consulta exige `submission.read` e escopa empresa/projeto; o CSV usa BOM UTF-8, colunas determinísticas, RFC-4180 e neutralização de fórmulas. O webhook envia somente JSON do evento `form.submitted`, sem credenciais/cabeçalhos da requisição, com timeout, bloqueio de destinos locais/privados e atualização escopada de `delivered`/`failed`.

## Verificação

- Suíte executada uma única vez: `node --test packages/studio/test/*.test.mjs`.
- Resultado exato: 278 testes, 277 pass, 1 fail, 0 cancelled, 0 skipped, duração 34865.116209 ms.
- Evidência de aceite: `packages/studio/test/project-api.test.mjs` cobre lista/CSV, evento do projeto correto, persistência antes da entrega e lead preservado quando a entrega falha; `packages/studio/test/outbound-webhook.test.mjs` cobre HTTPS controlado, timeout, não-2xx, redirect e destinos privados.
- Nenhuma rede real ou produção foi usada; os testes injetam `dnsLookup`/`webhookFetch` controlados.

## Preocupação aberta

`packages/studio/test/server.test.mjs` falha porque `/app.js` importa `/leads-ui.js`, mas `packages/studio/server/index.mjs` não o expõe no mapa público; a suíte reporta 404. A certificação funcional de leads está verde nos testes específicos, mas a certificação final permanece `DONE_WITH_CONCERNS` até o mapa ser corrigido e a suíte completa passar.

## Escopo diferido: worker_webhook

Ficam fora deste nó fila durável, retry, leases, idempotência de entrega, auditoria completa e defesa contra DNS rebinding. Esses itens pertencem ao nó `worker_webhook`.
