---
status: feito
atualizado_em: 2026-09-04
---

# Fundação SaaS

A fundação PostgreSQL está implementada com as migrações `001` a `005`, empresas, memberships, projetos, conteúdo isolado, sessões persistentes e importação local idempotente. Formulários publicados usam `/f/<empresa>/<projeto>/<formulario>`; em domínio conectado, somente a experiência pública e a submissão ficam acessíveis.

Gate final concluído em 2026-09-04 com `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`: 117 testes aprovados. O gate cobre isolamento entre duas empresas em leitura, escrita, exclusão, respostas, rotas públicas e configurações de integração. `git diff --check` também foi concluído sem diferenças de espaço inválidas.
