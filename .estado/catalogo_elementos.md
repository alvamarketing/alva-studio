---
no: catalogo_elementos
status: bloqueado
---

# Catálogo de elementos — gate de revisão visual (Tarefa 7)

Revisão independente em 2026-09-12, na branch `feat/catalogo-de-elementos`, por
quem não escreveu as Tarefas 1 a 6. Studio descartável em `PORT=4179` contra um
PostgreSQL efêmero (`alva-studio-revisao`, removido ao fim). Conferência em
1440×900 e em 390×844, nos dois editores, com os três estados dos elementos de
escolha.

**Resultado: reprovado.** A folha voltou ao canvas do quiz, que era o buraco
maior, mas veio acompanhada da folha da landing, e isso desfaz boa parte do que
as Tarefas 2 e 3 queriam entregar. Três achados de severidade alta.

## Seções do wireframe conferidas

Referência: `docs/wireframes/alva-studio-ui-reference.html`.

- Aba **Quiz** — canvas da Tela 1 e inspetor **ELEMENTO · Escolha visual**.
- Aba **Componentes** — seção **Biblioteca visual** (tipografia, botões, cores,
  campos, item da árvore, opção visual).

A regra do sistema escrita na própria Biblioteca visual — "Caixas aparecem
apenas em controles, opções e no item selecionado" — é o critério que os
achados D1 e D3 violam: no produto, opção e controle não têm caixa nenhuma.

## Capturas

Referência (wireframe):

- `.estado/screenshots/catalogo-elementos-wireframe-quiz-desktop.png`
- `.estado/screenshots/catalogo-elementos-wireframe-quiz-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-wireframe-biblioteca-visual-desktop.png`
- `.estado/screenshots/catalogo-elementos-wireframe-biblioteca-visual-mobile-390.png`

Editor de quiz (Escolha única, Escolha visual, Lista de opções, Escala e
Arquivo, cada um como irmão dentro da seção):

- `.estado/screenshots/catalogo-elementos-quiz-canvas-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-canvas-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-normal-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-normal-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-cursor-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-cursor-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-escolhido-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-escolha-estado-escolhido-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-quiz-arquivo-controle-nativo-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-arquivo-controle-nativo-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-quiz-html-publicado-desktop.png`
- `.estado/screenshots/catalogo-elementos-quiz-html-publicado-mobile-390.png`

Editor de páginas (modelo "Serviços · contato na abertura" e uma página em
branco com Seção, Título, Texto e Duas colunas):

- `.estado/screenshots/catalogo-elementos-landing-campo-de-texto-desktop.png`
- `.estado/screenshots/catalogo-elementos-landing-campo-de-texto-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-landing-secao-titulo-texto-desktop.png`
- `.estado/screenshots/catalogo-elementos-landing-secao-titulo-texto-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-landing-texto-coluna-estreita-desktop.png`
- `.estado/screenshots/catalogo-elementos-landing-texto-coluna-estreita-mobile-390.png`
- `.estado/screenshots/catalogo-elementos-landing-texto-medida-70ch-desktop.png`

## O que passou

- **Seção.** `padding` medido no canvas de 1082px: `60px 75,73px`, ou seja 60px
  em cima e embaixo e 7,0% nas laterais, com `min-height:140px`. É o mesmo
  espaçamento do `style` embutido que saiu. Ressalva: o `.alva-secao` ganhou um
  `@media(max-width:760px)` que troca para `40px 6%`; o `style` embutido antigo
  não variava com a largura. A troca parece boa, mas é diferença em relação ao
  critério "o mesmo espaçamento", e fica registrada.
- **Título.** `margin:0 0 16px` tanto na seção larga quanto dentro de uma coluna
  de 499px. Há respiro real embaixo, nada cola no que vem depois.
- **Texto e o `max-width:70ch`.** Medido: `622,89px`. Numa seção larga a caixa
  útil tem 931px, e a linha para em 623px — sobra margem à direita e a leitura
  fica confortável, como mostra
  `catalogo-elementos-landing-texto-medida-70ch-desktop.png`, com um parágrafo
  longo quebrando em quatro linhas. Numa coluna de 499px a regra não morde
  (499 < 623): quem aperta o texto é a coluna, não o catálogo. **Veredito: é
  medida de leitura deliberada, não defeito.** É coerente com o que a folha da
  landing já fazia em `.lead{max-width:580px}` e em `h1{max-width:820px}`.
- **Campo de texto da landing.** Nasce com `.answer-wrap` (`margin:0 0 18px`,
  13px, peso 600) e `.answer` (raio 17px, `padding:17px 18px`, 17px). O bloco
  deixou de nascer sem diagramação e o rótulo aparece acima do campo. Só falta a
  borda, que é o achado D3.
- **Texto do elemento Arquivo.** O rótulo diz "Escolher arquivo", em português.
  O problema é o controle nativo que reapareceu ao lado dele (D2), não o texto.

## Pendências

### D1 · alta · a folha do formulário achata os cartões de escolha do quiz

A Tarefa 1 removeu o `if (quizCanvas) return;` de `blockStyles()` — e com ele o
comentário que avisava exatamente disto — então o canvas do quiz passou a
receber `templateCss`, que termina em `${formCss}`. A raiz de todo quiz é
`<form class="alva-form" data-alva-quiz-capture="true">`, criada muito antes
deste plano. Resultado: `.alva-form label{display:block}` (0,1,1) vence
`.choice{display:flex}` (0,1,0), e Escolha única, Múltipla escolha e Escolha
visual deixam de ser cartão: viram rádio, número e rótulo empilhados, colados na
borda do canvas. O mesmo vale para `.alva-form input` sobre `.answer`.

Vale nos dois viewports e sobrevive ao salvamento: o `rendered_html` guardado
tem `.choice` com `display:block`. Compare
`catalogo-elementos-quiz-canvas-desktop.png` com
`catalogo-elementos-wireframe-quiz-desktop.png`, onde as opções são dois cartões
lado a lado com caixa e raio.

### D2 · alta · o botão "Choose File" não sumiu

`.alva-form input{display:block}` (0,1,1) vence a regra `[hidden]{display:none}`
do navegador (0,1,0). O `<input type="file" hidden>` que a Tarefa 2 colocou no
elemento Arquivo volta a ser desenhado, e dentro da caixa pontilhada aparece o
controle nativo com "Choose File" e "No file chosen", em inglês, logo abaixo do
rótulo em português. Está nítido em
`catalogo-elementos-quiz-arquivo-controle-nativo-desktop.png` e, ainda mais
evidente pela largura menor, em `catalogo-elementos-quiz-canvas-mobile-390.png`.

É defeito do canvas do editor: no `rendered_html` salvo o mesmo input fica com
`display:none`.

### D3 · alta · toda borda declarada com `var()` é descartada

O GrapesJS reserializa a folha ao injetá-la no canvas e perde as declarações de
borda que usam variável. Medido no canvas e no HTML salvo:

- `.answer` — sobra `border-radius`, `padding`, `background`, `box-shadow`;
  **não sobra nenhuma declaração de borda**. O campo cai na borda `2px inset`
  padrão do navegador.
- `.choice` e `.choice-key` — idem, sem nenhuma borda.
- `.upload`, que declara `2px dashed #c8d6eb` com cor literal, **sobrevive**.

É a variável dentro do atalho `border` que quebra, não a folha inteira. A
consequência mais séria está nos estados: conferi os três no elemento de escolha
e, embora "sob o cursor" e "escolhido" mudem fundo (`#eef4ff`), sombra e
deslocamento de 2px, a borda de destaque
(`border-color:var(--alva-el-accent)`) nunca aparece — sem `border-style`, não
há o que colorir. O sinal principal de "esta é a escolhida" está faltando nos
dois editores. Veja os três arquivos `...-escolha-estado-*.png`.

Observação de contexto: `formCss` já sofria do mesmo problema antes deste plano
(`.alva-form input` perde `border` e `background`), então os campos do
formulário da landing também estão sem a borda clara de `--field-border`. O que
é novo aqui é a perda em `.answer`, `.choice` e `.choice-key`, que só agora
entraram no canvas.

### D4 · média · o canvas do quiz ganhou a pele da landing

Com `templateCss`, o corpo do quiz no editor passa a `Arial, Helvetica`, fundo
`#faf9f5` e tinta `#203a32`. O quiz publicado usa `Inter` sobre
`--cloud:#f7f9fd` com tinta `#111827`, e o wireframe mostra o canvas claro e
azulado. Quem edita não vê a mesma página que publica.

`quizCanvasCss`, que existe em `quiz-elements.js` justamente para vestir o
canvas do quiz, continua exportado e sem nenhum consumidor.

### D5 · média · Título e Texto soltos encostam na borda

Fora de uma `.alva-secao`, `.alva-titulo` e `.alva-texto` só ganharam
`margin-bottom`. Largados na raiz da página começam em x=0 e ficam desalinhados
dos 7% da seção logo acima — dá para ver o degrau em
`catalogo-elementos-landing-secao-titulo-texto-desktop.png` e, pior, em
`...-mobile-390.png`. A própria árvore do editor chama esse grupo de "Elementos
soltos", então o estado é reconhecido pelo produto; falta o respiro lateral.

### D6 · baixa · o catálogo declara um ícone que a paleta ignora

`catalogo` traz `icone` para cada entrada (`list`, `linear_scale`,
`upload_file`), mas `editor-shell.js` monta a paleta com
`blockIcons[id] || 'add'`, e `blockIcons` não tem nenhuma entrada de quiz. Lista
de opções, Escala e Arquivo aparecem com o "+" genérico ao lado de blocos que
têm ícone próprio. O campo do catálogo está morto.

### D7 · baixa · o crachá do canvas chama a escolha de "Label"

Com o cursor sobre um cartão de escolha, o crachá do GrapesJS mostra "Label",
em inglês, enquanto a árvore chama o mesmo elemento de "Escolha única". Visível
em `catalogo-elementos-quiz-escolha-estado-cursor-desktop.png`.

## Suíte

`node --test packages/studio/test/*.test.mjs` → **1012 aprovados, 0 falhas,
0 cancelados, 0 ignorados** (46,4 s).

Serve de lembrete do motivo deste gate: a suíte está inteira verde e nenhum dos
sete achados acima aparece nela.

## Ambiente

- PostgreSQL descartável `alva-studio-revisao` em `127.0.0.1:35481`, removido ao
  fim da conferência.
- Studio a partir deste worktree em `PORT=4179`. A cópia principal da porta 4178
  não foi usada.
- Wireframe servido a partir de `docs/wireframes/` deste mesmo worktree.
- Conta inicial criada com `bootstrap-owner.mjs`, credenciais locais e
  descartáveis, junto com o banco.
