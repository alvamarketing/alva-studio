---
no: fundacao_saas
status: feito
---

# Fundação SaaS

A fundação PostgreSQL está implementada com as migrações `001` a `005`, empresas, memberships, projetos, conteúdo isolado, sessões persistentes e importação local idempotente. Formulários publicados usam `/f/<empresa>/<projeto>/<formulario>`; em domínio conectado, somente a experiência pública e a submissão ficam acessíveis.

Webhooks aceitam apenas URL HTTPS sem credenciais nesta etapa. A entrega fica `pending`, sem egress; resolução DNS, proteção contra SSRF e DNS rebinding, fila e worker serão validados antes de qualquer entrega remota.

Gate final concluído em 2026-09-04 com `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`: 123 testes aprovados. O gate cobre isolamento entre duas empresas em leitura, escrita, exclusão, respostas, rotas públicas e configurações de integração. `git diff --check` também foi concluído sem diferenças de espaço inválidas.
