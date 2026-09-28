# test

- `store.test.mjs`: persistência, cópias e concorrência.
- `server.test.mjs`: HTTP, proteção de acesso, locale, grafo de módulos públicos e boot SaaS.
- `save-cycle.test.mjs`: salvamento durante edição.
- `publisher.test.mjs`: contrato Vercel com transporte simulado.
- `publication-snapshot.test.mjs` e `publication-integration.test.mjs`: snapshot, isolamento e cofre de conexão por projeto.
- `publication-deployment.test.mjs`: idempotência, claim atômico, estados Vercel e publicação multi rota com retry seguro.
- `publication-cors.test.mjs`: origens autorizadas para as capturas publicadas por projeto.
- `publication-service.test.mjs` e `publication-api.test.mjs`: fronteira de produção confirmada e APIs por projeto.
- `studio-dashboard.test.mjs`: estados simples e responsividade da seção Publicação.

- `access.test.mjs`: papéis, capacidades, slugs e rotas públicas permitidas.
- `database-schema.test.mjs`: migrações PostgreSQL, isolamento estrutural, versões e integridade do schema.
- `postgres-fixture.mjs`: PostgreSQL efêmero usado pelas integrações automatizadas.
- `tenancy.test.mjs`: empresas, memberships, convites, concessões e autorização entre tenants.
- `project-content.test.mjs`: páginas e quizzes, versões, rotas e respostas por projeto.
- `project-api.test.mjs`: sessão persistente, API de empresas/projetos e bloqueio de acessos cruzados.
- `vsl-repository.test.mjs` e `vsl-api.test.mjs`: VSLs, snapshots, validação e rotas autenticadas por projeto.
- `analytics-api.test.mjs`, `analytics-collect.test.mjs`, `analytics-csp.test.mjs`, `analytics-http.test.mjs`, `analytics-panel.test.mjs`, `analytics-repository.test.mjs` e `analytics-tracker.test.mjs`: contrato do coletor, isolamento, PII, CORS, CSP, persistência, retenção, resumo e painel.
- `runtime-flags.test.mjs`: opt-in restritivo das flags comerciais e estado inicial seguro dos motores internos.
- `billing.test.mjs`, `billing-repository.test.mjs`, `billing-service.test.mjs`, `billing-webhook.test.mjs`, `billing-worker.test.mjs`, `billing-api.test.mjs` e `billing-policy.test.mjs`: contrato Asaas recorrente, pedido idempotente, checkout, inbox autenticada de 64 KB, reconciliação, rotas públicas/autenticadas e cota transacional.
- `mcp.test.mjs` e `mcp-ui.test.mjs`: chaves por projeto sem segredo persistido, protocolo JSON-RPC, idempotência, rate limit persistente, isolamento, catálogo fechado e tela de conexão.
- `commercial-certification.test.mjs`: matriz descartável local da V1 com dois tenants, fakes injetados e prova de backup/restauração PostgreSQL sem egress.
- `runtime-health.test.mjs`: endpoints de saúde e contrato estático da composição Docker, backup e restauração.
- `tracking-provision.test.mjs`: bindings por ambiente, leases, tentativas, criptografia com escopo, destinos NVS e gate de publicação.
- `nvs-commercial-outbox.test.mjs`: outbox comercial, hash de contato, deduplicação por propriedade/evento/destino, HMAC e retry sanitizado.
- `publication-runtime.test.mjs`, `runtime-consent-gateway.test.mjs` e `runtime-gateway-security.test.mjs`: manifesto, consentimento server-side, replay PostgreSQL e E2E HTTP assinado.
- `vercel-runtime-gateway.test.mjs`: artefatos da Function, chave derivada, rewrites e captura de corpo/cookie sem egress Vercel.
- `conversion-consent-policy.test.mjs` e `commercial-conversion-service.test.mjs`: allowlists, estados de consentimento e fan-out 5×3.

- `templates.test.mjs`: galeria de modelos e folha do formulário da página (`formCss`).
- `editor*.test.mjs`: controles do editor guiado.
- `auth*.test.mjs`: conta, sessões e proteção das configurações.
- `owner.test.mjs`: contrato do fluxo de acesso e administração.
- `editor-header.test.mjs`: ícones acessíveis e tokens oficiais da Alva no cabeçalho.
- `ui-preferences.test.mjs`: aparência claro/escuro/sistema e estado recolhido da barra lateral.
- `validacao-da-rota-do-quiz.test.mjs`: o servidor refaz o caminho do quiz e recusa resposta de etapa pulada.
