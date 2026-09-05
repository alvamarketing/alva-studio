# Editores SaaS do Alva Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Aplicar a casca de edição SaaS aos editores de landing pages e formulários: árvore única de elementos, canvas/prévia e inspetor contextual, com teclado e celular completos.

**Architecture:** Não alterar HTTP, banco, publicação ou integrações. Um controlador puro compartilha o estado das três regiões e das abas móveis. GrapesJS continua sendo a fonte da árvore de landing pages; o schema atual do formulário continua sendo a fonte da árvore de jornadas. Cada editor adapta sua fonte, sincroniza seleção com canvas/prévia e conserva botões de mover como alternativa ao arrastar.

**Tech Stack:** Node.js 22, JavaScript ESM, GrapesJS 0.23.6, DOM nativo, CSS e node:test.

**Spec:** docs/superpowers/specs/2026-09-04-alva-studio-saas-design.md (6.2, 6.3, 7, 9 e 10), docs/wireframes/alva-studio-ui-reference.html, produto/grafo.yaml (editores_saas) e docs/superpowers/plans/2026-09-04-shell-saas.md.

## Global Constraints

- Preservar a logo, controles e preferências do shell aprovado. O retorno dos editores abre o projeto de origem; troca de contexto continua salvando/fechando os editores e invalidando listas por studio-context-boundary.js.
- O projeto ativo confirmado pela sessão continua sendo a única fonte para GET e PUT de páginas e formulários. Não criar rotas, migrations, mocks persistentes ou outro formato para editorState ou draftSchema.
- Não copiar nomes, métricas, domínios ou conteúdo ilustrativo do wireframe para a aplicação.
- A árvore é a única representação de hierarquia. A seleção da árvore e canvas/prévia é sempre a mesma; só o elemento selecionado recebe destaque no canvas/prévia. Catálogos podem inserir elementos, mas não podem ser uma segunda árvore.
- Drag and drop fica opcional. Reordenar deve funcionar com botões operáveis por teclado, limites desabilitados e anúncio no status. Escape preserva a limpeza de seleção da landing; Delete e Backspace não atuam em campos editáveis.
- No celular, Estrutura, Canvas e Editar são abas. A região inativa sai da ordem de tabulação com hidden/inert; a ativa usa aria-selected e aria-controls. Tab, Shift+Tab, Enter, Espaço, setas, Home e End precisam funcionar.
- Não adicionar publicação, domínio, Vercel, mídia/CDN, tracking, analytics, agentes, cobrança ou módulos novos. Os controles existentes do cabeçalho não ganham chamadas ou permissões novas.
- Ações de página e formulário continuam condicionadas a page.write e form.write; não criar uma UI que pareça salvar para uma pessoa sem permissão.
- Toda tarefa começa pelo teste que falha e termina no teste focalizado verde. Não marcar editores_saas como feito antes da suíte e inspeção visual final.

---

### Task 1: Definir o contrato compartilhado das regiões e abas

**Files:**
- Create: packages/studio/public/editor-workspace.js
- Create: packages/studio/test/editor-workspace.test.mjs

**Interfaces:**
- Exportar EDITOR_WORKSPACE_PANELS como ['structure', 'canvas', 'inspector'].
- Exportar normalizeWorkspacePanel(panel); valor inválido retorna canvas.
- Exportar workspaceState(panel), que retorna activePanel e os painéis com id, label e selected. Os rótulos são Estrutura, Canvas e Editar.
- Exportar workspaceKeyAction(event, activePanel), que retorna a aba para ArrowLeft, ArrowRight, Home e End; demais teclas retornam null.

- [ ] **Step 1: Escrever o teste vermelho**

Em editor-workspace.test.mjs, testar ordem e rótulos estáveis, normalização de entrada ausente/desconhecida, uma única aba selecionada, ciclo nas setas e Home/End. Confirmar que tecla não relacionada retorna null para não interceptar os atalhos ou campos dos editores.

- [ ] **Step 2: Confirmar o RED**

Run: node --test packages/studio/test/editor-workspace.test.mjs

Expected: falha de importação enquanto o módulo não existir.

- [ ] **Step 3: Implementar o módulo puro**

Implementar as exportações sem DOM, estado global ou leitura de viewport. Cada editor mantém o próprio painel ativo; o módulo só fornece o contrato testável.

- [ ] **Step 4: Verificar e commitar**

Run: node --test packages/studio/test/editor-workspace.test.mjs

Expected: todos passam.

Commit: git add packages/studio/public/editor-workspace.js packages/studio/test/editor-workspace.test.mjs && git commit -m "feat: compartilha estado das regiões dos editores"

### Task 2: Tornar landing page uma árvore, canvas e inspetor sincronizados

**Files:**
- Modify: packages/studio/public/editor-shell.js
- Modify: packages/studio/public/editor-shell.css
- Modify: packages/studio/test/editor-controls.test.mjs
- Modify: packages/studio/test/editor-header.test.mjs

**Interfaces:**
- createFriendlyEditor mantém a assinatura e continua retornando a instância GrapesJS.
- Exportar componentTreeNodes(wrapper, selected) e treeKeyAction(event, visibleIds, selectedId).
- componentTreeNodes produz lista pré-ordem de id, label, level e selected, derivada de componentes GrapesJS. O adaptador mantém Map local de id para componente real; a árvore jamais entra no projeto salvo.

- [ ] **Step 1: Escrever o teste vermelho da árvore**

Em editor-controls.test.mjs, montar componentes mínimos com get, components, is, parent, index e identificador. Verificar pai/filho, ordem, seleção exclusiva e navegação com setas/Home/End. Confirmar que treeKeyAction não devolve ação de Delete ou Backspace.

Adicionar verificações de fonte/CSS para role=tree, treeitem com aria-level e aria-selected, catálogo separado semanticamente e regiões structure, canvas e inspector. Em editor-header.test.mjs, confirmar que voltar, nome, status, dispositivo, configurações, prévia, download, salvar e publicar preservam seus rótulos acessíveis.

- [ ] **Step 2: Confirmar o RED**

Run: node --test packages/studio/test/editor-controls.test.mjs packages/studio/test/editor-header.test.mjs

Expected: falha pela ausência da árvore e das três regiões.

- [ ] **Step 3: Reorganizar o editor GrapesJS**

Em createFriendlyEditor, substituir a grade de duas colunas por:
1. Estrutura: título, árvore recursiva e catálogo atual em details.
2. Canvas: desfazer/refazer, canvas GrapesJS e status.
3. Editar: propriedades do selecionado e ações atuais de mover, selecionar grupo, duplicar e excluir.

render reconstrói a árvore por editor.getWrapper e usa editor.getSelected para treeitem ativo, outline do GrapesJS e inspetor. Clique/Enter/Espaço no item chama editor.select(component, { scroll: true }). Setas/Home/End usam treeKeyAction, selecionam o item e devolvem foco ao botão da árvore. Selecionar o wrapper mostra catálogo e não cria segunda lista de componentes.

Preservar safeDestination, CSP do frame, bloqueio de scripts/form submit, normalizeForms, blocos, upload, histórico, editorKeyboardAction, status e destroy.

- [ ] **Step 4: Aplicar o layout desktop**

Em editor-shell.css, usar grid desktop minmax(220px, 280px), minmax(0, 1fr), minmax(260px, 340px), rolagem interna em árvore/inspetor e canvas sem largura mínima que provoque overflow. Manter tokens de cor e tipografia atuais. Nenhum elemento não selecionado recebe outline no canvas.

- [ ] **Step 5: Verificar e commitar**

Run: node --test packages/studio/test/editor-controls.test.mjs packages/studio/test/editor-header.test.mjs

Expected: todos passam, inclusive URL segura e atalhos existentes.

Commit: git add packages/studio/public/editor-shell.js packages/studio/public/editor-shell.css packages/studio/test/editor-controls.test.mjs packages/studio/test/editor-header.test.mjs && git commit -m "feat: aplica árvore e inspetor ao editor de landing pages"

### Task 3: Aplicar árvore única e inspetor contextual aos formulários

**Files:**
- Modify: packages/studio/public/forms.js
- Modify: packages/studio/public/forms.css
- Modify: packages/studio/test/forms-ui.test.mjs

**Interfaces:**
- Manter exports createStep, createScreen, moveStep, parseOptions e createFormsUI.
- Exportar formTreeNodes({ headerElements, steps, selected, selectedElement, editingHeader }) e formTreeSelection(node).
- createFormsUI mantém api, toast, onReturnToProject e can, além do formato de steps, headerElements, completion e webhook enviado por PUT.

- [ ] **Step 1: Escrever o teste vermelho do modelo da árvore**

Em forms-ui.test.mjs, verificar que formTreeNodes produz um único topo fixo, todas as telas na ordem atual e elementos aninhados sob topo/tela. Verificar que formTreeSelection produz exatamente editingHeader, selected e selectedElement. Confirmar que moveStep continua imutável e é a única operação de movimento.

Exigir um role=tree único, treeitem com níveis e ARIA, prévia central, inspetor direito e botões de mover/duplicar/excluir com nomes acessíveis. Exigir que a lista de elementos deixe de duplicar hierarquia no inspetor.

- [ ] **Step 2: Confirmar o RED**

Run: node --test packages/studio/test/forms-ui.test.mjs

Expected: falha pelos novos exports e pela estrutura duplicada.

- [ ] **Step 3: Renderizar jornada como árvore**

Em renderEditor, montar Estrutura com topo fixo, telas e elementos aninhados; manter catálogos de telas/elementos em details. Seleção da árvore usa formTreeSelection. Clique na prévia continua usando a mesma seleção e atualiza árvore.

Editar mantém campos de tela e elemento, configuração existente e controles de mover/duplicar/excluir; remover somente a lista que duplicava a hierarquia. Desabilitar movimento nos extremos.

Preservar ensureScreens para dados legados, tipos/presets atuais, parseOptions, escape, schema, lock/revision, save no retorno, respostas, link público e retorno ao projeto. Não criar drag-and-drop.

- [ ] **Step 4: Ajustar a grade desktop**

Em forms.css, aplicar a mesma proporção de três regiões da landing. Árvore e inspetor rolam internamente; prévia não gera scroll horizontal e destaca apenas o elemento ativo. Não usar conteúdo ilustrativo do wireframe.

- [ ] **Step 5: Verificar e commitar**

Run: node --test packages/studio/test/forms-ui.test.mjs packages/studio/test/studio-context-boundary.test.mjs

Expected: todos passam, inclusive reset de lista e descarte de resposta antiga após troca de contexto.

Commit: git add packages/studio/public/forms.js packages/studio/public/forms.css packages/studio/test/forms-ui.test.mjs && git commit -m "feat: unifica estrutura e inspeção dos formulários"

### Task 4: Entregar abas móveis acessíveis nas duas implementações

**Files:**
- Modify: packages/studio/public/editor-workspace.js
- Modify: packages/studio/public/editor-shell.js
- Modify: packages/studio/public/editor-shell.css
- Modify: packages/studio/public/forms.js
- Modify: packages/studio/public/forms.css
- Modify: packages/studio/test/editor-workspace.test.mjs
- Modify: packages/studio/test/editor-controls.test.mjs
- Modify: packages/studio/test/forms-ui.test.mjs

**Interfaces:**
- Ambos os adaptadores importam workspaceState, normalizeWorkspacePanel e workspaceKeyAction.
- Cada editor mantém activeWorkspacePanel, inicialmente canvas, e aplica role=tablist, role=tab e role=tabpanel aos mesmos três painéis desktop.

- [ ] **Step 1: Escrever os testes vermelhos de navegação móvel**

Em editor-workspace.test.mjs, testar sequência da tablist e que renderização comum não altera painel canvas. Em editor-controls.test.mjs e forms-ui.test.mjs, exigir rótulos em português, aria-controls, aria-selected, painéis associados por aria-labelledby e regra móvel que deixa somente painel ativo visível/focável. Verificar desktop com três regiões simultâneas.

- [ ] **Step 2: Confirmar o RED**

Run: node --test packages/studio/test/editor-workspace.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs

Expected: falha até ambos adotarem o contrato.

- [ ] **Step 3: Implementar tabs sem duplicar conteúdo**

Adicionar uma tablist antes das regiões em cada editor. Clique e Enter/Espaço ativam botão; ArrowLeft/ArrowRight/Home/End usam workspaceKeyAction, atualizam ARIA, aplicam hidden e inert ao painel inativo somente no mobile e movem foco à aba ativa.

Abrir elemento por árvore/prévia no celular seleciona Editar. Voltar ao wrapper/canvas da landing seleciona Estrutura ou Canvas conforme origem. Trocar aba não recria GrapesJS, formulário, schema ou prévia. Contexto/retorno continuam usando o fechamento atual do shell.

- [ ] **Step 4: Implementar CSS de 390 x 844**

No breakpoint até 740 px, substituir a pilha permanente por tablist e painel ativo. Usar minmax(0, 1fr), rolagem vertical própria e nenhum min-width que crie scroll horizontal. Tabs e ações principais têm alvo mínimo de 44 x 44 px. Em desktop/tablet largo, ocultar somente tablist e deixar os três painéis lado a lado.

- [ ] **Step 5: Verificar e commitar**

Run: node --test packages/studio/test/editor-workspace.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs

Expected: todos passam.

Commit: git add packages/studio/public/editor-workspace.js packages/studio/public/editor-shell.js packages/studio/public/editor-shell.css packages/studio/public/forms.js packages/studio/public/forms.css packages/studio/test/editor-workspace.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs && git commit -m "feat: adapta os editores às abas móveis"

### Task 5: Validar preservação de shell, permissões, isolamento e visuais

**Files:**
- Modify: packages/studio/test/studio-context-boundary.test.mjs
- Modify: packages/studio/test/studio-shell.test.mjs
- Modify: packages/studio/test/editor-controls.test.mjs
- Modify: packages/studio/test/forms-ui.test.mjs
- Modify: produto/grafo.yaml, somente após todos os gates
- Create: .estado/editores-saas.md, somente após todos os gates

- [ ] **Step 1: Escrever testes de regressão**

No limite público dos módulos, cobrir:
- contextBoundary.close salva landing e formulário, fecha ambos e limpa listas antes da troca;
- página/formulário aberto continua ligado ao projectId de origem e o retorno pede esse projeto ao shell;
- pessoas sem page.write/form.write não recebem ação visual de editar/salvar;
- abertura dos editores não muda empresa/projeto nem chama API de integração/publicação.

- [ ] **Step 2: Confirmar o RED quando houver contrato rompido**

Run: node --test packages/studio/test/studio-context-boundary.test.mjs packages/studio/test/studio-shell.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs

Expected: falha identifica regressão de UI. Não alterar backend para mascarar falha.

- [ ] **Step 3: Corrigir apenas regressão de integração**

Limitar mudança a callbacks/guardas públicos dos editores. Não tocar em project-api.mjs, repositórios, migrations, login, setup, dashboard, publicação ou configurações fora de regressão causada por novos painéis.

- [ ] **Step 4: Rodar a suíte completa**

Run: node --test --test-concurrency=1 packages/studio/test/*.test.mjs

Expected: exit 0. Registrar a contagem exibida pelo runner, sem inventar número.

- [ ] **Step 5: Executar inspeção visual manual**

Com empresa, projeto e conteúdo autorizados:
1. Desktop 1440 x 900: cabeçalho preservado, três painéis, árvore única, seleção sincronizada, canvas/prévia sem conteúdo ilustrativo e controles legíveis.
2. Celular 390 x 844: tabs Estrutura/Canvas/Editar, sem rolagem horizontal, alvo mínimo de 44 px, todas as regiões acessíveis e foco visível.
3. Teclado: Tab/Shift+Tab, Enter/Espaço, setas/Home/End em tabs/árvore, Escape na landing, Delete/Backspace fora de campos, status de salvar e retorno ao projeto.
4. Isolamento: trocar projeto pelo shell e confirmar que lista, árvore, canvas e prévia mostram somente conteúdo do projeto ativo.

- [ ] **Step 6: Registrar o gate real**

Se suíte e as duas inspeções forem aprovadas, marcar editores_saas como feito em produto/grafo.yaml e criar .estado/editores-saas.md com data ISO, SHA, comando/contagem real de testes, viewports, teclado e limitações reais. Se inspeção pendente/reprovar, manter o nó pendente e registrar somente bloqueio factual.

- [ ] **Step 7: Commit**

Se gate aprovado: git add packages/studio/public/editor-workspace.js packages/studio/public/editor-shell.js packages/studio/public/editor-shell.css packages/studio/public/forms.js packages/studio/public/forms.css packages/studio/test/editor-workspace.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/editor-header.test.mjs packages/studio/test/forms-ui.test.mjs packages/studio/test/studio-context-boundary.test.mjs packages/studio/test/studio-shell.test.mjs produto/grafo.yaml .estado/editores-saas.md && git commit -m "feat: conclui os editores SaaS por projeto"

Se o gate visual estiver pendente, não incluir produto/grafo.yaml ou .estado/editores-saas.md; registrar a pendência no relatório de execução.

