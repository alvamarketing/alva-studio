# test

- `store.test.mjs`: persistência, cópias e concorrência.
- `server.test.mjs`: HTTP, proteção de acesso, locale, grafo de módulos públicos e boot SaaS.
- `save-cycle.test.mjs`: salvamento durante edição.
- `publisher.test.mjs`: contrato Vercel com transporte simulado.
- `publication-snapshot.test.mjs` e `publication-integration.test.mjs`: snapshot, isolamento e cofre de conexão por projeto.
- `publication-deployment.test.mjs`: idempotência, claim atômico, estados Vercel e publicação multi rota com retry seguro.
- `publication-cors.test.mjs`: origens autorizadas para formulários publicados por projeto.
- `publication-service.test.mjs` e `publication-api.test.mjs`: fronteira de produção confirmada e APIs por projeto.
- `studio-dashboard.test.mjs`: estados simples e responsividade da seção Publicação.

- `access.test.mjs`: papéis, capacidades, slugs e rotas públicas permitidas.
- `database-schema.test.mjs`: migrações PostgreSQL, isolamento estrutural, versões e integridade do schema.
- `postgres-fixture.mjs`: PostgreSQL efêmero usado pelas integrações automatizadas.
- `tenancy.test.mjs`: empresas, memberships, convites, concessões e autorização entre tenants.
- `project-content.test.mjs`: páginas, formulários, versões, rotas e respostas por projeto.
- `import-local.test.mjs`: inspeção, importação idempotente e rollback transacional do legado local.
- `project-api.test.mjs`: sessão persistente, API de empresas/projetos e bloqueio de acessos cruzados.
- `vsl-repository.test.mjs` e `vsl-api.test.mjs`: VSLs, snapshots, validação e rotas autenticadas por projeto.
- `analytics-api.test.mjs`, `analytics-collect.test.mjs`, `analytics-csp.test.mjs`, `analytics-http.test.mjs`, `analytics-panel.test.mjs`, `analytics-repository.test.mjs` e `analytics-tracker.test.mjs`: contrato do coletor, isolamento, PII, CORS, CSP, persistência, retenção, resumo e painel.
- `runtime-flags.test.mjs`: opt-in restritivo das flags comerciais e estado inicial seguro dos motores internos.
- `runtime-health.test.mjs`: endpoints de saúde e contrato estático da composição Docker, backup e restauração.

- `templates.test.mjs`: catálogo e consistência dos formulários.
- `editor*.test.mjs`: controles do editor guiado.
- `auth*.test.mjs`: conta, sessões e proteção das configurações.
- `owner.test.mjs`: contrato do fluxo de acesso e administração.
- `editor-header.test.mjs`: ícones acessíveis e tokens oficiais da Alva no cabeçalho.
- `ui-preferences.test.mjs`: aparência claro/escuro/sistema e estado recolhido da barra lateral.
- `form-store.test.mjs`: CRUD, schema e respostas dos formulários dinâmicos.
- `dynamic-form.test.mjs`: geração segura da experiência pública sequencial, elementos ricos e movimento.
- `forms-ui.test.mjs`: navegação, catálogo rico e operações do editor por etapas.
