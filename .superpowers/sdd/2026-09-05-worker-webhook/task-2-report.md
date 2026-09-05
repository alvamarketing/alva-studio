# Task 2 — entrega webhook básica pós-persistência

## TDD

- RED confirmado: `node --test packages/studio/test/outbound-webhook.test.mjs` falhou porque `deliverWebhook` não era exportada.
- RED de integração confirmado: o teste público SaaS esperou `X-Webhook-Delivery: delivered` e recebeu `pending`.
- GREEN: entrega best-effort foi implementada após a transação de persistência.

## Entrega

- `deliverWebhook` resolve os endereços uma vez, bloqueia destinos loopback, privados, link-local, multicast e não especificados em IPv4/IPv6, usa POST JSON sem repassar cabeçalhos, recusa redirecionamentos e aplica timeout.
- O evento enviado contém `eventId`, `form.submitted`, escopos, instante e respostas; corpos de resposta remota não são lidos ou expostos.
- `markSubmissionTracking` atualiza somente a submissão pertencente aos quatro identificadores de escopo.
- Falhas de entrega continuam retornando a página de conclusão e persistem `failed`.

## Verificação e revisão

- `node --test packages/studio/test/outbound-webhook.test.mjs packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs` — 31 testes aprovados.
- `git diff --check` — sem erros de whitespace.
- Revisão manual: não houve alterações em UI, migrações, documentação de produto ou estado; o fluxo legado continua com o contrato `pending`.
