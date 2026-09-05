# Shell SaaS do Alva Studio — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar o wireframe aprovado às telas Home, Empresa e Projeto usando somente empresas, projetos, conteúdos e estados reais da fundação SaaS.

**Architecture:** O navegador recebe um módulo de estado do shell que carrega sessão, empresas, projetos e o contexto ativo antes de renderizar qualquer tela. Dois endpoints agregados entregam visões de empresa e projeto já filtradas por autorização; a interface mantém os editores atuais e usa o projeto ativo como fronteira para páginas e formulários.

**Tech Stack:** JavaScript ESM, HTML/CSS, Node.js 22, PostgreSQL, `node:test` e os editores GrapesJS existentes.

**Spec:** `docs/superpowers/specs/2026-09-04-alva-studio-saas-design.md`; referência visual: `docs/wireframes/alva-studio-ui-reference.html`.

## Global Constraints

- Preservar o símbolo oficial e o wordmark atuais da Alva Studio.
- Nenhum nome, domínio, número, plano, integração ou estado do wireframe pode aparecer como dado real sem vir da API.
- Empresa e projeto ativos sempre vêm da sessão persistente e toda troca usa `PATCH /api/session`.
- Trocar contexto limpa imediatamente conteúdo do contexto anterior antes de carregar o novo.
- Recursos ainda pendentes aparecem como “Em breve” ou “Ainda não configurado”.
- Os editores atuais continuam funcionais e salvam somente no projeto ativo confirmado.
- Desktop de referência: 1440×900. Celular de referência: 390×844, sem rolagem horizontal.
- Botões de ícone têm nome acessível; navegação expõe `aria-current`; estados assíncronos usam `role="status"` ou `role="alert"`.
- O gate final é `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`.

---

### Task 1: Estado do shell e troca segura de contexto

**Files:**
- Create: `packages/studio/public/studio-shell.js`
- Create: `packages/studio/test/studio-shell.test.mjs`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/forms.js`

**Interfaces:**
- Consumes: `GET /api/session`, `GET /api/companies`, `GET /api/projects`, `PATCH /api/session`.
- Produces: `createStudioShell({ api, beforeContextChange, onContextChanged })`, com `initialize()`, `selectCompany(companyId)`, `selectProject(projectId)`, `state()` e `can(capability)`.

- [ ] **Step 1: Escrever testes falhos do estado**

Cobrir bootstrap, empresa/projeto ativos, troca persistente, limpeza antes do carregamento seguinte, erro sem conservar dados antigos e capacidades derivadas de `owner`, `admin`, `editor`, `analyst` e `viewer`.

- [ ] **Step 2: Confirmar o RED**

Run: `node --test packages/studio/test/studio-shell.test.mjs`

Expected: falhar porque `studio-shell.js` ainda não existe.

- [ ] **Step 3: Implementar o módulo sem acessar o DOM**

O estado deve ter esta forma estável:

```js
{
  phase: 'loading' | 'ready' | 'empty' | 'error',
  session: null | SessionState,
  companies: [],
  projects: [],
  currentCompany: null | Company,
  currentProject: null | Project,
  error: ''
}
```

`selectCompany` chama `beforeContextChange`, zera projetos e projeto ativo, envia `{ companyId }`, recarrega projetos e escolhe apenas o projeto confirmado pela sessão. `selectProject` faz o mesmo com `{ companyId, projectId }`. Chamadas concorrentes antigas não podem sobrescrever o contexto mais recente.

- [ ] **Step 4: Conectar o ciclo dos editores**

Antes da troca, salvar alterações pendentes, destruir o GrapesJS quando aberto, fechar o editor dinâmico e só então alterar a sessão. O retorno de ambos os editores abre o projeto que originou o conteúdo.

- [ ] **Step 5: Rodar testes focalizados e regressão do editor**

Run: `node --test packages/studio/test/studio-shell.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs`

Expected: todos passam.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/public/studio-shell.js packages/studio/public/app.js packages/studio/public/forms.js packages/studio/test/studio-shell.test.mjs
git commit -m "feat: adiciona contexto persistente ao shell do Studio"
```

### Task 2: Overviews reais de empresa e projeto

**Files:**
- Modify: `packages/studio/server/repositories/company-repository.mjs`
- Modify: `packages/studio/server/repositories/project-repository.mjs`
- Modify: `packages/studio/server/project-api.mjs`
- Modify: `packages/studio/test/project-api.test.mjs`

**Interfaces:**
- Consumes: autorização por empresa/projeto da sessão e tabelas existentes de membros, páginas, formulários, submissões, domínios, integrações e deploys.
- Produces: `GET /api/companies/:companyId/overview` e `GET /api/projects/:projectId/overview`.

- [ ] **Step 1: Escrever testes falhos dos contratos agregados**

Empresa retorna metadados, papel atual, projetos autorizados, contagens reais e membros somente quando o papel possui `member.manage`. Projeto retorna metadados, contagens, conteúdo unificado ordenado por `updatedAt`, domínio canônico verificado e estados de integrações persistidos sem configuração sensível.

- [ ] **Step 2: Cobrir isolamento e estados vazios**

Testar outra empresa/projeto como 404, editor sem lista de membros, projeto vazio com zeros, rascunho versus publicado e ausência de `configuration`, segredos ou respostas abertas.

- [ ] **Step 3: Confirmar o RED**

Run: `node --test --test-name-pattern="overview" packages/studio/test/project-api.test.mjs`

Expected: 404 porque as rotas ainda não existem.

- [ ] **Step 4: Implementar queries agregadas autorizadas**

O overview de projeto produz:

```js
{
  project,
  counts: { pages, forms, publishedPages, publishedForms, submissions },
  content: [{ id, kind, name, route, published, updatedAt, submissionCount }],
  domain: null | { domain, verificationStatus },
  integrations: { vercel: 'pending' | 'configured', analytics: 'pending' | 'configured', agents: 'pending' | 'configured' }
}
```

O overview de empresa produz `{ company, role, counts, projects, members }`; `members` é `null` quando o papel não pode gerenciá-los. Plano e cobrança não fazem parte do contrato nesta etapa.

- [ ] **Step 5: Rodar testes de API e tenancy**

Run: `node --test --test-concurrency=1 packages/studio/test/project-api.test.mjs packages/studio/test/tenancy.test.mjs packages/studio/test/project-content.test.mjs`

Expected: todos passam.

- [ ] **Step 6: Commit**

```bash
git add packages/studio/server/repositories/company-repository.mjs packages/studio/server/repositories/project-repository.mjs packages/studio/server/project-api.mjs packages/studio/test/project-api.test.mjs
git commit -m "feat: expõe visões reais de empresa e projeto"
```

### Task 3: Home e Empresa no layout aprovado

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/styles.css`
- Modify: `packages/studio/public/app.js`
- Create: `packages/studio/test/studio-dashboard.test.mjs`

**Interfaces:**
- Consumes: `createStudioShell`, `/api/companies/:id/overview` e criação existente em `POST /api/projects`.
- Produces: regiões `#studio-home` e `#company-view`, navegação principal, seletor de empresa e diálogo de novo projeto.

- [ ] **Step 1: Escrever testes falhos de estrutura e dados**

Verificar landmarks, títulos, `aria-current`, estados loading/empty/error, cartões criados somente com objetos fornecidos ao renderizador e ausência dos exemplos ilustrativos do wireframe.

- [ ] **Step 2: Confirmar o RED**

Run: `node --test packages/studio/test/studio-dashboard.test.mjs`

Expected: falhar porque as novas regiões e renderizadores não existem.

- [ ] **Step 3: Aplicar a casca visual compartilhada**

Manter logo atual. A Home mostra saudação pelo `displayName`, empresas e projetos autorizados, ação de criar projeto conforme capacidade e atividade recente derivada de `updatedAt`. Empresa mostra nome, papel, projetos e equipe quando autorizada; plano e cobrança aparecem como “Em breve”, sem números.

- [ ] **Step 4: Implementar criação e seleção de projeto**

O diálogo valida nome e slug, envia `POST /api/projects`, seleciona o projeto criado por `PATCH /api/session` e abre sua visão geral. Loading, vazio e erro são visualmente distintos.

- [ ] **Step 5: Preservar tema e rodapé compacto**

Configurações, aparência e recolhimento continuam como três ícones igualmente espaçados. O tema claro/escuro/sistema aplica-se às novas superfícies.

- [ ] **Step 6: Rodar testes da Home/Empresa e preferências**

Run: `node --test packages/studio/test/studio-dashboard.test.mjs packages/studio/test/editor-header.test.mjs packages/studio/test/ui-preferences.test.mjs`

Expected: todos passam.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/public/index.html packages/studio/public/styles.css packages/studio/public/app.js packages/studio/test/studio-dashboard.test.mjs
git commit -m "feat: aplica Home e Empresa ao shell SaaS"
```

### Task 4: Projeto, conteúdos e responsividade

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/styles.css`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/forms.js`
- Modify: `packages/studio/test/studio-dashboard.test.mjs`
- Modify: `packages/studio/test/forms-ui.test.mjs`
- Modify: `produto/grafo.yaml`
- Create: `.estado/shell-saas.md`

**Interfaces:**
- Consumes: `GET /api/projects/:id/overview`, listas reais de páginas/formulários e callbacks existentes para abrir os editores.
- Produces: `#project-view`, navegação por visão geral/páginas/formulários e shell responsivo completo.

- [ ] **Step 1: Escrever testes falhos do projeto**

Cobrir contagens reais, conteúdo unificado, rascunho/publicado, respostas, domínio verificado, estados pendentes, estados vazios separados e abertura do editor correto.

- [ ] **Step 2: Renderizar a visão do projeto**

Usar o overview para título, slug, contadores e estrutura. A lista permite filtrar Landing pages e Formulários. Analytics, Rastreamento, Publicação e Agentes ficam visíveis como próximos módulos com estado honesto e sem ações falsas.

- [ ] **Step 3: Adaptar desktop e celular**

Em 1440×900, manter sidebar e conteúdo em duas colunas quando houver espaço. Em 390×844, usar trilho/drawer compacto, superfícies em uma coluna, alvos de 44×44 px e zero overflow horizontal. Escape fecha drawer e diálogo e devolve foco ao acionador.

- [ ] **Step 4: Homologar navegação por teclado e estados assíncronos**

Confirmar Tab, Shift+Tab, Enter, Espaço, Escape, foco visível, `aria-current`, `role="status"` e `role="alert"`.

- [ ] **Step 5: Rodar suíte completa e inspeção visual**

Run: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`

Expected: exit 0. Abrir o app em 1440×900 e 390×844; verificar Home, Empresa, Projeto, página e formulário sem rolagem horizontal ou dados ilustrativos.

- [ ] **Step 6: Registrar o gate**

Marcar `shell_saas` como `feito` em `produto/grafo.yaml` somente após a suíte e homologação. Registrar contagem de testes, viewports e limitações reais em `.estado/shell-saas.md`.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/public/index.html packages/studio/public/styles.css packages/studio/public/app.js packages/studio/public/forms.js packages/studio/test/studio-dashboard.test.mjs packages/studio/test/forms-ui.test.mjs produto/grafo.yaml .estado/shell-saas.md
git commit -m "feat: conclui o painel SaaS por projeto"
```
