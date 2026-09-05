# Sistema de design — fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar `packages/studio/public/design/` como fonte única de tokens, componentes e ícones do Alva Studio, publicar a Biblioteca visual dentro do app como superfície de verificação, e migrar a primeira tela — "Empresa e equipe" — para o sistema, porque o painel de superadmin depende dela.

**Architecture:** `tokens.css` é o único arquivo do produto onde cor e medida aparecem como literal, com `:root` claro e `:root[data-color-scheme='dark']` sob os mesmos nomes `--alva-*`. `components.css` entrega cada peça com os cinco estados que o wireframe não tem (normal, foco, erro, desabilitado, carregando). Como as páginas públicas de formulário embutem CSS numa constante e são publicadas na Vercel, cada folha tem um par `.mjs` que exporta o mesmo texto — uma fonte, dois consumos. Um teste de baseline decrescente mede literais fora de `design/` e só permite que a contagem caia.

**Tech Stack:** CSS puro com custom properties, JavaScript ESM sem framework, `node:test`, Material Symbols Outlined já autorizado pela CSP.

**Spec:** `docs/superpowers/specs/2026-09-05-design-system.md`; nó `design_system` proposto lá na §6.

## Global Constraints

- **O ponto de partida é o commit de `tracking_coletor`, não a árvore de agora.** Hoje `server/index.mjs`, `public/index.html`, `public/styles.css`, `public/app.js` e mais dezoito arquivos estão modificados por aquele nó, que ainda não fechou (`.estado/tracking_coletor.md` não existe). Nenhuma tarefa daqui começa antes de ele estar commitado; começar antes garante conflito em `index.mjs` e `index.html`.
- **`styles.css` só pode ser tocado para três coisas:** incluir import do sistema, remapear token para o novo valor, e migrar as classes que pertencem à tela desta fase. Reescrever qualquer outra tela é fora de escopo — as classes antigas coexistem com as novas até a última migração, e nada sai do ar no meio.
- **Ressalva descoberta ao mapear a tela:** as classes que estilizam o conteúdo de "Empresa e equipe" **não estão em `owner.css`**. `.company-overview`, `.company-overview-section`, `.company-counts`, `.project-grid`, `.member-list`, `.member-item`, `.role-chip` e `.company-future` vivem em `public/styles.css` e são compartilhadas com a view autônoma `#company-view`, porque as duas telas renderizam a mesma função `renderCompanyOverview` (`public/app.js:253-315`). Migrar "Empresa e equipe" migra `#company-view` junto — é um componente só, não duas telas. A Task 7 assume isso; separá-las exigiria duplicar o renderizador, que é pior.
- Os valores de token são decisão do dono, fechada em 05/09/2026: linha `#e1e7ef`, fundo `#f6f8fb`, azul de superfície `#edf4ff`, sucesso `#20a464`, erro `#e5484d`, fonte **Inter**, raio **único de 12px**. O wireframe vence; os nomes continuam `--alva-*`.
- Tema escuro não se perde: cada token nasce com os dois valores, e toda peça é conferida nos dois. O tema chega ao DOM como `data-color-scheme` em `<html>`, escrito por `public/ui-preferences.js:52-63` e iniciado em `public/app.js:14`.
- Nenhuma tela declara cor, tamanho, raio ou sombra. Peça que não existe entra primeiro na biblioteca, com aprovação do dono, e só depois é usada.
- Ícone fora de `ICONS` é erro de teste, não escolha de quem implementa.
- Toda tarefa com tela cita a seção do wireframe e termina com verificação visual em navegador, conforme a "Regra de fidelidade visual" do `AGENTS.md`.
- Toda produção segue RED → GREEN → REFACTOR. Quem implementa não faz a revisão de aceite.
- **Ajuste pendente na spec:** o nó `design_system` declara `comando: node --test packages/studio/test/design-tokens.test.mjs packages/studio/test/design-library.test.mjs`. Este plano cria cinco suítes focadas; o `comando` do nó precisa listar as cinco. É uma linha na spec, e quem fechar o nó deve corrigi-la antes de rodar `vibe conferir`.

---

### Task 1: `tokens.css` nos dois temas, consumível como arquivo e como string

**Files:**
- Create: `packages/studio/public/design/tokens.css`
- Create: `packages/studio/public/design/tokens.mjs`
- Create: `packages/studio/test/design-tokens.test.mjs`

**Interfaces:**
- Produces: `:root` e `:root[data-color-scheme='dark']` com os mesmos nomes.
- Produces: cores `--alva-*` já existentes com os valores decididos; escala de espaçamento `--space-1`…`--space-8`; escala tipográfica `--text-display`, `--text-title`, `--text-body`, `--text-small`, `--text-eyebrow`, cada uma com tamanho, peso e altura de linha; `--radius` único; sombras; `--motion`.
- Produces: `tokens.mjs` exportando `TOKENS_CSS`, o texto **idêntico** ao do `.css`.
- Nada de seletor de elemento neste arquivo.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: os seis valores decididos estão presentes e os antigos não aparecem em lugar nenhum (`#e7ecf3`, `#f7f9fc`, `#eef4ff`, `#198044`, `#ba3535`, `Instrument Sans`); existe **um único** token de raio e nenhuma das quatro escalas antigas; todo nome declarado no `:root` claro também existe no bloco escuro, e vice-versa; `TOKENS_CSS` é byte a byte igual ao conteúdo do `.css`; o arquivo não contém nenhum seletor que não seja `:root`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/design-tokens.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Publique a lista de nomes de token assim que ela existir: as Tasks 2 e 6 dependem dela como contrato.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/design-tokens.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): tokens do sistema de design nos dois temas`

**Pronto quando:** a suíte passa, os dois temas declaram o mesmo conjunto de nomes e nenhum valor antigo sobrevive no arquivo.

---

### Task 2: `components.css`, `components.mjs` e `behavior.mjs`

**Files:**
- Create: `packages/studio/public/design/components.css`
- Create: `packages/studio/public/design/components.mjs`
- Create: `packages/studio/public/design/behavior.mjs`
- Create: `packages/studio/test/design-components.test.mjs`

**Interfaces:**
- Produces as onze peças da §1 da spec, cada uma com **normal, foco visível, erro, desabilitado e carregando**: botões (`.button`, `.primary`, `.ghost`, `.dashed`, `.icon-button`); campos (`.field`, `.control`, `.toggle`); seleção (`.segmented` / `.vsl-choice`); árvore (`.tree`, `.tree-row`, `.parent`, `.child`, `.active`, `.drag`, `.type-icon`); opção visual (`.option-edit`, `.option-card`, `.avatar`); cartão (`.surface`, `.surface-head`); pílula de status (`.status-pill` neutra, positiva, atenção, negativa); barra de uso (`.usage`, `.usage-head`, `.usage-bar`); linha de membro (`.member-row`, `.member-avatar`, `.role`); navegação (`.project-sidebar`, `.nav-item`, `.nav-label`, `.side-footer`, `.settings-nav`, `.project-switcher`); cabeçalhos (`.eyebrow`, `.project-heading`, `.section-title`, `.helper`).
- Produces: `components.mjs` exportando `COMPONENTS_CSS`, idêntico ao `.css`.
- Produces: `behavior.mjs` com só duas coisas — grupo de seleção (mover `.active`, `aria-checked`, navegação por seta) e `.toggle` (`aria-pressed`).

- [ ] **Step 1: Escrever os testes que falham**

  Provar: cada peça declara os cinco estados; **nenhum literal de cor, tamanho, raio ou sombra** aparece no arquivo — tudo é `var(--alva-*)` ou `var(--space-*)`; toda peça que recebe foco tem `:focus-visible`; o grupo de seleção move `aria-checked` e responde a seta esquerda e direita; o `.toggle` alterna `aria-pressed`; `COMPONENTS_CSS` é igual ao `.css`. As cinco classes que já existem no app com semântica diferente — `.eyebrow`, `.nav-item`, `.icon-button`, `.project-switcher`, `.project-columns` — recebem teste explícito do valor novo, porque vão sobrescrever o antigo.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/design-components.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Se `behavior.mjs` crescer além dessas duas peças, é sinal de peça mal desenhada — pare e registre, não contorne.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/design-components.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): componentes do sistema de design com todos os estados`

**Pronto quando:** a suíte passa e um grep por `#` e por `px` no arquivo não encontra nada.

---

### Task 3: `icons.mjs` — lista fechada de ícones

**Files:**
- Create: `packages/studio/public/design/icons.mjs`
- Create: `packages/studio/test/design-icons.test.mjs`

**Interfaces:**
- Produces: `ICONS`, conjunto congelado com os **54 nomes** usados pelo wireframe mais os do app que ainda não têm equivalente lá — o app renderiza 21 hoje, e a interseção precisa ser conferida, não presumida.
- Produces: `icon(name, { label })` que devolve `<span class="material-symbols-outlined">` e **lança** para nome fora da lista.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: nome fora da lista lança; `ICONS` é congelado; o helper escapa o nome; ícone decorativo sai com `aria-hidden="true"` e ícone com significado sai com `aria-label`; nenhum nome duplicado com grafia diferente.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/design-icons.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Dois ícones para a mesma ideia só coexistem se significarem coisas diferentes; o `README.md` do sistema diz qual é qual.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/design-icons.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): allowlist de ícones do sistema de design`

**Pronto quando:** a suíte passa e a lista cobre todos os ícones que as telas de hoje renderizam.

---

### Task 4: Baseline decrescente de literais

**Files:**
- Create: `packages/studio/test/design-baseline.test.mjs`
- Create: `packages/studio/test/fixtures/design-baseline.json`

**Interfaces:**
- Produces: varredura de `public/**/*.css` e `public/**/*.js` contando `#rrggbb` e `Npx`, **ignorando** `public/design/`.
- Produces: comparação por arquivo com o fixture. Arquivo pode diminuir, nunca aumentar; arquivo novo entra com zero.
- Exceções escritas, não descobertas: `public/design/tokens.css` e `public/templates.js` — modelos de landing page são conteúdo do cliente, não interface do produto.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: aumentar a contagem de um arquivo faz falhar, e a mensagem diz **qual arquivo e quanto**; diminuir passa; arquivo novo com literal falha; arquivo novo sem literal passa; as duas exceções são ignoradas; a baseline registra contagem por arquivo, não um total.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/design-baseline.test.mjs`

- [ ] **Step 3: Implementar e gravar a baseline inicial**

  Gerar o fixture a partir da árvore **depois do commit de `tracking_coletor`**. A medição de 05/09 deu 1.041 `px` e 46 cores nos quatro CSS e 76 cores no JS, 74 delas em `templates.js` — recontar, não copiar: os números se movem enquanto outros nós rodam.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/design-baseline.test.mjs`

- [ ] **Step 5: Commit** — `test(studio): baseline decrescente de literais fora do sistema de design`

**Pronto quando:** a suíte passa e a baseline reflete a árvore commitada, não a de trabalho.

---

### Task 5: Servir `design/` no painel

**Files:**
- Modify: `packages/studio/server/index.mjs`
- Modify: `packages/studio/public/index.html`
- Test: `packages/studio/test/server.test.mjs`

**Interfaces:**
- Produces: `/design/tokens.css` e `/design/components.css` no mapa `files` (`server/index.mjs:230-256`), ao lado de `/styles.css`.
- Produces: os dois `<link rel="stylesheet">` em `public/index.html`, **antes** de `/styles.css` (hoje nas linhas 14-18), para que a folha antiga ainda vença enquanto as telas não migram.
- Consumes: os arquivos das Tasks 1 e 2.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: `GET /design/tokens.css` e `GET /design/components.css` respondem 200 com `text/css`; caminho fora do mapa continua 404; a ordem dos `<link>` no HTML coloca o sistema antes de `styles.css`; o teste de grafo de módulos que `server.test.mjs` já faz continua verde.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/server.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Só o mapa e os dois `<link>`. Nenhuma tela muda aqui.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/server.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): serve o sistema de design no painel`

**Pronto quando:** a suíte passa e o painel carrega as duas folhas sem nenhuma mudança visual.

---

### Task 6: Biblioteca visual dentro do app

Implementa a seção **"Biblioteca visual"** de `docs/wireframes/alva-studio-ui-reference.html` (`<section class="view" id="view-components">`): título "Biblioteca visual", o parágrafo de apoio, e um `.component-grid` de três colunas com cartões `.component-card` — Tipografia, Botões, Cores, Campos, Item da árvore, Opção visual — mais os cartões das peças que o wireframe não isolou: status, barra de uso, linha de membro, navegação e cabeçalhos. Fecha com a `legend-note` do próprio wireframe: *"árvore organiza, canvas mostra o resultado e inspetor edita. Um componente não repete a função de outro painel."*

**Files:**
- Create: `packages/studio/public/design-library.js`
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/server/index.mjs`
- Create: `packages/studio/test/design-library.test.mjs`

**Interfaces:**
- Produces: rota autenticada dentro da SPA, alcançável pelas Configurações. Sem dado de empresa nenhum, mas fechada.
- Produces: cada peça renderizada em **todos** os cinco estados, nos dois temas.
- Consumes: `components.css`, `tokens.css`, `icons.mjs`, `behavior.mjs`.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: a página lista todas as peças de `components.css` — um teste que compara a lista de classes do arquivo com as renderizadas falha quando uma peça nova entra sem entrar na biblioteca; cada peça aparece nos cinco estados; a página não usa nenhuma classe fora de `design/`; sem sessão, a rota não renderiza.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/design-library.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/design-library.test.mjs`

- [ ] **Step 5: Verificação visual em navegador**

  Abrir a Biblioteca visual e a seção "Biblioteca visual" do wireframe lado a lado, no mesmo viewport, em desktop e em 375 px, **nos dois temas**. Comparar tipografia, botões, cores, campos, item da árvore e opção visual. Salvar o screenshot.

- [ ] **Step 6: Commit** — `feat(studio): publica a Biblioteca visual dentro do app`

**Pronto quando:** as duas suítes passam, o screenshot existe e uma peça nova em `components.css` sem cartão na biblioteca faz o teste falhar.

---

### Task 7: Primeira migração — "Empresa e equipe"

Implementa a seção **"Empresa e equipe"** do wireframe (`<section class="view" id="view-settings">`): eyebrow "CONFIGURAÇÕES", `<h1>Empresa e equipe</h1>`, `.domain-pill`, botão primário "Salvar alterações", `.settings-nav` com as abas, e um `.workspace-grid` de dois cartões `.surface` — "Dados da empresa" com os campos Nome da empresa, Domínio padrão e Fuso horário, e "Equipe" com as `.member-row`. É a tela mais divergente e a menos acoplada, e é a que o painel de superadmin reaproveita.

**Files:**
- Modify: `packages/studio/public/owner.js`
- Modify: `packages/studio/public/owner.css`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/styles.css`
- Modify: `packages/studio/test/fixtures/design-baseline.json`
- Test: `packages/studio/test/owner.test.mjs`
- Test: `packages/studio/test/studio-dashboard.test.mjs`

**Interfaces:**
- Consumes: `.workspace-grid`, `.surface`, `.surface-head`, `.field`, `.control`, `.settings-nav`, `.member-row`, `.member-avatar`, `.role`, `.eyebrow`, `.domain-pill`, `.button` — todas da Task 2. **Nenhuma delas existe hoje**: o app usa `.member-item`/`.member-list` no lugar de `.member-row` e `.role-chip` no lugar de `.role`.
- Pontos de gancho, todos verificados: a aba é montada em `public/owner.js:56-72`, e o painel é **uma string de HTML literal única** na linha 71 — é ali que a marcação nova entra. O conteúdo é preenchido pelo callback `onCompanySettings` (`public/app.js:1386-1400`), que delega a `renderCompanyOverview` (`public/app.js:253-315`), a mesma função usada por `#company-view`. Não há `<dialog>` no `index.html`: `owner.js:29-54` monta o diálogo e o converte em `<section hidden>` quando recebe `settingsMount`.
- Produces: baseline de `owner.css`, `owner.js`, `app.js` e `styles.css` reduzida no fixture da Task 4. `owner.css` tem hoje **116 `px` literais e nenhuma cor hex** — a redução ali é de medida, não de cor.

**Armadilha de teste, confirmada:** `test/owner.test.mjs:9` faz `assert.match(owner, /id = 'tab-company'/)` — regex sobre o **texto-fonte** de `owner.js`, não sobre o DOM. Remover ou reescrever aquela linha quebra o teste mesmo que a tela funcione. Mantenha a linha ou atualize o teste no mesmo commit, conscientemente.

- [ ] **Step 1: Escrever os testes que falham**

  Provar: a tela usa só classes de `design/` — um teste varre a marcação gerada e falha em qualquer classe de layout antiga remanescente; o contrato de acesso que `owner.test.mjs` já garante continua igual (abas, foco, papéis, o que cada papel vê); o token da Vercel continua write-only, com placeholder "Token salvo — preencha apenas para substituir"; `#company-view` renderiza a mesma marcação nova, porque é o mesmo renderizador; os catorze testes de `studio-dashboard.test.mjs` continuam verdes; a baseline dos quatro arquivos caiu.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/owner.test.mjs packages/studio/test/studio-dashboard.test.mjs packages/studio/test/design-baseline.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Trocar marcação e classes, não comportamento. Nenhuma classe antiga é **removida** de `owner.css` nesta fase — as folhas antigas só perdem o que sobrou depois da última migração.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/owner.test.mjs packages/studio/test/studio-dashboard.test.mjs packages/studio/test/design-baseline.test.mjs`

- [ ] **Step 5: Verificação visual em navegador**

  Abrir a tela e a seção "Empresa e equipe" do wireframe lado a lado, em desktop e em 375 px, nos dois temas. Conferir **também** `#company-view`, que renderiza o mesmo componente. Salvar os screenshots.

- [ ] **Step 6: Commit** — `refactor(studio): migra Empresa e equipe para o sistema de design`

**Pronto quando:** as duas suítes passam, o screenshot existe, a baseline caiu e nenhum comportamento de acesso mudou.

---

### Task 8: README, mapas e certificação do nó

**Files:**
- Create: `packages/studio/public/design/README.md`
- Create: `.estado/design_system.md`
- Modify: `packages/studio/public/MAPA.md`
- Modify: `packages/studio/test/MAPA.md`
- Modify: `packages/studio/README.md`

- [ ] **Step 1: Rodar a suíte completa uma vez**

  Run: `node --test packages/studio/test/*.test.mjs`

- [ ] **Step 2: Conferir o contrato de aceite**

  Confirmar: `tokens.css` declara todo token nos dois temas, com os seis valores do wireframe e um único raio de 12px; `components.css` entrega as onze peças com os cinco estados; `icons.mjs` recusa nome fora da lista; a Biblioteca visual renderiza tudo em todos os estados; a baseline existe e falha quando um arquivo aumenta; "Empresa e equipe" não tem literal próprio e o tema escuro continua correto. Quem construiu não faz esta conferência.

- [ ] **Step 3: Escrever o README do sistema**

  Como usar, e **em quantos passos se propõe uma peça nova** — a resposta tem de ser "poucos", senão as telas voltam a inventar classe.

- [ ] **Step 4: Registrar o estado**

  Escrever `.estado/design_system.md` com `status: feito`, as seções do wireframe conferidas e os caminhos dos screenshots, e a linha que o `passa_quando` do nó exige. Corrigir na spec o `comando` do nó para listar as cinco suítes, e então rodar `vibe conferir design_system`.

- [ ] **Step 5: Commit** — `docs: certifica o sistema de design`

**Pronto quando:** `vibe conferir design_system` passa e a suíte completa está verde.

---

## Gate de homologação

Abrir a Biblioteca visual e percorrer as onze peças nos cinco estados, nos dois temas, comparando com a seção "Biblioteca visual" do wireframe. Depois abrir "Empresa e equipe" e comparar com a seção do wireframe, em desktop e em 375 px, nos dois temas. Confirmar que nenhuma outra tela mudou de aparência — Home, Projeto, os dois editores e a página pública de formulário continuam como estavam. Confirmar que a baseline caiu em `owner.css` e `owner.js` e não subiu em nenhum outro arquivo.

## Ordem e paralelismo

- Onda 1, três terminais: Tasks 1, 3 e 4 — arquivos disjuntos e nenhuma depende das outras. A Task 4 mede a árvore, não o sistema.
- Onda 2: Task 2, sozinha — precisa da lista de nomes de token que a Task 1 publica no Step 3.
- Onda 3: Task 5, sozinha — é a primeira a tocar `server/index.mjs` e `public/index.html`.
- Onda 4: Task 6, sozinha — toca `index.html` de novo, por isso não divide onda com a Task 5.
- Onda 5: Task 7, sozinha — dona de `owner.js`, `owner.css`, `app.js`, `styles.css` e do fixture da baseline.
- Onda 6: Task 8, sozinha.

`public/index.html` é o gargalo real: as Tasks 5 e 6 o tocam e por isso ficam em ondas separadas. `packages/studio/test/fixtures/design-baseline.json` pertence à Task 4 e depois à Task 7, também em ondas distintas — nenhuma onda tem dois terminais no mesmo arquivo.
