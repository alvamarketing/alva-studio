---
tipo: certificacao
status: pendente
data: 2026-09-28
---

# Verificação visual do editor de landing (Puck) — tarefa 3.5

Conferido por um agente que não construiu o editor novo (Codex/Sol atuando como
verificador), conforme a regra "quem constrói não é quem confere".

## Seção do wireframe conferida

`docs/wireframes/alva-studio-ui-reference.html`, view **`view-landing`** (aba
"Página" do protótipo). O título exato que é o contrato desta tela é
**"Estrutura"** (`<h2>` da árvore lateral, eyebrow "PÁGINA", linha 53 do
arquivo), acompanhado do topbar da própria view (linha 52) e do inspector de
conteúdo do elemento selecionado (linha 55, eyebrow "CONTEÚDO"). O texto
"Uma estrutura simples para uma mensagem forte." (linha 54) é conteúdo de
exemplo dentro do canvas, não uma seção à parte; "Título principal" é o nome
do elemento selecionado, também não uma seção.

Referência de código do editor implementado: `packages/studio/editor/main.jsx`,
`packages/studio/editor/config.jsx`, `packages/studio/public/editor.html`.
Página usada para a captura: "Teste de blocos"
(`https://alva.orb.local/editor.html?pagina=502ae964-1e2d-4635-bea5-bfb1a4d0e3e9`).

## Screenshots

Em `.estado/screenshots/editor-landing-2026-09-28/`:

- `wireframe-desktop.png` / `editor-desktop.png` — 1440×900, estado inicial (nada selecionado).
- `editor-desktop-estrutura.png` — 1440×900, aba "Estrutura" do editor aberta (equivalente à árvore do wireframe).
- `editor-desktop-elemento-selecionado.png` — 1440×900, elemento "Título" selecionado, inspector de conteúdo visível.
- `editor-desktop-avancado.png` — 1440×900, accordion "Avançado" do inspector expandido.
- `wireframe-mobile.png` / `editor-mobile.png` — 390×844.
- `editor-mobile-menu.png` — 390×844, menu de ações (chevron) aberto.

## Veredito

**Pendente.** Um achado bloqueia (painel "Estrutura" não é a árvore do
contrato); os demais são ajustes de fidelidade que não impedem uso, mas
quebram "o wireframe é contrato, não inspiração".

## Divergências

### Bloqueia

1. **O painel "Estrutura" é o Outline padrão do Puck, não a árvore do wireframe.**
   No wireframe (linha 53), cada seção tem nome de negócio (Topo, Abertura,
   Benefícios, Contato), contador de itens, ícone por tipo de elemento, e
   botões inline `+ Elemento` / `+ Nova seção`. No editor
   (`editor-desktop-estrutura.png`), a árvore mostra rótulos técnicos internos
   do Puck — `default-zone`, `Nenhum bloco`, `itens`, e três seções
   **idênticas** chamadas "Seção vazia" (sem nome próprio, sem contador, sem
   ícone, sem botão de adicionar dentro da árvore). Confirmado no código:
   `packages/studio/editor/main.jsx:142-146` só sobrescreve `iframe`,
   `headerActions` e `drawerItem` no `overrides` do Puck — não há override do
   Outline/árvore, então o painel "Estrutura" é o componente padrão da
   biblioteca, não o desenho do wireframe.

### Ajuste

2. **Inspector de conteúdo não replica os agrupamentos do wireframe.**
   Wireframe (linha 55): eyebrow "CONTEÚDO" + ícone + h2 com o nome do
   elemento, campo Texto, "Nível do título" como segmentado H1/H2/H3, seção
   "TIPOGRAFIA" (Tamanho, Cor com amostra de cor, Alinhamento), seção
   "ESPAÇAMENTO" (Distância abaixo), seção "MOVIMENTO" (select
   Nenhum/Suave/Lateral/Zoom). Editor (`editor-desktop-elemento-selecionado.png`
   e `editor-desktop-avancado.png`): breadcrumb "Colunas > Título" no lugar do
   cabeçalho com ícone, campo "Texto", um select "Tamanho" (`Principal (H1)`)
   substituindo o segmentado H1/H2/H3, e um accordion "Avançado" que, aberto,
   expõe um select sem rótulo ("Linha inteira"), botões de alinhamento sem
   rótulo, dois grupos P/M/G sem rótulo e mais um select sem rótulo — sem
   nenhum campo de cor de texto e sem os títulos de seção
   TIPOGRAFIA/ESPAÇAMENTO/MOVIMENTO que o wireframe usa para orientar a
   pessoa.

3. **Topbar reordena e recoloca as ações.** Wireframe (linha 52): botão
   "voltar" como ícone à esquerda do título, indicador persistente "✓ Salvo",
   ordem Prévia → Publicar → Salvar, com **Salvar** como botão primário
   (azul). Editor (`editor-desktop.png`,
   `packages/studio/editor/main.jsx:63-83`): não há botão de voltar como
   ícone (existe um botão de texto "Voltar" entre as ações), não há indicador
   de salvo persistente (usa um toast "Página salva." que aparece e some,
   função `aviso()` em `main.jsx:120-121`), há ícones de undo/redo que o
   wireframe não define, a ordem é Voltar → Prévia → Salvar → Publicar, e o
   botão primário (classe `alva-acao-principal`, `main.jsx:78`) é
   **Publicar**, não Salvar — o oposto do wireframe.

4. **Tipografia diverge do token do design system.** O editor carrega e aplica
   "Instrument Sans" (`packages/studio/public/editor.html:9` importa a fonte
   do Google Fonts; linha 14 aplica `font-family: "Instrument Sans"` no
   `body`), enquanto o token `--font-sans` usado no resto do Studio é `'Inter'`
   (`packages/studio/public/styles.css:22`, consumido por
   `editor-shell.css:33/136/668/741/776`, `forms.css:705/719` e
   `index.html:10`). Não há registro na "Biblioteca visual" do wireframe de
   uma segunda família tipográfica — se a troca for intencional, falta
   decisão do dono e atualização do token; se não for, é um vazamento de
   fonte por fora do design system.

### Aceitável

5. **Ações escondidas atrás de um menu em mobile (390×844) e barra de abas
   inferior (Blocos/Estrutura/Propriedades).** O editor esconde
   Voltar/Prévia/Salvar/Publicar atrás de um chevron
   (`editor-mobile.png` → `editor-mobile-menu.png`) e adiciona uma barra fixa
   de abas no rodapé que não existe no wireframe. Isso diverge do wireframe,
   mas o próprio wireframe não define um comportamento real para a barra de
   ações em 390 px — a única regra `@media(max-width:760px)` do arquivo
   apenas oculta a `tree-panel`, e a topbar original do wireframe **também
   estoura** nessa largura (o botão "Salvar" fica cortado na borda direita em
   `wireframe-mobile.png`). Sem um contrato mobile preciso para esta tela, a
   solução do editor é uma adaptação razoável — mas vale confirmar com o dono
   se esse padrão (menu + barra de abas) é o desejado, já que ele não está
   desenhado em nenhum lugar do wireframe.

6. **Controles de dispositivo e zoom no canvas.** O editor tem ícones
   funcionais de mobile/tablet/desktop e um controle de zoom/porcentagem
   (`editor-desktop.png`), enquanto o wireframe só desenha texto estático
   "CANVAS · COMPUTADOR" e "100%" (linha 54). É funcionalidade real que o
   Puck precisa e o wireframe nunca teve intenção de reproduzir como estático;
   não há conflito de contrato aqui.

## Não verificado neste passo

- Fluxo de arrastar elementos da biblioteca ("Blocos") para o canvas.
- Publicação de fato (o botão "Publicar" não foi acionado).
- Os seis modelos de página (fase 2.4) dentro do editor novo.
- Paridade de campos para os demais tipos de elemento (Imagem, Botão, Colunas,
  Formulário, VSL) além do título testado.
