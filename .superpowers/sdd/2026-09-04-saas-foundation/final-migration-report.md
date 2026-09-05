# Relatório final — upgrade de migrações e identificadores

Data: 2026-09-04

## Escopo

- Corrigir o upgrade de um banco populado que já havia aplicado a migração `001`.
- Impedir que slugs e rotas sejam criados a partir de valores ausentes ou não textuais.
- Preservar os checksums das migrações `001` e `002`.

## Diagnóstico

A migração `001` instala triggers que rejeitam qualquer `UPDATE` ou `DELETE` em `page_versions` e `form_versions`. A migração `003` acrescentava `published_path` e tentava preencher essa coluna com `UPDATE`, portanto o upgrade falhava quando já havia versões persistidas.

Os normalizadores chamavam `String(value)` dentro de `foldText`. Com isso, valores como `undefined`, `null` e números podiam se transformar em identificadores textuais válidos antes de qualquer validação.

## Correções

- A migração `003` suspende somente `page_versions_immutable` e `form_versions_immutable` durante o backfill e os reativa antes de concluir. O migrador executa o lote dentro de uma transação; se qualquer comando falhar, o PostgreSQL também reverte a mudança de estado dos triggers.
- `normalizeProjectSlug` e `normalizeRoute` agora exigem uma string não vazia antes da normalização. O comportamento das strings válidas permanece igual.

## Cobertura adicionada

- Upgrade real: aplica apenas `001`, insere empresa, projeto, página, formulário e suas versões, adiciona `002`–`005`, executa o migrador novamente e confirma os dois valores de `published_path`.
- A mesma prova tenta atualizar uma versão de página e apagar uma versão de formulário depois do upgrade, confirmando que a imutabilidade continua ativa.
- Os dois normalizadores rejeitam `undefined`, `null`, número, objeto, array e texto em branco.

## Evidências TDD

RED:

- Teste de upgrade falhou em `prevent_version_mutation()` com `Versões são imutáveis.`.
- Testes dos normalizadores falharam com `Missing expected exception.`.

GREEN:

- `node --test packages/studio/test/access.test.mjs`: 7 testes aprovados.
- `node --test --test-name-pattern='upgrade de 001 populada' packages/studio/test/database-schema.test.mjs`: 1 teste aprovado.
- `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`: 120 testes aprovados, 0 falhas.

## Integração

Antes do commit, `hermes mcp list` informou que não há servidores MCP configurados e `hermes mcp test github` informou que o servidor `github` não existe na configuração. A integração seguirá pelo Git local.
