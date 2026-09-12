# Catálogo de elementos e Jornada do quiz — design

Data: 2026-09-12
Estado: aprovado na conversa, aguardando plano de implementação

## O problema

O Studio publica landing pages bonitas e quizzes feios, e a causa é a mesma nos dois
casos: **os elementos não têm design; o design mora nos modelos.**

`templateCss` (`packages/studio/public/templates.js:169`) é uma folha baseada em classes
dos modelos — `.hero`, `.cards`, `.cta`, `.nav`, `.faq`. Os blocos do catálogo, porém,
entram no canvas como HTML sem classe:

```html
<label>Novo campo<input name="novo_campo" type="text" placeholder="Digite aqui"></label>
<label>Como você avalia?<input type="range" name="campo_escala" min="1" max="10"></label>
```

Nenhuma regra casa com eles. O modelo é bem diagramado; tudo acrescentado depois nasce
com o visual padrão do navegador.

No quiz o efeito é total, por uma linha em `packages/studio/public/editor-shell.js:1712`:

```js
function blockStyles() {
  // Quiz canvases already carry their own scoped CSS...
  if (quizCanvas) return;
```

O canvas do quiz não recebe folha nenhuma. O comentário descrevia o editor antigo, que
trazia `quizCanvasCss` próprio. Quando o quiz passou a ser página e a usar os blocos da
landing (commits `dc09237` e `742da58`), a guarda deixou de proteger e passou a sabotar.

Três defeitos menores da mesma família, observados no navegador em 2026-09-12:

- `+ Nova seção` não cria seção: troca o painel para a aba Elementos e não avisa nada.
- `+ Novo quiz` abre a galeria de modelos de landing, com o texto de ajuda
  "Ex.: LP Alva Marketing". Não existe modelo de quiz.
- A árvore do quiz mostra "Abertura" — uma seção de landing. O conceito de etapa não
  existe em nenhum lugar da interface.

E a tela do editor é a única das 18 superfícies certificadas que nunca teve evidência
visual comparada ao wireframe: `docs/wireframes/alva-v1-*.png` cobre login, home,
projeto, páginas, quizzes, histórico, configurações, empresa e Vercel. O editor, não.

## O princípio

**Existe um catálogo de elementos, e ele é o dono do HTML.**

Nem o editor de páginas nem o do quiz escrevem markup de elemento. O catálogo expõe,
por elemento: identificador, nome, ícone, campos do inspetor e uma função
`render(elemento) → html`. O editor de páginas consome esse `render` como bloco do
GrapesJS; a Jornada consome o mesmo `render` direto.

É isso que impede repetir o erro de 2026-09-08, quando o quiz tinha árvore, elementos e
defeitos próprios e consertar um lado nunca melhorava o outro. Dois hosts podem existir;
dois catálogos, não. Se um elemento fica feio, fica feio nos dois; ao consertar,
conserta nos dois.

Corolário: **quiz é estado, página é documento.** A landing page continua sendo um
documento do GrapesJS. A Jornada é uma máquina de estados — telas, ordem, respostas — e
seu dado é um JSON de telas, não um projeto do GrapesJS. Forçar estado dentro de um
editor de documento foi a origem da mecânica própria que já foi removida uma vez.

## Escopo

Entra:

- Design próprio para cada elemento do catálogo, nas landing pages e no quiz.
- A casca de três colunas do wireframe no editor de páginas.
- A Jornada: editor de telas do quiz, com o mesmo catálogo e os mesmos tokens.
- Captura de lead dentro do quiz (obrigatório).
- Destino final com UTMs preservadas (obrigatório).
- Ramificação por resposta, se couber como um campo por opção (desejável).

Não entra:

- GrapesJS Studio SDK. É licença comercial, não foi contratado e não é necessário:
  a casca do editor é HTML e CSS nossos, e o GrapesJS aparece uma única vez, em
  `editor-shell.js:1405`.
- Pontuação com resultado por faixa. Marcada como neutra; o custo não está no somatório
  e sim na tela de resultado por faixa. Fica fora da V1, com o campo `pontos` previsto
  no formato para não exigir migração depois.
- Mídia própria, cobrança, motores. Continuam como estão.

## Ordem de construção

A ordem é parte do design: cada bloco só existe porque o anterior o torna barato.

### Bloco 1 — Devolver a folha ao canvas do quiz

Remover a saída antecipada de `blockStyles()` para `quizCanvas` e aplicar ao canvas do
quiz a mesma folha que a landing recebe. Idem para `formStyles()`, que hoje só normaliza
formulários fora do quiz.

Prova: abrir um quiz no editor e ver tipografia, campos e espaçamento iguais aos da
landing. Teste focado que afirma que o canvas do quiz recebe `templateCss`.

Por que primeiro: é a correção de uma regressão, custa uma linha e tira o produto da
aparência amadora antes de qualquer trabalho estrutural.

### Bloco 2 — Catálogo de elementos com design próprio

Novo módulo `packages/studio/public/catalogo-elementos.js`, sem DOM de editor e sem
estado. Cada elemento declara:

```js
{
  id: 'opcoes',
  nome: 'Escolha visual',
  icone: 'gallery_thumbnail',
  grupo: 'Captação',
  campos: [...],          // o que o inspetor mostra
  render(elemento) {...}, // o HTML, com classe e tokens
}
```

O HTML de cada elemento passa a nascer com classe própria (`alva-opcoes`, `alva-campo`,
`alva-cartao`) e a folha correspondente sai do mesmo módulo, escrita sobre os tokens já
existentes em `packages/studio/public/styles.css` — sem cor, raio, sombra, família ou
tamanho novos, conforme a regra de fidelidade visual.

`templates.js` deixa de declarar blocos como strings soltas e passa a derivá-los do
catálogo. Os seis elementos de quiz de `editor-shell.js:1201-1206` são redesenhados:
Escolha única, Múltipla escolha, Escolha visual, Lista de opções, Escala e Arquivo
deixam de ser controles nativos e passam a ser cartões com mídia opcional (emoji, ícone
ou imagem), rótulo, descrição e indicador de seleção, com três estados — normal, sob o
cursor e escolhido.

Referência de seção do wireframe: "Biblioteca visual" (tipografia, botões, cores,
campos, item da árvore e opção visual) e "ELEMENTO · Escolha visual".

Prova: cada elemento do catálogo tem teste que afirma que o HTML gerado carrega a classe
do sistema e nenhum estilo inline de cor ou tamanho; revisão visual em navegador
comparando com a "Biblioteca visual" em 1440×900 e 390×844, com screenshot anexado.

### Bloco 3 — A casca de três colunas

O editor de páginas passa a exibir árvore, canvas e inspetor ao mesmo tempo, como em
"PÁGINA · Estrutura", "CANVAS · COMPUTADOR" e "CONTEÚDO · Título principal". Hoje são
duas colunas: um painel de 299 px à esquerda com abas `Estrutura | Elementos | Conteúdo`
e um canvas de 1338 px. Selecionar um elemento troca a aba e faz a árvore desaparecer,
justamente quando ela é mais necessária.

Junto, quatro acertos de fidelidade observados na comparação:

- Cabeçalho de painel: sobrancelha, título e linha de ajuda.
- Canvas com moldura: cartão de cantos arredondados sobre fundo neutro.
- Barra superior com os três botões nomeados — Prévia, Publicar, Salvar — e os ícones
  sem rótulo revistos.
- Inspetor mostrando o valor do projeto, não o computado. Quando a regra não traz valor
  próprio, o inspetor cai para `getComputedStyle` (`editor-shell.js:1960` e `:2298`); num
  `h1` declarado com `clamp(38px,5.2vw,72px)` isso devolve `69.98`, e a distância aparece
  como `45.62`. O wireframe mostra `48 px` e `16 px` — valores que a pessoa reconhece.

E `+ Nova seção` passa a dizer o que fez: ou cria a seção, ou abre a biblioteca
anunciando que está esperando uma escolha.

Prova: revisão visual independente com as duas telas lado a lado, nos dois viewports,
registrada em `.estado/` conforme a regra de fidelidade — quem constrói a tela não é
quem confere.

### Bloco 4 — A Jornada

Nova superfície do quiz, com a casca do Bloco 3 e canvas próprio, conforme
"JORNADA · Estrutura", "CANVAS · TELA 1" e "ELEMENTO · Escolha visual".

- Árvore: `Topo fixo` (logo e progresso) e uma linha por tela, `Tela 1 · Boas-vindas`,
  com seus elementos aninhados, `+ Elemento` e `+ Nova tela`.
- Canvas: **uma tela por vez**, em coluna de largura fixa, elementos empilhados. Sem
  posicionamento livre, sem arrastar para o canto. A estreiteza é a característica, não
  a limitação: é o que faz cada tela nascer no lugar certo.
- Inspetor: os campos declarados pelo elemento no catálogo.

Módulos:

| Módulo | Função | Depende de |
|---|---|---|
| `jornada-modelo.js` | Telas, ordem, próxima tela, o que falta responder, coleta de respostas. Sem DOM. | nada |
| `jornada-editor.js` | Árvore, canvas de uma tela, inspetor. | modelo + catálogo |
| `jornada-runtime.js` | O que roda na página publicada. | modelo + catálogo |

`quiz-mecanica.js` passa a ser o núcleo de `jornada-modelo.js`: `faltamRespostas` e
`respostasDaEtapa` já estão escritas e testadas, e mudam de vocabulário — seção vira
tela. `quiz-elements.js` permanece intocado, servindo os formulários dinâmicos já
publicados, e sai quando não houver mais nenhum no ar.

Junto, a galeria ganha o modelo "Quiz de diagnóstico · Perguntas, lógica e captura de
lead", previsto na seção "Galeria de templates" do wireframe, e o diálogo de novo quiz
deixa de oferecer modelos de landing e de sugerir "Ex.: LP Alva Marketing".

### Bloco 5 — A mecânica

**Captura de lead (obrigatório).** Um elemento de campo dentro de uma tela. Ao concluir,
a Jornada envia as respostas para o mesmo caminho que as páginas já usam:
`/api/public/pages/<...>/captures/<uuid>/submissions`, gravando em `page_submissions`
com `capture_id`, `answers` e `tracking_event_id`. Leads, webhook, integrações e
conversões passam a funcionar no quiz sem nenhum código novo de servidor — o quiz
continua sendo uma linha em `pages`, com `kind = 'quiz'`.

**Destino (obrigatório).** A última tela declara um destino. O runtime redireciona
preservando os parâmetros de origem da visita, como faz a referência estudada, onde as
UTMs atravessam três domínios intactas. Sem destino configurado, a tela final é exibida
e nada é enviado, em vez de quebrar.

**Ramificação (desejável).** Cada opção pode declarar `proxima`, o identificador de uma
tela. Sem `proxima`, vale a ordem. Entra se couber como esse único campo no formato e no
inspetor; não entra se exigir um editor de regras. O schema já prevê `branching.rules`,
e este é o bloqueio registrado em `.estado/homologacao-pre-publicacao-2026-09-10.md`.

## O formato do dado

`pages.editor_state` de uma linha com `kind = 'quiz'`:

```json
{
  "formato": "jornada",
  "versao": 1,
  "topo": { "elementos": [ { "tipo": "logo" }, { "tipo": "progresso" } ] },
  "telas": [
    {
      "id": "t1",
      "nome": "Boas-vindas",
      "elementos": [
        { "id": "e1", "tipo": "titulo", "texto": "Vamos conhecer você?" },
        { "id": "e2", "tipo": "campo", "rotulo": "Qual é o seu nome?", "nome": "nome", "obrigatorio": true },
        { "id": "e3", "tipo": "opcoes", "pergunta": "Como prefere o contato?", "multipla": false,
          "opcoes": [
            { "id": "o1", "rotulo": "WhatsApp", "descricao": "Resposta rápida", "midia": "chat", "pontos": 0, "proxima": "" }
          ] }
      ]
    }
  ],
  "destino": { "url": "", "preservarParametros": true }
}
```

Regras do formato:

- Todo identificador é estável: renomear uma tela não muda `id`, senão a ramificação
  aponta para o vazio.
- `pontos` existe desde a versão 1 e é ignorado na V1. Está aqui para que a pontuação,
  quando entrar, não exija migração.
- `proxima` vazio significa "a próxima na ordem".
- `versao` permite ler um formato antigo sem adivinhação.

O JSON pequeno e legível é também o que torna viável o agente MCP criar um rascunho de
quiz — hoje ele não conseguiria montar um projeto do GrapesJS.

## Migração dos quizzes existentes

Um quiz criado entre 2026-09-08 e hoje é uma página do GrapesJS com a marca `kind='quiz'`
e não tem `formato: 'jornada'`. Regra: **linha de quiz sem `formato: 'jornada'` volta a
ser `kind='page'`.** Ela era uma landing page com uma marca por cima, e continua sendo
exatamente a mesma página — nada se perde, nada fica escondido.

Antes de aplicar, contar quantas linhas isso atinge em cada ambiente. Se houver quiz real
em uso, a conversão passa a ser uma pergunta para o dono, não uma decisão de quem
implementa.

## Erros e casos de borda

- **Tela sem avanço.** Uma tela sem botão nem opção trava a jornada ali. O editor avisa
  no momento da autoria, como `secoesSemAvanco` já faz hoje.
- **Ramificação órfã.** `proxima` apontando para tela removida cai na ordem natural e o
  editor sinaliza.
- **Obrigatório não respondido.** O avanço é recusado na tela, sem recarregar.
- **Destino ausente.** A jornada termina e não envia, em vez de quebrar.
- **Envio falho.** A resposta fica no navegador e é reenviada na próxima tentativa; o
  visitante nunca vê um erro técnico.
- **Sem JavaScript.** As telas são escondidas por script, não por CSS — como já é hoje —
  para a página não ficar em branco.

## Testes

- `catalogo-elementos.test.mjs`: cada elemento gera HTML com classe do sistema, sem
  estilo inline de cor ou tamanho, e os campos declarados batem com o inspetor.
- `jornada-modelo.test.mjs`: ordem, próxima tela, ramificação, obrigatórios e coleta.
- `jornada-runtime.test.mjs`: avanço, validação, envio único ao concluir, destino com
  parâmetros preservados.
- `jornada-publicacao.test.mjs`: o snapshot publicado contém uma tela por vez, a captura
  aponta para o gateway assinado e as respostas chegam em `page_submissions`.
- Regressão do Bloco 1: o canvas do quiz recebe a folha do sistema.
- Revisão visual em navegador dos Blocos 2, 3 e 4, em 1440×900 e 390×844, com a seção do
  wireframe citada pelo título exato e o screenshot registrado em `.estado/`.

## Riscos

- **O catálogo duplicar.** Se a Jornada ganhar um `render` próprio "só para este caso",
  o erro de 2026-09-08 volta. O teste do catálogo é a defesa: o HTML de um elemento tem
  uma origem só.
- **A casca de três colunas em telas estreitas.** O wireframe define o comportamento em
  390×844; a revisão precisa cobrir os dois viewports, não só o desktop.
- **Escopo do Bloco 2.** Redesenhar todos os elementos é o item mais caro do plano. Se
  precisar ser fatiado, a ordem é: os seis de quiz primeiro, porque são os piores e são
  o que o Bloco 4 consome.

## Seções do wireframe citadas

`docs/wireframes/alva-studio-ui-reference.html`:

- "PÁGINA · Estrutura", "CANVAS · COMPUTADOR", "CONTEÚDO · Título principal" — Bloco 3.
- "JORNADA · Estrutura", "CANVAS · TELA 1", "ELEMENTO · Escolha visual" — Bloco 4.
- "Biblioteca visual" — Bloco 2.
- "Galeria de templates" — modelo de quiz, Bloco 4.
