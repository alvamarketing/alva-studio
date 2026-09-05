# Alva Studio SaaS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a fundação transacional de empresas, membros e projetos, migrar o conteúdo local sem perda e expor APIs isoladas por tenant.

**Architecture:** O servidor Node mantém os normalizadores e renderizadores atuais, mas acessa PostgreSQL por repositórios explícitos. Sessões derivam empresa e capacidades; páginas e formulários recebem `projectId`, enquanto o documento GrapesJS passa a se chamar `editorState`. O importador local é idempotente e o JSON vira somente snapshot de rollback.

**Tech Stack:** Node.js 22+, JavaScript ESM, PostgreSQL, `pg`, HTML/CSS/JavaScript nativos, GrapesJS 0.23.6 e `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-04-alva-studio-saas-design.md`

## Global Constraints

- Toda consulta administrativa é limitada por empresa e projeto derivados da sessão.
- Acesso cruzado entre empresas responde 404.
- `project` deixa de representar o documento GrapesJS em contratos novos; usar `editorState`.
- IDs existentes de páginas, formulários e respostas são preservados na importação.
- Escritas concorrentes usam `lock_version` e atualização condicional.
- Segredos não entram no banco em texto aberto, no navegador, em logs ou em fixtures.
- Os 78 testes atuais continuam passando durante a migração.
- Alterações de comportamento seguem o ciclo teste falhando, implementação mínima e teste passando.

---

### Task 1: Vocabulário, papéis e capacidades

**Files:**
- Create: `packages/studio/server/domain/access.mjs`
- Test: `packages/studio/test/access.test.mjs`

**Interfaces:**
- Produces: `ROLES`, `CAPABILITIES`, `capabilitiesFor(role)`, `hasCapability(role, capability)`, `normalizeProjectSlug(value)` e `normalizeRoute(value)`.
- Consumes: nenhuma interface anterior.

- [ ] **Step 1: Escrever os testes de papéis, slugs e rotas**

```js
test('editor escreve conteúdo atribuído mas não publica', () => {
  assert.equal(hasCapability('editor', 'page.write'), true);
  assert.equal(hasCapability('editor', 'deployment.publish'), false);
});

test('normaliza rotas e rejeita caminhos reservados', () => {
  assert.equal(normalizeRoute(' Imobiliárias/ '), '/imobiliarias');
  assert.equal(normalizeRoute('/'), '/');
  assert.throws(() => normalizeRoute('/api/leads'), /reservada/);
});
```

- [ ] **Step 2: Executar o teste e confirmar falha pela ausência do módulo**

Run: `node --test packages/studio/test/access.test.mjs`
Expected: FAIL com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar mapas imutáveis e normalizadores puros**

```js
export const ROLES = Object.freeze(['owner', 'admin', 'editor', 'analyst']);
export const CAPABILITIES = Object.freeze({
  owner: Object.freeze(['company.manage', 'billing.manage', 'member.manage', 'project.manage', 'page.write', 'form.write', 'submission.read', 'integration.manage', 'deployment.publish']),
  admin: Object.freeze(['member.manage', 'project.manage', 'page.write', 'form.write', 'submission.read', 'integration.manage', 'deployment.publish']),
  editor: Object.freeze(['page.write', 'form.write', 'submission.read']),
  analyst: Object.freeze(['submission.read', 'analytics.read']),
});
```

Normalizar texto com Unicode NFD, remover diacríticos, converter para minúsculas e hífens. `normalizeRoute` aceita `/` e rejeita segmentos vazios, `.`/`..`, caracteres fora de `a-z0-9-`, caminhos acima de 120 caracteres e prefixos `/api`, `/_next`, `/.well-known`, `/admin` e `/f`.

- [ ] **Step 4: Executar o teste específico e a suíte atual**

Run: `node --test packages/studio/test/access.test.mjs packages/studio/test/*.test.mjs`
Expected: PASS, sem regressões.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/server/domain/access.mjs packages/studio/test/access.test.mjs
git commit -m "feat: define acesso e rotas dos projetos"
```

### Task 2: Schema PostgreSQL e executor de migrações

**Files:**
- Modify: `packages/studio/package.json`
- Modify: `packages/studio/pnpm-lock.yaml`
- Create: `packages/studio/server/db/migrations/001_saas_foundation.sql`
- Create: `packages/studio/server/db/postgres.mjs`
- Create: `packages/studio/test/postgres-fixture.mjs`
- Test: `packages/studio/test/database-schema.test.mjs`

**Interfaces:**
- Consumes: papéis e nomenclatura da Task 1.
- Produces: `createDatabase({ connectionString })`, `migrate(database)` e `withTransaction(database, fn)`.

- [ ] **Step 1: Adicionar `pg` ao pacote Studio**

Run: `pnpm --filter @alva/studio add pg`
Expected: manifesto e lockfile atualizados.

- [ ] **Step 2: Criar fixture PostgreSQL descartável e teste inicialmente vermelho**

O helper inicia um contêiner `postgres:alpine` em porta aleatória, espera `pg_isready`, cria a conexão e remove o contêiner em `t.after`. O teste consulta `information_schema.tables` e exige as tabelas `users`, `companies`, `company_memberships`, `project_grants`, `sessions`, `projects`, `pages`, `page_versions`, `forms`, `form_versions`, `form_submissions`, `project_domains`, `project_integrations`, `company_secrets`, `deployment_runs` e `audit_events`.

Run: `node --test packages/studio/test/database-schema.test.mjs`
Expected: FAIL porque o migrador e o schema ainda não existem.

- [ ] **Step 3: Criar schema com UUIDs, JSONB, índices e restrições**

O SQL inclui:

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  name varchar(100) NOT NULL,
  slug varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);

CREATE UNIQUE INDEX pages_active_route
ON pages(project_id, lower(route)) WHERE deleted_at IS NULL;
```

`pages.editor_state` e schemas de formulário são JSONB. `lock_version` começa em zero. Respostas guardam `tracking_event_id` UUID único. Chaves estrangeiras carregam a empresa de forma verificável por junções e índices.

- [ ] **Step 4: Implementar executor idempotente de migrações**

`migrate` cria `schema_migrations`, calcula SHA-256 do arquivo, aplica cada versão dentro de transação e falha se uma versão já aplicada tiver checksum diferente.

- [ ] **Step 5: Executar integração duas vezes e provar idempotência**

Run: `node --test packages/studio/test/database-schema.test.mjs`
Expected: PASS nas duas chamadas de `migrate`.

- [ ] **Step 6: Executar a suíte Studio**

Run: `node --test packages/studio/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/package.json packages/studio/pnpm-lock.yaml packages/studio/server/db packages/studio/test/postgres-fixture.mjs packages/studio/test/database-schema.test.mjs
git commit -m "feat: adiciona fundacao PostgreSQL do Studio"
```

### Task 3: Repositórios de empresa, membros e projetos

**Files:**
- Create: `packages/studio/server/repositories/company-repository.mjs`
- Create: `packages/studio/server/repositories/project-repository.mjs`
- Test: `packages/studio/test/tenancy.test.mjs`

**Interfaces:**
- Consumes: `createDatabase`, `withTransaction`, `normalizeProjectSlug` e capacidades.
- Produces: `CompanyRepository.create`, `invite`, `acceptInvitation`, `members`; `ProjectRepository.create`, `listForUser`, `getAuthorized`, `update`, `archive`, `grantAccess`.

- [ ] **Step 1: Escrever teste com duas empresas e três usuários**

O teste cria proprietário A, editor A e proprietário B. Ele prova que o editor vê somente projetos concedidos da empresa A, que o proprietário B recebe 404 ao consultar o projeto A e que um administrador não promove alguém a proprietário.

- [ ] **Step 2: Executar e confirmar falha pela ausência dos repositórios**

Run: `node --test packages/studio/test/tenancy.test.mjs`
Expected: FAIL com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar consultas sempre ancoradas na membership**

```sql
SELECT p.*
FROM projects p
JOIN company_memberships m
  ON m.company_id = p.company_id
 AND m.user_id = $2
 AND m.status = 'active'
LEFT JOIN project_grants g
  ON g.project_id = p.id AND g.user_id = $2
WHERE p.id = $1
  AND (m.role IN ('owner', 'admin') OR g.user_id IS NOT NULL)
  AND p.status <> 'deleted';
```

Nenhum método carrega por ID global e autoriza depois.

- [ ] **Step 4: Implementar convite com segredo mostrado uma vez**

Gerar 32 bytes aleatórios, armazenar SHA-256, validade de sete dias e retornar o segredo somente na criação. Aceite usa comparação segura e transação.

- [ ] **Step 5: Executar testes de tenancy e suíte**

Run: `node --test packages/studio/test/tenancy.test.mjs packages/studio/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/repositories packages/studio/test/tenancy.test.mjs
git commit -m "feat: isola empresas membros e projetos"
```

### Task 4: Conteúdo vinculado ao projeto

**Files:**
- Create: `packages/studio/server/repositories/content-repository.mjs`
- Test: `packages/studio/test/project-content.test.mjs`

**Interfaces:**
- Consumes: banco, `normalizeRoute` e autorização de projeto.
- Produces: CRUD de páginas e formulários com `{ companyId, projectId, actorId }`, revisões condicionais e snapshots publicados.

- [ ] **Step 1: Escrever testes de isolamento, rota e concorrência**

Provar: rotas únicas ignorando caixa; `/` permitido uma vez; recurso da empresa B retorna 404; duas alterações com `lockVersion = 0` resultam em uma aprovação e um conflito 409; rascunho de formulário não altera a versão pública.

- [ ] **Step 2: Executar e confirmar falha inicial**

Run: `node --test packages/studio/test/project-content.test.mjs`
Expected: FAIL pela ausência do repositório.

- [ ] **Step 3: Implementar página com `editorState` e atualização condicional**

```sql
UPDATE pages
SET name = $4, route = $5, editor_state = $6, rendered_html = $7,
    lock_version = lock_version + 1, updated_at = now()
WHERE id = $1 AND project_id = $2 AND company_id = $3
  AND lock_version = $8 AND deleted_at IS NULL
RETURNING *;
```

Zero linhas retornadas exige consulta igualmente escopada para distinguir 404 de 409.

- [ ] **Step 4: Implementar versões públicas imutáveis**

Publicar página cria `page_versions`. Publicar formulário cria `form_versions` e atualiza `published_version_id`. A rota pública lê somente a versão publicada.

- [ ] **Step 5: Executar testes e suíte**

Run: `node --test packages/studio/test/project-content.test.mjs packages/studio/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/repositories/content-repository.mjs packages/studio/test/project-content.test.mjs
git commit -m "feat: vincula conteudo e versoes aos projetos"
```

### Task 5: Importador idempotente dos arquivos locais

**Files:**
- Create: `packages/studio/server/import-local.mjs`
- Test: `packages/studio/test/import-local.test.mjs`

**Interfaces:**
- Consumes: repositórios das Tasks 3 e 4 e normalizadores atuais.
- Produces: `inspectLocalData(dir)`, `importLocalData({ dir, database, ownerPassword })` e relatório com contagens/checksums.

- [ ] **Step 1: Criar fixture com owner, duas páginas, um formulário e duas respostas**

O teste preserva UUID, revisão e datas; exige `editorState` igual ao antigo `page.project`; associa tudo a uma empresa e projeto padrão; compara SHA-256 e executa a importação duas vezes sem duplicar linhas.

- [ ] **Step 2: Executar e confirmar falha inicial**

Run: `node --test packages/studio/test/import-local.test.mjs`
Expected: FAIL pela ausência do importador.

- [ ] **Step 3: Implementar inspeção sem escrita**

`inspectLocalData` lê somente `owner.json`, `pages.json`, `forms.json` e `form-submissions.json`, valida arrays, calcula tamanho e SHA-256 e devolve problemas antes de abrir transação.

- [ ] **Step 4: Implementar importação transacional e registro de checksum**

Criar `local_imports(checksum primary key, company_id, project_id, imported_at, report jsonb)`. A mesma soma retorna o relatório existente. Qualquer falha reverte empresa, projeto e conteúdo.

- [ ] **Step 5: Executar teste, dry run e suíte**

Run: `node --test packages/studio/test/import-local.test.mjs packages/studio/test/*.test.mjs`
Expected: PASS e nenhuma fixture fora do diretório temporário.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/import-local.mjs packages/studio/test/import-local.test.mjs packages/studio/server/db/migrations/001_saas_foundation.sql
git commit -m "feat: importa Studio local para empresas e projetos"
```

### Task 6: Sessões persistentes e APIs de empresa/projeto

**Files:**
- Create: `packages/studio/server/session-service.mjs`
- Create: `packages/studio/server/project-api.mjs`
- Modify: `packages/studio/server/index.mjs`
- Test: `packages/studio/test/project-api.test.mjs`
- Modify: `packages/studio/test/auth.test.mjs`

**Interfaces:**
- Consumes: repositórios, capacidades e tabelas de sessão.
- Produces: `/api/session`, `/api/companies`, `/api/companies/:companyId/members`, `/api/projects`, `/api/projects/:projectId`, `/api/projects/:projectId/pages` e `/api/projects/:projectId/forms`.

- [ ] **Step 1: Escrever testes HTTP com dois cookies e duas empresas**

O teste prova login persistente após reiniciar o servidor, troca explícita de empresa/projeto, 404 cruzado, 403 por capacidade, cookie `HttpOnly`, expiração e revogação.

- [ ] **Step 2: Executar e confirmar falha no novo contrato de sessão**

Run: `node --test packages/studio/test/project-api.test.mjs`
Expected: FAIL porque a sessão atual não devolve usuário, empresas e projeto.

- [ ] **Step 3: Implementar sessões com token opaco e hash no banco**

O cookie contém 32 bytes aleatórios em base64url. A tabela guarda SHA-256, usuário, empresa atual, projeto atual, expiração e revogação. Troca de senha e remoção da empresa revogam as sessões afetadas.

- [ ] **Step 4: Extrair o roteamento do projeto para módulo dedicado**

`project-api.mjs` recebe serviços injetados e responde somente depois de `sessionService.require(req)` e `authorize(context, capability, projectId)`.

- [ ] **Step 5: Manter rotas antigas apenas para a empresa/projeto atual**

Durante a migração, `/api/pages` e `/api/forms` chamam o mesmo repositório com o contexto atual. A resposta adiciona `projectId` e `editorState`; a entrada aceita `project` antigo somente no importador, nunca na API nova.

- [ ] **Step 6: Executar testes específicos e suíte completa**

Run: `node --test packages/studio/test/project-api.test.mjs packages/studio/test/auth.test.mjs packages/studio/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/server/session-service.mjs packages/studio/server/project-api.mjs packages/studio/server/index.mjs packages/studio/test/project-api.test.mjs packages/studio/test/auth.test.mjs
git commit -m "feat: expõe empresas e projetos com sessões persistentes"
```

### Task 7: Documentação, mapa e gate de isolamento

**Files:**
- Modify: `packages/studio/README.md`
- Modify: `packages/studio/MAPA.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`
- Modify: `produto/briefing.md`
- Modify: `produto/grafo.yaml`
- Create: `.estado/fundacao-saas.md`

**Interfaces:**
- Consumes: todas as entregas anteriores.
- Produces: contrato operacional documentado e gate reproduzível.

- [ ] **Step 1: Documentar desenvolvimento PostgreSQL e importação local**

Incluir preparação do banco, migrações, dry run, backup, importação, rollback, reconexão Vercel e troca obrigatória de sessão.

- [ ] **Step 2: Atualizar os MAPAs e a trilha do produto**

O grafo passa a declarar PostgreSQL, autenticação multiusuário e painel SaaS. Nós já comprovados mantêm comandos reais; novos nós seguem fundação, shell, editores, publicação, tracking, agentes e cobrança.

- [ ] **Step 3: Executar o gate completo**

Run: `node --test packages/studio/test/*.test.mjs`
Expected: PASS, incluindo duas empresas tentando ler, editar, excluir, publicar e consultar respostas umas das outras.

- [ ] **Step 4: Validar documentação e diferenças**

Run: `git diff --check`
Expected: exit 0.

- [ ] **Step 5: Registrar estado comprovado**

`.estado/fundacao-saas.md` usa `status: feito` somente depois do gate verde e registra o comando executado.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/README.md packages/studio/MAPA.md packages/studio/server/MAPA.md packages/studio/test/MAPA.md produto docs/superpowers .estado/fundacao-saas.md MAPA.md
git commit -m "docs: registra fundacao SaaS do Alva Studio"
```
