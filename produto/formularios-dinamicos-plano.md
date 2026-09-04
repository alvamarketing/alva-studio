# Formulários Dinâmicos MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar criação, edição, execução pública e recebimento de respostas de formulários sequenciais no Alva Studio.

**Architecture:** Um `FormStore` mantém definições e respostas separadas das páginas. Um gerador puro produz a experiência pública a partir do schema; a interface administrativa usa um módulo próprio e compartilha autenticação, navegação e tokens visuais do Studio.

**Tech Stack:** Node.js HTTP, JavaScript ES modules, HTML/CSS nativos e testes `node:test`.

**Spec:** `produto/formularios-dinamicos-spec.md`

## Global Constraints

- Interface e mensagens em PT-BR.
- Nenhuma dependência nova.
- Rotas administrativas exigem sessão; envio público aceita somente o schema publicado.
- Webhooks aceitam somente HTTPS e falhas não apagam a resposta local.
- Alterações seguem TDD e preservam os 54 testes existentes.

---

### Task 1: Domínio e persistência

**Files:**
- Create: `packages/studio/server/form-store.mjs`
- Test: `packages/studio/test/form-store.test.mjs`

**Interfaces:**
- Produces: `FormStore.list()`, `get(id)`, `create(input)`, `update(id, patch)`, `duplicate(id)`, `remove(id)`, `submit(id, input)`, `submissions(id)`.

- [x] Escrever testes para CRUD, revisão concorrente, schema válido e filtragem de respostas.
- [x] Executar `node --test test/form-store.test.mjs` e confirmar falha pela ausência do módulo.
- [x] Implementar persistência transacional em `forms.json` e `form-submissions.json`.
- [x] Executar o teste e confirmar aprovação.

### Task 2: Documento público sequencial

**Files:**
- Create: `packages/studio/server/dynamic-form.mjs`
- Test: `packages/studio/test/dynamic-form.test.mjs`

**Interfaces:**
- Consumes: schema retornado por `FormStore.get(id)`.
- Produces: `renderDynamicForm(form, actionUrl)` retornando HTML completo e autocontido.

- [x] Escrever testes para escape de conteúdo, progresso, navegação, campos permitidos e confirmação.
- [x] Executar `node --test test/dynamic-form.test.mjs` e confirmar falha inicial.
- [x] Implementar HTML, CSS responsivo e JavaScript linear sem dependências.
- [x] Executar o teste e confirmar aprovação.

### Task 3: API administrativa e envio público

**Files:**
- Modify: `packages/studio/server/index.mjs`
- Modify: `packages/studio/test/server.test.mjs`

**Interfaces:**
- Consumes: `FormStore` e `renderDynamicForm`.
- Produces: `/api/forms`, `/api/forms/:id`, `/api/forms/:id/duplicate`, `/api/forms/:id/submissions`, `/f/:slug` e `/api/public/forms/:id/submit`.

- [x] Escrever testes HTTP para autenticação, CRUD, página pública e submissão.
- [x] Executar o teste de servidor e confirmar que as novas rotas retornam 404.
- [x] Implementar as rotas, parser público limitado e entrega opcional do webhook HTTPS.
- [x] Executar o teste e confirmar aprovação.

### Task 4: Navegação e catálogo de formulários

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/styles.css`
- Create: `packages/studio/public/forms.js`
- Create: `packages/studio/public/forms.css`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/server/index.mjs`
- Test: `packages/studio/test/forms-ui.test.mjs`

**Interfaces:**
- Produces: `createFormsUI({ api, toast })` e navegação entre `Páginas` e `Formulários Dinâmicos`.

- [x] Escrever teste estrutural para os dois destinos, lista vazia e botão de criação.
- [x] Executar o teste e confirmar falha inicial.
- [x] Implementar navegação, cards, busca, criação, duplicação e exclusão.
- [x] Executar o teste e confirmar aprovação.

### Task 5: Editor por etapas e respostas

**Files:**
- Modify: `packages/studio/public/forms.js`
- Modify: `packages/studio/public/forms.css`
- Modify: `packages/studio/public/index.html`
- Test: `packages/studio/test/forms-ui.test.mjs`

**Interfaces:**
- Consumes: API de formulários e submissões.
- Produces: editor de etapas, prévia, configurações, link público e tabela de respostas.

- [x] Escrever testes para tipos, reordenação, exclusão, serialização e nomes acessíveis.
- [x] Executar o teste e confirmar falha inicial.
- [x] Implementar edição de etapas, configurações, salvamento, prévia e respostas.
- [x] Executar o teste e confirmar aprovação.

### Task 6: Documentação e verificação integrada

**Files:**
- Modify: `packages/studio/README.md`
- Modify: `packages/studio/public/MAPA.md`
- Modify: `packages/studio/server/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`

**Interfaces:**
- Consumes: todas as entregas anteriores.
- Produces: documentação operacional e mapa atualizado.

- [x] Documentar criação, link público, respostas e webhook.
- [x] Atualizar os três MAPAs com os novos arquivos.
- [x] Executar `node --test test/*.test.mjs` e verificações de sintaxe.
- [x] Validar no navegador criação, edição, envio e consulta de uma resposta.
