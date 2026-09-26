# Um esquema de página que é do Alva

Decisão de arquitetura, 26/09/2026. Aprovada a direção pelo dono ("esquema
antes"), com a informação de que **não há conteúdo a preservar**: o banco é de
teste, nenhum cliente rodando.

## O problema

O que o Studio salva hoje é `editor.getProjectData()` cru — o formato interno do
GrapesJS. Não existe camada do Alva entre o editor e o banco. Três consequências
que o levantamento mostrou:

1. **Trocar de editor vira reescrita.** Reabrir qualquer página exige um
   conversor do formato do GrapesJS.
2. **`page-capture-schema.mjs` é um caminhador escrito contra a forma de nó do
   GrapesJS** (`tagName`, `attributes`, `components`). Ele roda a cada gravação e
   a cada publicação, e é ele que descobre quais campos existem num formulário.
   Parece regra de negócio; é acoplamento ao editor.
3. **O HTML publicado é produzido no navegador e aceito pelo servidor.** O
   `rendered_html` sai de `editor.getHtml()` no cliente e é gravado como veio.

O terceiro é o mais sério e ninguém tinha olhado para ele: o servidor confia num
artefato montado no navegador para servir ao público.

## O que já prova que a saída funciona

`server/dynamic-form.mjs` importa `renderQuizElement` de `public/quiz-elements.js`
e **renderiza quiz no servidor, a partir de um esquema, sem editor nenhum.** O
padrão existe, está em produção e é isomórfico: o mesmo renderizador roda no
editor e no servidor.

O que falta é o mesmo para páginas. `catalogo-elementos.js` hoje devolve strings
de HTML fixas (`render: () => '<section class="alva-secao">…'`), sem receber
propriedades — ele sabe criar um elemento novo, não desenhar um existente.

## A decisão

**O esquema do Alva passa a ser a fonte da verdade, e o HTML publicado passa a
ser derivado dele no servidor.**

Formato de um nó, o mesmo que o quiz já usa:

```
{ id, tipo, props: { ... }, filhos: [ ... ] }
```

- `tipo` vem do catálogo do Alva (secao, titulo, texto, botao, icone, imagem,
  vsl, campo, formulario, escolha-unica, escolha-visual, escala, arquivo…), não
  de tag HTML.
- `props` são as propriedades que o inspetor já ajusta hoje — texto, tamanho,
  cor, alinhamento, espaçamento, destino do link, obrigatoriedade.
- `filhos` é a árvore.

Três coisas caem fora por consequência:

- **O conversor.** Não há conteúdo a preservar, então o esquema nasce limpo. Era
  metade do trabalho e desapareceu com a resposta do dono.
- **O acoplamento em `page-capture-schema.mjs`.** Descobrir os campos de um
  formulário vira percorrer a própria árvore do Alva, onde um campo é um nó de
  tipo `campo` — não um `<input>` a ser descoberto dentro de HTML.
- **A confiança no navegador.** `rendered_html` passa a ser calculado no
  servidor a partir do esquema. O editor deixa de decidir o que o público vê.

## O que o editor vira

Um leitor e escritor desse esquema. O GrapesJS continua no lugar enquanto isso —
esta etapa **não troca o editor**. Quando o Puck entrar, ele entra lendo e
escrevendo o mesmo formato, e a troca deixa de ser um evento arriscado.

## Ordem de execução

1. **O esquema e o renderizador**, com teste: um nó vira HTML, de forma pura e
   determinística. Serve páginas e quizzes, estendendo o que `quiz-elements.js`
   já faz.
2. **A extração de captura sobre o esquema**, substituindo o caminhador de nós
   do GrapesJS. Os testes atuais fixam a árvore do GrapesJS nos fixtures e dão
   falsa segurança; eles passam a descrever o formato do Alva.
3. **O servidor passa a renderizar**, e `rendered_html` deixa de ser aceito do
   cliente.
4. **O editor passa a ler e escrever o esquema**, com o GrapesJS ainda por baixo.

Cada passo é verde e commitável sozinho. Só depois disso a conversa sobre Puck
faz sentido — e aí ela é curta.

## O que fica de fora desta spec

A ramificação e o cálculo do quiz (decisão 3 do dono, aprovada) são trabalho
separado e independente: as engines existem, são puras e estão órfãs. Ligá-las
não depende do esquema nem do editor.
