# Task 4 — certificação de leads e integrações

## Resultado

DONE_WITH_CONCERNS

## Suíte

Executada exatamente uma vez:

```sh
node --test packages/studio/test/*.test.mjs
```

Resultado: 278 testes; 277 passaram, 1 falhou, 0 cancelados e 0 ignorados. Duração: 34865.116209 ms.

## Contrato verificado

Os testes específicos confirmam que o lead persistido aparece na lista paginada e no CSV, que a entrega controlada recebe apenas `event: form.submitted` do `companyId`, `projectId` e `formId` corretos, e que uma falha de entrega mantém o lead salvo com status `failed`. Os testes de webhook usam `dnsLookup`/`webhookFetch` injetados; não houve egress real nem alteração de produção.

## Concern

`packages/studio/test/server.test.mjs` falhou em “servidor entrega todo o grafo de módulos importado pelo app”: `/leads-ui.js` retornou 404. O módulo existe e os testes de UI passam, mas `packages/studio/server/index.mjs` ainda não o inclui no mapa público. Não corrigi código nesta certificação, conforme o escopo autorizado.

## Escopo diferido

Fila durável, retries, leases, idempotência de entrega, auditoria completa e defesa contra DNS rebinding permanecem no nó `worker_webhook`.
