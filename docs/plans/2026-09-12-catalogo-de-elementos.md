# Catálogo de elementos — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** fazer todo elemento do Studio nascer diagramado, nas landing pages e no quiz, a partir de uma folha única de estilo com dono conhecido.

**Arquitetura:** o design dos elementos já existe em `packages/studio/public/quiz-elements.js:107` — uma folha completa (`.choice`, `.answer`, `.scale`, `.upload`, `.loader`, `.countdown`) escrita para o editor de quiz que foi removido em 2026-09-09. Ela continua servindo os formulários dinâmicos publicados, mas o editor novo nunca a carrega, porque `blockStyles()` sai antes quando o canvas é de quiz. Este plano separa as regras de elemento das regras de página daquela folha, coloca as de elemento num módulo de catálogo com paleta em variáveis, liga esse módulo aos dois canvases e cobre com um teste que impede um elemento sem regra de voltar a existir.

**Stack:** JavaScript ESM, GrapesJS 0.23.6, `node:test` com `jsdom`.

**Spec:** `docs/specs/2026-09-12-catalogo-e-jornada-design.md`

**Alcance deste plano:** Blocos 1 e 2 da spec. Os Blocos 3 (casca de três colunas), 4 (Jornada) e 5 (mecânica) recebem planos próprios depois que este entrar, porque cada um precisa produzir software funcionando sozinho e um plano único aqui passaria de cinquenta tarefas.

## Restrições globais

- Comando de teste: `node --test packages/studio/test/<arquivo>.test.mjs`. Suíte inteira: `node --test packages/studio/test/*.test.mjs`.
- Nenhuma cor, raio, sombra, família ou tamanho novo. Use os valores que já existem em `packages/studio/public/styles.css` (`:root`, a partir da linha 1) e em `templateCss`. Se faltar um token, isso é pergunta para o dono, não decisão de quem implementa.
- Não usar `@grapesjs/studio-sdk`. Licença comercial, não contratada.
- Não alterar o comportamento dos formulários dinâmicos já publicados: `quiz-elements.js` continua exportando a folha completa que o servidor usa.
- Quiz continua sendo uma linha em `pages` com `kind = 'quiz'`. Nenhuma migração de banco neste plano.
- Estamos na `main`. Crie uma branch antes do primeiro commit: `git switch -c feat/catalogo-de-elementos`.
- Toda mensagem de commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Pronto exige verificação visual em navegador, não só teste verde (Tarefa 7). Quem constrói a tela não é quem confere.

---

### Tarefa 1: Separar as regras de elemento das regras de página

**Arquivos:**
- Criar: `packages/studio/public/catalogo-elementos.js`
- Modificar: `packages/studio/public/quiz-elements.js:107` (a constante `css`)
- Testar: `packages/studio/test/catalogo-elementos.test.mjs`

**Interfaces:**
- Produz: `elementosCss` (string) — as regras que desenham elementos, sem nada que pinte a página. `quiz-elements.js` continua exportando `quizElementCss` com o mesmo conteúdo de hoje.

A folha atual mistura duas coisas. Regras de **elemento** desenham a peça: `.answer`, `textarea.answer`, `.choices`, `.choice`, `.choice input`, `.choice-key`, `.image-choices`, `.choice-image`, `.choice-visual`, `.scale`, `.upload`, `.step-media`, `.native-video`, `.media-placeholder`, `.video`, `.custom-cta`, `.statement-line`, `.chart`, `.bar-row`, `.chart-donut`, `.donut`, `.legend`, `.loader`, `.countdown`, `.timer-toggle`, `.element-icon`, `.description`, mais `@keyframes grow` e `@keyframes spin`.

Regras de **página** pintam a tela inteira e ficam onde estão: `:root`, `body`, `.shell`, `.shell:before`, `.shell:after`, `.brand`, `.brand-mark`, `.funnel-header`, `.fixed-elements`, `.funnel-logo`, `.progress`, `.progress-row`, `.progress-value`, `.card`, `.screen`, `.screen-kicker`, `.screen-elements`, `.screen-element`, `.actions`, `.back`, `.next`, `.hint`, `.error`, e `@keyframes ambient`, `orb`, `fadeUp`, `slideLeft`, `zoomIn`, `float`.

Essa divisão é a tarefa inteira: levar um `body{background:radial-gradient(...)}` para dentro do canvas do editor apagaria o modelo da landing page.

A paleta sai de `:root` e passa a viver em variáveis com prefixo próprio, declaradas junto das regras de elemento, para a folha funcionar em qualquer página.

- [ ] **Passo 1: Escrever o teste que falha**

Crie `packages/studio/test/catalogo-elementos.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementosCss } from '../public/catalogo-elementos.js';
import { quizElementCss } from '../public/quiz-elements.js';

test('a folha dos elementos desenha peças, não a página', () => {
  assert.match(elementosCss, /\.choice\{/);
  assert.match(elementosCss, /\.scale\{/);
  assert.match(elementosCss, /\.upload\{/);
  assert.match(elementosCss, /\.answer\{/);
  assert.doesNotMatch(elementosCss, /(^|})body\{/);
  assert.doesNotMatch(elementosCss, /\.shell/);
  assert.doesNotMatch(elementosCss, /@keyframes ambient/);
});

test('a paleta da folha vem de variáveis próprias', () => {
  assert.match(elementosCss, /--alva-el-accent:/);
  assert.doesNotMatch(elementosCss, /var\(--accent\)/);
});

test('os formulários dinâmicos publicados continuam com a folha inteira', () => {
  assert.match(quizElementCss, /\.choice\{/);
  assert.match(quizElementCss, /body\{/);
  assert.match(quizElementCss, /\.funnel-header\{/);
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: FALHA com `Cannot find module '../public/catalogo-elementos.js'`.

- [ ] **Passo 3: Criar o módulo com as regras de elemento**

Crie `packages/studio/public/catalogo-elementos.js`. Recorte de `quiz-elements.js:107` **apenas** os seletores listados acima como regras de elemento, trocando `var(--accent)` por `var(--alva-el-accent)`, `var(--ink)` por `var(--alva-el-ink)`, `var(--muted)` por `var(--alva-el-muted)`, `var(--line)` por `var(--alva-el-line)` e `var(--cloud)` por `var(--alva-el-surface)`:

```js
// A folha que desenha os elementos, separada da folha que pinta a página.
//
// Ela nasceu no editor de quiz que saiu em 2026-09-09 e continuou correta: cartão de
// escolha com estado, escala com bolha, área de envio pontilhada. O que faltava era
// alguém carregá-la. A paleta sai em variáveis para o mesmo elemento servir a um modelo
// claro e a um escuro sem uma segunda folha.
const paleta = `:root{--alva-el-accent:#286eea;--alva-el-accent-soft:#eef4ff;--alva-el-ink:#101828;--alva-el-muted:#667085;--alva-el-line:#dce5f1;--alva-el-surface:#ffffff}`;

const regras = `.answer{width:100%;border:1px solid var(--alva-el-line);border-radius:17px;padding:17px 18px;background:var(--alva-el-surface);color:var(--alva-el-ink);font:inherit;font-size:17px;outline:none;resize:vertical;box-shadow:0 5px 15px #1b315b0a}`
  // Recorte mecânico: copie de quiz-elements.js:107, na ordem em que aparecem lá, as
  // regras destes seletores, sem reescrever nenhuma declaração —
  // .answer:focus, textarea.answer, .choices, .choice, .choice:hover, .choice input,
  // .choice-key, .image-choices, .choice-image, .choice-visual, .scale, .upload,
  // .step-media, .native-video, .media-placeholder, .video, .custom-cta,
  // .statement-line, .chart, .bar-row, .chart-donut, .donut, .legend, .loader,
  // .countdown, .timer-toggle, .element-icon, .description —
  // mais @keyframes grow, @keyframes spin e as linhas do @media(max-width:600px) que
  // tocam .image-choices e .choice-image. Tudo o que não estiver nesta lista fica em
  // quiz-elements.js. O teste do Passo 1 confere as quatro pontas da divisão.
  ;

export const elementosCss = paleta + regras;
```

- [ ] **Passo 4: Fazer `quiz-elements.js` consumir o módulo**

Em `packages/studio/public/quiz-elements.js`, importe a folha e remonte a completa, para os formulários publicados não mudarem um pixel:

```js
import { elementosCss } from './catalogo-elementos.js';

// As regras que pintam a página inteira do formulário dinâmico. As de elemento agora
// moram no catálogo, porque o editor de páginas também precisa delas.
const chromeCss = `:root{--accent:#286eea;...}` /* o que sobrou de css, sem as regras de elemento */;

export const quizElementCss = chromeCss + elementosCss + vslCss;
```

- [ ] **Passo 5: Rodar os testes e confirmar que passam**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: PASSA, 3 testes.

Rodar também os que já existiam e dependem dessa folha: `node --test packages/studio/test/dynamic-form.test.mjs packages/studio/test/quiz-preview.test.mjs`
Esperado: PASSA, sem mudança.

- [ ] **Passo 6: Commit**

```bash
git switch -c feat/catalogo-de-elementos
git add packages/studio/public/catalogo-elementos.js packages/studio/public/quiz-elements.js packages/studio/test/catalogo-elementos.test.mjs
git commit -m "$(cat <<'MSG'
refactor(studio): o desenho dos elementos sai de dentro do quiz antigo

A folha que desenha cartão de escolha, escala e área de envio estava presa em
quiz-elements.js, junto das regras que pintam a página inteira do formulário.
Enquanto estivesse lá, o editor não podia carregá-la: levar junto o body com
gradiente apagaria o modelo da landing page.

As regras de elemento saem para catalogo-elementos.js com a paleta em
variáveis. quiz-elements.js remonta a folha completa, então nenhum formulário
já publicado muda.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 2: O canvas do quiz passa a receber a folha

**Arquivos:**
- Modificar: `packages/studio/public/editor-shell.js:1709-1727` (`formStyles` e `blockStyles`)
- Testar: `packages/studio/test/editor-folhas-do-canvas.test.mjs`

**Interfaces:**
- Consome: `elementosCss` da Tarefa 1.
- Produz: `folhasDoCanvas({ quizCanvas, cssExistente })` exportada de `editor-shell.js`, devolvendo `{ folhas: string[], normalizarFormularios: boolean }`.

Hoje `blockStyles()` começa com `if (quizCanvas) return;` e `formStyles()` com `if (!quizCanvas) normalizeForms(editor)`. O comentário diz que o canvas de quiz "já traz seu CSS próprio" — era verdade no editor antigo e deixou de ser quando o quiz virou página. O resultado é um canvas sem folha nenhuma.

A decisão de qual folha entra vira função pura, como já é feito em `quiz-mecanica.js`, para poder ser testada antes de virar tela.

- [ ] **Passo 1: Escrever o teste que falha**

Crie `packages/studio/test/editor-folhas-do-canvas.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folhasDoCanvas } from '../public/editor-shell.js';
import { templateCss } from '../public/templates.js';
import { elementosCss } from '../public/catalogo-elementos.js';

test('o canvas do quiz recebe a folha dos elementos', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: '' });
  assert.ok(folhas.includes(elementosCss), 'a folha dos elementos entra no quiz');
  assert.ok(folhas.includes(templateCss), 'a folha do modelo entra no quiz');
});

test('a landing também recebe a folha dos elementos', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '' });
  assert.ok(folhas.includes(elementosCss));
  assert.ok(folhas.includes(templateCss));
});

test('uma página que já tem o modelo não recebe o modelo de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '.hero-grid{display:grid}' });
  assert.ok(!folhas.includes(templateCss), 'não reaplica o modelo por cima do trabalho salvo');
});

test('formulários são normalizados nos dois canvases', () => {
  assert.equal(folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).normalizarFormularios, true);
  assert.equal(folhasDoCanvas({ quizCanvas: false, cssExistente: '' }).normalizarFormularios, true);
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `node --test packages/studio/test/editor-folhas-do-canvas.test.mjs`
Esperado: FALHA com `folhasDoCanvas is not a function`.

- [ ] **Passo 3: Escrever a função pura**

Em `packages/studio/public/editor-shell.js`, junto das outras funções exportadas do topo do arquivo:

```js
// Qual folha entra no canvas. Era um if dentro do editor, e por isso o quiz ficou sem
// folha nenhuma quando virou página: ninguém conseguia afirmar essa decisão num teste.
export function folhasDoCanvas({ quizCanvas = false, cssExistente = '' } = {}) {
  const jaTemModelo = /--alva-block-base\s*:\s*1/.test(cssExistente) || cssExistente.includes('.hero-grid');
  const folhas = [elementosCss];
  if (!jaTemModelo) folhas.push(templateCss);
  return { folhas, normalizarFormularios: true, quizCanvas };
}
```

Importe `elementosCss` no topo do arquivo, junto de `templateCss`.

- [ ] **Passo 4: Rodar o teste e confirmar que passa**

Rodar: `node --test packages/studio/test/editor-folhas-do-canvas.test.mjs`
Esperado: PASSA, 4 testes.

- [ ] **Passo 5: Ligar a função ao editor**

Substitua o corpo de `formStyles` e `blockStyles` em `packages/studio/public/editor-shell.js:1709`:

```js
  function formStyles() {
    if (folhasDoCanvas({ quizCanvas }).normalizarFormularios) normalizeForms(editor);
  }
  function blockStyles() {
    const existingCss = editor.getCss();
    const versaoNaPagina = Number(existingCss.match(/--alva-runtime\s*:\s*(\d+)/)?.[1] || 0);
    if (versaoNaPagina < RUNTIME_CSS_VERSION) editor.addStyle(runtimeCss);
    const { folhas } = folhasDoCanvas({ quizCanvas, cssExistente: existingCss });
    if (!folhas.length) return;
    // Preserva cada declaração de quem editou: a folha entra por baixo, não por cima.
    const custom = editor.Css.getAll().map((rule) => ({ rule, style: { ...rule.getStyle() } }));
    folhas.forEach((folha) => editor.addStyle(folha));
    if (folhas.includes(templateCss)) editor.addStyle(':root{--alva-block-base:1}');
    custom.forEach(({ rule, style }) => rule.addStyle(style));
  }
```

- [ ] **Passo 6: Rodar a suíte inteira**

Rodar: `node --test packages/studio/test/*.test.mjs`
Esperado: PASSA, sem falha nova. Se algum teste de quiz falhar por esperar canvas sem folha, esse teste descrevia a regressão: corrija-o para afirmar o comportamento novo e registre isso na mensagem do commit.

- [ ] **Passo 7: Commit**

```bash
git add packages/studio/public/editor-shell.js packages/studio/test/editor-folhas-do-canvas.test.mjs
git commit -m "$(cat <<'MSG'
fix(studio): o canvas do quiz volta a receber folha de estilo

blockStyles saía antes de fazer qualquer coisa quando o canvas era de quiz. O
comentário explicava que o quiz trazia CSS próprio, o que era verdade no editor
antigo e deixou de ser quando o quiz passou a usar os blocos da página. Desde
então o quiz aparecia com a fonte padrão do navegador e os campos enfileirados.

A escolha da folha vira função pura e testável, como a mecânica já é. Uma
página que já tem o modelo salvo continua não recebendo o modelo de novo, para
não passar por cima do que a pessoa editou.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 3: O contrato do catálogo e a prova que impede elemento sem regra

**Arquivos:**
- Modificar: `packages/studio/public/catalogo-elementos.js`
- Testar: `packages/studio/test/catalogo-elementos.test.mjs`

**Interfaces:**
- Produz: `catalogo` (array) e `elementoPorId(id)`. Cada entrada: `{ id, nome, grupo, icone, seletor, descricao, render() }`, onde `seletor` é o seletor CSS que alcança o elemento e `render()` devolve o HTML.

Esta é a tarefa que dá dono ao HTML. O invariante — todo elemento do catálogo tem um seletor que existe em alguma folha do sistema — é o que impede o defeito de hoje de voltar: um bloco entrar no canvas sem nenhuma regra que o alcance.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescente a `packages/studio/test/catalogo-elementos.test.mjs`:

```js
import { catalogo, elementoPorId, elementosCss } from '../public/catalogo-elementos.js';
import { templateCss } from '../public/templates.js';

const folhaDoSistema = elementosCss + templateCss;

test('todo elemento do catálogo declara identidade completa', () => {
  assert.ok(catalogo.length > 0);
  for (const elemento of catalogo) {
    assert.ok(elemento.id, 'id');
    assert.ok(elemento.nome, `nome de ${elemento.id}`);
    assert.ok(elemento.grupo, `grupo de ${elemento.id}`);
    assert.ok(elemento.seletor, `seletor de ${elemento.id}`);
    assert.equal(typeof elemento.render, 'function', `render de ${elemento.id}`);
  }
});

test('o seletor de um elemento é sempre uma classe', () => {
  // Seletor de tag tornaria esta prova inútil: toda folha contém a letra "p".
  // Exigir classe é o que faz o elemento ter um endereço só dele.
  for (const elemento of catalogo) {
    assert.ok(elemento.seletor.startsWith('.'), `${elemento.id} precisa declarar uma classe, não ${elemento.seletor}`);
  }
});

test('nenhum elemento nasce sem regra que o alcance', () => {
  for (const elemento of catalogo) {
    assert.ok(
      folhaDoSistema.includes(`${elemento.seletor}{`) || folhaDoSistema.includes(`${elemento.seletor},`) || folhaDoSistema.includes(`${elemento.seletor} `),
      `${elemento.id} declara o seletor ${elemento.seletor}, que não abre regra em nenhuma folha`,
    );
  }
});

test('o HTML do elemento casa com o seletor que ele declara', () => {
  for (const elemento of catalogo) {
    const classe = elemento.seletor.slice(1);
    assert.match(elemento.render(), new RegExp(`class="[^"]*\\b${classe}\\b`), `${elemento.id} não emite a classe ${classe}`);
  }
});

test('elemento não carrega cor nem tamanho embutidos no HTML', () => {
  for (const elemento of catalogo) {
    assert.doesNotMatch(elemento.render(), /style="[^"]*(color|font-size|background)/i, `${elemento.id} embute estilo no HTML`);
  }
});

test('elementoPorId acha e devolve indefinido para o que não existe', () => {
  assert.equal(elementoPorId('heading')?.nome, 'Título');
  assert.equal(elementoPorId('inexistente'), undefined);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: FALHA com `catalogo is not iterable` ou `SyntaxError` de exportação ausente.

- [ ] **Passo 3: Declarar o catálogo com os elementos de conteúdo**

Em `packages/studio/public/catalogo-elementos.js`, abaixo da folha, copiando o HTML atual de `templates.js:277-302` sem mudar uma vírgula, para esta tarefa não alterar o que já aparece na tela:

```js
export const catalogo = [
  { id: 'section', nome: 'Seção', grupo: 'Estrutura', icone: 'view_day', seletor: '.alva-secao',
    descricao: 'Uma faixa nova da página, para separar um assunto do outro.',
    render: () => '<section class="alva-secao"><h2 class="alva-titulo">Uma nova seção</h2><p class="alva-texto">Conte sua história aqui.</p></section>' },
  { id: 'heading', nome: 'Título', grupo: 'Conteúdo', icone: 'title', seletor: '.alva-titulo',
    descricao: 'Um título para anunciar o que vem a seguir.',
    render: () => '<h2 class="alva-titulo">Seu próximo grande título</h2>' },
  { id: 'text', nome: 'Texto', grupo: 'Conteúdo', icone: 'notes', seletor: '.alva-texto',
    descricao: 'Um parágrafo para explicar sua ideia.',
    render: () => '<p class="alva-texto">Uma mensagem simples para apresentar sua solução.</p>' },
  { id: 'button', nome: 'Botão', grupo: 'Conteúdo', icone: 'smart_button', seletor: '.cta',
    descricao: 'Um convite para a pessoa dar o próximo passo.',
    render: () => '<a href="#contato" class="cta">Quero saber mais ↗</a>' },
  { id: 'icon', nome: 'Ícone', grupo: 'Conteúdo', icone: 'star', seletor: '.material-symbols-outlined',
    descricao: 'Um símbolo para reforçar uma ideia rapidamente.',
    render: () => '<span class="material-symbols-outlined" aria-hidden="true">star</span>' },
];

export const elementoPorId = (id) => catalogo.find((elemento) => elemento.id === id);
```

O `section` deixa de carregar `style="padding:60px 7%;min-height:140px"` embutido e passa a
pedir por uma classe. Acrescente a `regras`, em `catalogo-elementos.js`, as três que faltam —
só espaçamento, herdando cor e tamanho do modelo, para o elemento continuar respeitando a
paleta da página em que cair:

```css
.alva-secao{padding:60px 7%;min-height:140px}
.alva-titulo{margin:0 0 16px}
.alva-texto{margin:0 0 16px;max-width:70ch}
@media(max-width:760px){.alva-secao{padding:40px 6%}}
```

`.cta` e `.material-symbols-outlined` já existem em `templateCss` e não precisam de regra nova.

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: PASSA, 8 testes.

- [ ] **Passo 5: Commit**

```bash
git add packages/studio/public/catalogo-elementos.js packages/studio/test/catalogo-elementos.test.mjs
git commit -m "$(cat <<'MSG'
feat(studio): o catálogo passa a ser o dono do HTML dos elementos

Cada elemento declara nome, grupo, ícone, descrição, o HTML que produz e o
seletor que o alcança. O seletor é o que faltava: com ele, um teste consegue
afirmar que nenhum elemento nasce sem regra, que é exatamente o defeito de
hoje — o modelo é bem diagramado e tudo acrescentado depois entra pelado.

Esta entrega não muda nenhuma tela: o HTML é o mesmo de templates.js.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 4: `templates.js` passa a derivar os blocos do catálogo

**Arquivos:**
- Modificar: `packages/studio/public/templates.js:264-302` (`blockDescriptions` e `blocks`)
- Testar: `packages/studio/test/catalogo-blocos.test.mjs`

**Interfaces:**
- Consome: `catalogo` da Tarefa 3.
- Produz: `blocks` com a mesma forma de hoje — `[id, rotulo, grupo, conteudo]` — agora derivada.

Os elementos que ainda não estão no catálogo (`columns`, `image`, `vsl`, `form`, `input`) continuam declarados em `templates.js` nesta tarefa. Migrá-los todos de uma vez tornaria esta entrega grande demais para uma revisão; `input` vai na Tarefa 6, os outros vão junto do Bloco 4.

- [ ] **Passo 1: Escrever o teste que falha**

Crie `packages/studio/test/catalogo-blocos.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';
import { catalogo } from '../public/catalogo-elementos.js';

const porId = new Map(blocks.map(([id, rotulo, grupo, conteudo]) => [id, { rotulo, grupo, conteudo }]));

test('todo elemento do catálogo vira bloco do editor', () => {
  for (const elemento of catalogo) {
    const bloco = porId.get(elemento.id);
    assert.ok(bloco, `o bloco ${elemento.id} sumiu do catálogo do editor`);
    assert.equal(bloco.rotulo, elemento.nome);
    assert.equal(bloco.grupo, elemento.grupo);
    assert.equal(bloco.conteudo, elemento.render());
  }
});

test('os blocos que ainda não migraram continuam de pé', () => {
  for (const id of ['columns', 'image', 'vsl', 'form', 'input']) {
    assert.ok(porId.get(id), `o bloco ${id} desapareceu`);
  }
});

test('todo bloco tem descrição', () => {
  for (const [id] of blocks) assert.ok(blockDescriptions[id], `falta descrição de ${id}`);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `node --test packages/studio/test/catalogo-blocos.test.mjs`
Esperado: FALHA na comparação de `conteudo`, porque hoje as duas strings são declaradas em lugares diferentes.

- [ ] **Passo 3: Derivar os blocos**

Em `packages/studio/public/templates.js`, importe o catálogo e monte `blocks` a partir dele, mantendo a ordem atual da lista:

```js
import { catalogo } from './catalogo-elementos.js';

const doCatalogo = (id) => {
  const elemento = catalogo.find((item) => item.id === id);
  return [elemento.id, elemento.nome, elemento.grupo, elemento.render()];
};

export const blocks = [
  doCatalogo('section'),
  ['columns', 'Duas colunas', 'Estrutura', '<div style="display:flex;flex-wrap:wrap;gap:24px;padding:30px"><div style="flex:1;min-width:240px;min-height:100px"><h3>Primeira coluna</h3></div><div style="flex:1;min-width:240px;min-height:100px"><h3>Segunda coluna</h3></div></div>'],
  doCatalogo('heading'),
  doCatalogo('text'),
  ['image', 'Imagem', 'Conteúdo', { type: 'image' }],
  ['vsl', 'VSL do Studio', 'Mídia', { type: 'vsl', publicId: '', attributes: { 'data-alva-vsl': '' } }],
  doCatalogo('button'),
  doCatalogo('icon'),
  ['form', 'Formulário', 'Captação', form()],
  ['input', 'Campo de texto', 'Captação', '<label>Novo campo<input name="novo_campo" type="text" placeholder="Digite aqui"></label>'],
];
```

E faça `blockDescriptions` herdar do catálogo, mantendo as entradas dos que ainda não migraram:

```js
export const blockDescriptions = {
  ...Object.fromEntries(catalogo.map((elemento) => [elemento.id, elemento.descricao])),
  columns: 'Dois espaços lado a lado, para comparar ou dividir o conteúdo.',
  image: 'Uma foto ou ilustração, enviada do seu computador.',
  vsl: 'Uma VSL criada aqui no Studio, com player e medição próprios.',
  form: 'Um formulário completo para receber contatos.',
  input: 'Uma pergunta com espaço para a pessoa escrever a resposta.',
};
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `node --test packages/studio/test/catalogo-blocos.test.mjs packages/studio/test/editor-catalog-integration.test.mjs`
Esperado: PASSA nos dois. O segundo já existe e monta blocos num GrapesJS de verdade — ele é a prova de que a derivação não quebrou o editor.

- [ ] **Passo 5: Commit**

```bash
git add packages/studio/public/templates.js packages/studio/test/catalogo-blocos.test.mjs
git commit -m "$(cat <<'MSG'
refactor(studio): os blocos do editor passam a vir do catálogo

O mesmo elemento era declarado duas vezes: uma como bloco do GrapesJS e outra
como render do quiz. Duas declarações divergem, e foi assim que o quiz e a
página passaram a ter versões diferentes da mesma peça.

Agora o bloco é derivado do catálogo. Quem ainda não migrou continua declarado
aqui e tem teste que impede o desaparecimento silencioso.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 5: Os três elementos nus do quiz ganham classe

**Arquivos:**
- Modificar: `packages/studio/public/editor-shell.js:1204-1206` (`quizBlocks`)
- Modificar: `packages/studio/public/catalogo-elementos.js`
- Testar: `packages/studio/test/catalogo-elementos.test.mjs`

Estes três entram hoje como controle padrão do navegador, sem nenhuma classe:

```html
<label>Nova pergunta<select name="campo_lista">…</select></label>
<label>Como você avalia?<input type="range" name="campo_escala" min="1" max="10"></label>
<label>Envie um arquivo<input type="file" name="campo_arquivo"></label>
```

É o "Choose File" em inglês que aparece na tela. As regras que faltam já existem na folha da Tarefa 1: `.answer` para a lista, `.scale` para a escala, `.upload` para o arquivo.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescente a `packages/studio/test/catalogo-elementos.test.mjs`:

```js
test('lista, escala e arquivo nascem com a classe do sistema', () => {
  assert.match(elementoPorId('quiz-select').render(), /class="answer"/);
  assert.match(elementoPorId('quiz-range').render(), /class="scale"/);
  assert.match(elementoPorId('quiz-file').render(), /class="upload"/);
});

test('a escala mostra o valor escolhido', () => {
  const html = elementoPorId('quiz-range').render();
  assert.match(html, /<output/, 'sem output a pessoa move o controle e não sabe onde parou');
});

test('a área de envio diz o que aceita em português', () => {
  const html = elementoPorId('quiz-file').render();
  assert.doesNotMatch(html, /Choose File/i);
  assert.match(html, /Escolher arquivo|Envie/i);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: FALHA com `Cannot read properties of undefined (reading 'render')`.

- [ ] **Passo 3: Declarar os três no catálogo**

Em `packages/studio/public/catalogo-elementos.js`, acrescente ao array `catalogo`:

```js
  { id: 'quiz-select', nome: 'Lista de opções', grupo: 'Captação', icone: 'list', seletor: '.answer',
    descricao: 'Uma pergunta com resposta escolhida numa lista.',
    render: () => '<label class="answer-wrap">Nova pergunta<select class="answer" name="campo_lista"><option value="Opção 1">Opção 1</option><option value="Opção 2">Opção 2</option></select></label>' },
  { id: 'quiz-range', nome: 'Escala', grupo: 'Captação', icone: 'linear_scale', seletor: '.scale',
    descricao: 'Uma nota de um a dez, movendo um controle.',
    render: () => '<div class="scale"><span>1</span><input type="range" name="campo_escala" min="1" max="10" value="5" oninput="this.nextElementSibling.value=this.value"><output>5</output></div>' },
  { id: 'quiz-file', nome: 'Arquivo', grupo: 'Captação', icone: 'upload_file', seletor: '.upload',
    descricao: 'Um espaço para a pessoa enviar um arquivo.',
    render: () => '<label class="upload"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span><span>Escolher arquivo</span><input type="file" name="campo_arquivo" hidden></label>' },
```

Acrescente a `regras`, em `catalogo-elementos.js`, a única regra que falta na folha resgatada:

```css
.answer-wrap{display:block;margin:0 0 18px;font-size:13px;font-weight:600;color:var(--alva-el-ink)}
```

O `oninput` do `range` é comportamento de exibição, não lógica: sem ele a pessoa arrasta o controle e não vê onde parou. Ele não entra em `style`, então o teste que recusa estilo embutido continua passando.

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: PASSA, 11 testes.

- [ ] **Passo 5: Ligar ao editor**

Em `packages/studio/public/editor-shell.js:1199`, troque as três linhas soltas de `quizBlocks` por derivação do catálogo, mantendo as três de escolha como estão:

```js
  const doCatalogoQuiz = (id) => {
    const elemento = elementoPorId(id);
    return [elemento.id, elemento.nome, elemento.grupo, elemento.render()];
  };
  const quizBlocks = quizCanvas ? [
    ['quiz-single-choice', 'Escolha única', 'Captação', quizChoiceBlockMarkup({ type: 'single_choice', question: 'Nova pergunta', name: 'campo_escolha' })],
    ['quiz-multiple-choice', 'Múltipla escolha', 'Captação', quizChoiceBlockMarkup({ type: 'multiple_choice', question: 'Nova pergunta', name: 'campo_multiplas' })],
    ['quiz-image-choice', 'Escolha visual', 'Captação', quizChoiceBlockMarkup({ type: 'image_choice', question: 'Nova escolha visual', name: 'campo_visual' })],
    doCatalogoQuiz('quiz-select'),
    doCatalogoQuiz('quiz-range'),
    doCatalogoQuiz('quiz-file'),
  ] : [];
```

Importe `elementoPorId` no topo do arquivo.

- [ ] **Passo 6: Rodar a suíte inteira**

Rodar: `node --test packages/studio/test/*.test.mjs`
Esperado: PASSA.

- [ ] **Passo 7: Commit**

```bash
git add packages/studio/public/catalogo-elementos.js packages/studio/public/editor-shell.js packages/studio/test/catalogo-elementos.test.mjs
git commit -m "$(cat <<'MSG'
feat(studio): lista, escala e arquivo deixam de ser controle cru do navegador

Os três entravam no canvas como <select>, <input type=range> e <input
type=file> sem classe nenhuma — era daí que vinha o "Choose File" em inglês no
meio de um quiz em português.

As regras que faltavam já existiam na folha resgatada: .answer, .scale e
.upload. Faltava o HTML pedir por elas. A escala passa a mostrar o valor
escolhido, porque arrastar um controle sem ver onde parou não é resposta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 6: O campo de texto da landing page ganha classe

**Arquivos:**
- Modificar: `packages/studio/public/catalogo-elementos.js`
- Modificar: `packages/studio/public/templates.js` (entrada `input` de `blocks` e `blockDescriptions`)
- Testar: `packages/studio/test/catalogo-elementos.test.mjs`

Este é o elemento que o dono arrastou na revisão de 2026-09-12 e anotou "sem diagramação". Fora de um formulário, `<label>Novo campo<input></label>` não encontra nenhuma regra: `formCss` só alcança o que está dentro de `.alva-form`.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescente a `packages/studio/test/catalogo-elementos.test.mjs`:

```js
test('o campo de texto solto encontra regra fora do formulário', () => {
  const html = elementoPorId('input').render();
  assert.match(html, /class="answer-wrap"/);
  assert.match(html, /class="answer"/);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs`
Esperado: FALHA com `Cannot read properties of undefined (reading 'render')`.

- [ ] **Passo 3: Declarar o elemento**

Em `packages/studio/public/catalogo-elementos.js`:

```js
  { id: 'input', nome: 'Campo de texto', grupo: 'Captação', icone: 'text_fields', seletor: '.answer',
    descricao: 'Uma pergunta com espaço para a pessoa escrever a resposta.',
    render: () => '<label class="answer-wrap">Novo campo<input class="answer" name="novo_campo" type="text" placeholder="Digite aqui"></label>' },
```

Em `packages/studio/public/templates.js`, troque a linha solta de `blocks` por `doCatalogo('input')` e remova `input` do objeto literal de `blockDescriptions`, que agora herda do catálogo.

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `node --test packages/studio/test/catalogo-elementos.test.mjs packages/studio/test/catalogo-blocos.test.mjs`
Esperado: PASSA nos dois.

- [ ] **Passo 5: Rodar a suíte inteira**

Rodar: `node --test packages/studio/test/*.test.mjs`
Esperado: PASSA. Atenção a `normalizeForms`: um campo dentro de `.alva-form` recebe as regras do formulário e as do elemento; confirme em `editor-catalog-integration.test.mjs` que nada quebrou.

- [ ] **Passo 6: Commit**

```bash
git add packages/studio/public/catalogo-elementos.js packages/studio/public/templates.js packages/studio/test/catalogo-elementos.test.mjs
git commit -m "$(cat <<'MSG'
feat(studio): o campo de texto solto deixa de nascer sem diagramação

Fora de um formulário, o campo não encontrava regra: formCss só alcança o que
está dentro de .alva-form. Arrastar um campo para o meio da página devolvia a
caixa padrão do navegador, colada no texto anterior.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Tarefa 7: Revisão visual em navegador e registro do gate

**Arquivos:**
- Criar: `.estado/catalogo_elementos.md`
- Criar: `.estado/screenshots/catalogo-elementos-*.png`

Teste verde não prova diagramação. Esta tarefa é o gate de fidelidade da regra do projeto, e **quem a executa não pode ser quem escreveu as tarefas 1 a 6**.

- [ ] **Passo 1: Subir o Studio numa instância descartável**

```bash
docker run -d --name alva-studio-revisao -e POSTGRES_PASSWORD=revisao-local -e POSTGRES_DB=alva_studio -p 35481:5432 postgres:16-alpine
```

Depois, com `DATABASE_URL=postgres://postgres:revisao-local@127.0.0.1:35481/alva_studio` e `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_COMPANY_NAME`, `OWNER_COMPANY_SLUG` no ambiente, rode `node packages/studio/server/bootstrap-owner.mjs` com a senha pelo stdin. Suba o servidor com `PORT=4179`.

- [ ] **Passo 2: Montar a comparação**

Crie uma landing com o modelo "Serviços · contato na abertura" e um quiz em branco. No quiz, arraste Escolha única, Escolha visual, Lista de opções, Escala e Arquivo. Na landing, arraste Campo de texto para o meio de uma seção.

- [ ] **Passo 3: Comparar com o wireframe, nos dois viewports**

Abra `docs/wireframes/alva-studio-ui-reference.html` na seção **"Biblioteca visual"** e na seção **"ELEMENTO · Escolha visual"**, lado a lado com a tela implementada, em 1440×900 e em 390×844. Compare blocos, textos, espaçamento e estados — normal, sob o cursor e escolhido.

- [ ] **Passo 4: Registrar**

Salve as capturas em `.estado/screenshots/` e escreva `.estado/catalogo_elementos.md` no formato dos outros registros do diretório, nomeando a seção do wireframe conferida, o caminho de cada captura e o resultado da suíte. Sem esse registro a entrega não está pronta.

- [ ] **Passo 5: Limpar**

```bash
docker rm -f alva-studio-revisao
```

- [ ] **Passo 6: Commit**

```bash
git add .estado/catalogo_elementos.md .estado/screenshots/
git commit -m "$(cat <<'MSG'
docs(studio): registro da revisão visual do catálogo de elementos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## O que este plano deixa para os próximos

- **Bloco 3 — casca de três colunas.** Árvore, canvas e inspetor ao mesmo tempo; cabeçalho de painel; canvas com moldura; `+ Nova seção` que diz o que fez; inspetor mostrando o valor do projeto em vez do computado.
- **Bloco 4 — Jornada.** Telas na estrutura, canvas de uma tela, modelo de quiz na galeria, e a migração dos quizzes sem `formato: 'jornada'`.
- **Bloco 5 — mecânica.** Captura de lead, destino com UTMs e ramificação por opção.
- **Elementos que ainda não migraram para o catálogo:** `columns`, `image`, `vsl`, `form` e as três escolhas de quiz, que hoje vêm de `quizChoiceBlockMarkup`.

  Sobre as escolhas, uma observação para quem comparar este plano com a spec: a spec pede que elas virem "cartões com mídia opcional, rótulo, descrição e indicador de seleção, com três estados". Os três estados chegam na **Tarefa 2**, não numa tarefa de redesenho — o markup já emite `.choice`, `.choice-key` e `.choice-visual`, e a folha resgatada na Tarefa 1 já traz `.choice{...}`, `.choice:hover`, `.choice:has(input:checked)` e a grade de `.image-choices`. Carregar a folha é o redesenho. O que fica para o Bloco 4 é a **descrição por opção** e a **escolha da mídia** (emoji, ícone ou imagem), porque as duas dependem de um inspetor que declare campos a partir do catálogo — e esse inspetor é a Jornada.
