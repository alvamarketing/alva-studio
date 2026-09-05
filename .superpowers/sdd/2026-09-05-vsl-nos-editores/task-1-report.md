# Relatório da Task 1 — contrato compartilhado da referência VSL

## Implementação

- Criado `packages/studio/server/vsl-reference.mjs` com normalização defensiva, resolução isolada por empresa/projeto/publicId e versão publicada, URL absoluta de embed e deduplicação de consultas.
- O snapshot passou a carregar `editor_state`, coletar referências VSL de estados/schemas e resolver todas antes de transformar páginas e formulários em arquivos públicos.
- Referências com IDs internos, URLs/configuração de player ou campos extras são rejeitadas.

## TDD e validação

1. RED — `node --test packages/studio/test/vsl-reference.test.mjs`
   - Falhou antes da implementação com `ERR_MODULE_NOT_FOUND` para `server/vsl-reference.mjs`.
2. GREEN — `node --test packages/studio/test/vsl-reference.test.mjs`
   - 5 testes, 5 passaram, 0 falharam.
3. Regressão focal — `node --test packages/studio/test/publication-snapshot.test.mjs packages/studio/test/vsl-reference.test.mjs`
   - 7 testes, 7 passaram, 0 falharam.
4. Higiene — `git diff --check`
   - Sem erros.

## Decisões

- A Task 1 valida e resolve referências antes do renderer. A injeção do iframe no HTML renderizado permanece para a Task 4, conforme o plano.
- A ausência de uma versão publicada retorna erro 404 com status/statusCode, mantendo a fronteira HTTP existente.

## Correção após revisão

- Adicionado teste com PostgreSQL efêmero e `VideoRepository` real, cobrindo VSL sem publicação, empresa incorreta e projeto incorreto; todos retornam 404.
- `resolvePublishedVsl` agora valida sua própria `publicOrigin` e rejeita esquemas, credenciais, caminhos, query strings ou fragmentos inválidos.

### Nova validação

- `node --test packages/studio/test/vsl-reference.test.mjs`: 7 testes, 7 passaram.
- `node --test packages/studio/test/publication-snapshot.test.mjs packages/studio/test/vsl-reference.test.mjs`: executado após a correção; todos os testes passaram.
- `git diff --check`: sem erros.
