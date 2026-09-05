# server

- `index.mjs`: servidor HTTP, mapa dos módulos públicos e entrypoints SaaS (PostgreSQL obrigatório) e legado explícito para migração/rollback.
- `db/`: adaptador PostgreSQL e migrações ordenadas do schema SaaS.
  - `postgres.mjs`: pool, transações e executor idempotente de migrações com checksum.
  - `migrations/001_saas_foundation.sql`: empresas, memberships, projetos, conteúdo, versões, integrações e auditoria.
  - `migrations/002_invitations.sql`: convites de membros.
  - `migrations/003_published_content_routes.sql`: rota preservada nos snapshots publicados.
  - `migrations/004_local_imports.sql`: registro idempotente de importações locais.
  - `migrations/005_session_project_context.sql`: projeto atual persistido na sessão.
- `domain/access.mjs`: papéis, capacidades e normalização de slugs e rotas.
- `repositories/`: consultas de empresas, projetos e conteúdo sempre limitadas à empresa e ao projeto autorizados.
- `session-service.mjs`: contas, sessões persistentes, contexto de empresa/projeto e revogação.
- `project-api.mjs`: API multiempresa e compatibilidade das rotas atuais do editor.
- `outbound-webhook.mjs`: valida somente sintaxe HTTPS sem credenciais; resolução DNS, proteção contra SSRF/rebinding e entrega assíncrona ficam pendentes e não há egress nesta fundação.
- `import-local.mjs`: inspeção validada e importação transacional/idempotente dos quatro JSONs locais.
- `store.mjs` e `form-store.mjs`: armazenamento local legado que permanece como fonte de compatibilidade e migração.
- `dynamic-form.mjs`: documento público sequencial com mídia, gráficos, movimento e confirmação de envio.
- `publisher.mjs`: chamadas Vercel do modo local; publicação Vercel por projeto SaaS permanece pendente.
- `auth.mjs`: conta única, sessões e credencial Vercel cifrada em disco do modo local legado.
