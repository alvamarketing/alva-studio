# Task 3 — Superfície de leads no Studio

## Entrega

- Criado `packages/studio/public/leads-ui.js` com normalização de linhas, exibição segura de respostas, estado da lista e URL de CSV.
- Adicionado o filtro `Leads` à visão de projeto, restrito a `submission.read`.
- Implementados estados de carregamento, vazio e erro, filtro por formulário, paginação por cursor e link nativo de exportação CSV.
- As respostas são inseridas como texto no DOM; respostas de projeto ou empresa anteriores são ignoradas.

## TDD

- RED confirmado com `ERR_MODULE_NOT_FOUND` para `leads-ui.js` e contrato de capacidade ausente.
- GREEN confirmado com os testes focados e com toda a suíte do Studio.

## Verificação

`node --test packages/studio/test/leads-ui.test.mjs packages/studio/test/studio-dashboard.test.mjs` — 27 testes aprovados.

`npm test` em `packages/studio` — suíte completa aprovada.
