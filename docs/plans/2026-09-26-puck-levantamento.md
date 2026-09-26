# Trocar o GrapesJS pelo Puck — o terreno antes do plano

Levantamento de 26/09/2026. Dois mapeamentos independentes: o acoplamento
técnico com o GrapesJS e o inventário de elementos que o produto oferece hoje.

O que segue **não é o plano de migração** — é o que precisa estar na mesa antes
de escrevê-lo, porque três das descobertas mudam a conversa.

---

## A boa notícia, e ela é grande

**Nenhuma página publicada depende do editor.** A publicação serve
`rendered_html` — HTML já achatado, com CSS e JS embutidos — e nunca
reinterpreta o estado do editor. A única leitura do `editor_state` no caminho
de publicação é uma varredura genérica procurando nós `{ type: 'vsl' }`, que
funciona com qualquer formato.

Consequência prática: **trocar o editor amanhã não derruba nada que está no ar.**
O risco fica inteiro em reabrir para edição o que já existe — problema de
conversão de formato, não de disponibilidade. É uma migração muito menos
perigosa do que aparenta.

---

## As três descobertas que mudam a conversa

### 1. O quiz que o Studio cria hoje não tem ramificação nem cálculo

Existem **dois sistemas de quiz** vivos ao mesmo tempo:

- **O ativo**: páginas com `kind='quiz'`, editadas no GrapesJS. O runtime
  publicado (`public/quiz-runtime.js`) trata cada seção como etapa e avança por
  índice. **Sem ramificação. Sem cálculo.**
- **O legado**: a tabela `forms`, renderizada por `server/dynamic-form.mjs`, com
  duas engines de verdade — `quiz-navigation.js` (regras condicionais, ciclo-
  seguro) e `quiz-calculations.js` (contas sobre respostas). As duas são funções
  puras, testadas, sem DOM e sem GrapesJS. E estão **órfãs**: nada do fluxo que
  o produto usa hoje as chama.

Isso é mais importante do que a escolha do editor. Um plano que assuma "a
ramificação já existe e é independente" bate de frente com o fato de que ela não
está ligada no quiz que o Studio cria. Ligar as duas engines ao fluxo ativo é
trabalho de produto que independe do Puck — e que provavelmente vale mais do que
a troca do editor.

### 2. O `editor_state` é o formato interno do GrapesJS, não um esquema do Alva

Não existe uma camada própria entre o editor e o banco: o que é salvo é
`editor.getProjectData()` cru. Duas consequências:

- Reabrir uma página antiga num editor Puck exige um conversor, ou a página abre
  vazia.
- **`server/page-capture-schema.mjs` é um walker escrito contra a forma de nó do
  GrapesJS** (`tagName`, `attributes`, `components`). Ele roda em toda gravação e
  em toda publicação, e é ele que descobre os campos de um formulário numa
  página. Essa é a dependência escondida mais cara: parece lógica de negócio,
  e está amarrada ao editor.

Se houver um passo a fazer antes de qualquer migração, é este: **dar ao Alva um
esquema próprio de página**, com o estado do editor virando detalhe de
implementação. Feito isso, trocar de editor vira trocar de peça.

### 3. Os testes do formato salvo dão falsa sensação de segurança

Seis arquivos de teste cobrem o formato salvo sem importar o pacote `grapesjs` —
o que parece proteger a migração. Não protege: eles constroem à mão fixtures que
imitam a árvore do GrapesJS. Passam hoje e continuariam passando mesmo que
ninguém tivesse pensado em como o Puck produziria o mesmo esquema.

Doze outros arquivos instanciam `grapesjs.init()` de verdade e morrem na troca.
Vários existem especificamente para provar comportamentos de serialização do
GrapesJS — por exemplo, que atalho de CSS com `var()` é descartado no
round-trip, cicatriz que moldou como o catálogo de elementos escreve CSS até
hoje (longhand em vez de atalho, cor nunca dentro de shorthand).

---

## O catálogo que precisa sobreviver

**10 blocos de página**: Seção, Duas colunas, Título, Texto, Botão, Ícone,
Imagem, VSL do Studio, Campo de texto, Formulário.

**12 combinações de pergunta no quiz**: 6 exclusivas (escolha única, múltipla
escolha, escolha visual, lista de opções, escala, arquivo) e 6 tipos do campo de
texto (texto, e-mail, telefone, número, data, texto longo).

**~13 tipos reconhecidos pelo motor mas sem bloco na paleta** — herdados de
versões anteriores: carrossel de depoimentos, gráfico de barras e donut,
contagem regressiva, cronômetro, logo, progresso, loader, CTA no meio do fluxo.
Têm CSS, comportamento e inspetor prontos; só não há como inserir um novo. A
migração é a hora de decidir: resgatar ou aposentar. O que não for decidido
some sem ninguém notar.

**A divisão honesta**: por volume, ~60% do catálogo é vocabulário genérico de
qualquer construtor de página. Pelo que diferencia o Alva no mercado, a minoria
específica — escolha visual com imagem por opção, gráfico ligado a cálculo de
respostas, ramificação, avanço automático, VSL com medição própria, webhook por
formulário — é onde está o risco real de perder algo que só aparece quando um
cliente reclama.

---

## O que já foi consertado enquanto se levantava isto

Dois defeitos da mesma família — o editor deixando montar o que o servidor
recusa — foram corrigidos e commitados (`119148c`):

- "Data" e "Arquivo" eram oferecidos pelo inspetor e recusados na publicação de
  uma landing, com a falha aparecendo só no botão Publicar.
- Elemento decorativo marcado como obrigatório tornava o quiz impossível de
  enviar: o servidor exigia resposta de um campo que a tela nunca desenha.

---

## Duas decisões para o dono, antes de escrever o plano

**1. Esquema próprio antes do editor novo, ou os dois juntos?**
Dar ao Alva um formato de página que não seja o do GrapesJS é o que transforma
esta migração de reescrita em troca de peça. É um passo a mais agora e menos
risco depois — e, se for feito primeiro, a migração de editor deixa de ser um
evento único e arriscado.

**2. O que fazer com o legado órfão.**
As engines de ramificação e cálculo existem, são boas e ninguém as usa. A tabela
`forms` ainda aceita escrita por uma rota, enquanto a interface só escreve em
`pages`. E existe um `editor-novo.html` usando o Studio SDK (pago) que não está
ligado a nenhuma navegação — um protótipo de migração anterior que nunca chegou
a produção. Três pontas soltas que a migração vai encontrar pela frente.
