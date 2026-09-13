import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import postcss from 'postcss';
import { elementosCss, catalogo, elementoPorId } from '../public/catalogo-elementos.js';
import { quizElementCss } from '../public/quiz-elements.js';
import { templateCss, formCss } from '../public/templates.js';
import { folhasDoCanvas } from '../public/editor-shell.js';

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

test('todo elemento do catálogo declara identidade completa', () => {
  assert.ok(catalogo.length > 0);
  for (const elemento of catalogo) {
    assert.ok(elemento.id, 'id');
    assert.ok(elemento.nome, `nome de ${elemento.id}`);
    assert.ok(elemento.grupo, `grupo de ${elemento.id}`);
    assert.ok(elemento.seletor, `seletor de ${elemento.id}`);
    assert.equal(typeof elemento.render, 'function', `render de ${elemento.id}`);
    // registro diz onde o elemento mora: 'pagina' entra em blocks (templates.js), 'quiz'
    // entra em quizBlocks (editor-shell.js). Sem essa declaração, um elemento novo podia
    // escapar da prova de catalogo-blocos.test.mjs sem que nada acusasse.
    assert.ok(['pagina', 'quiz'].includes(elemento.registro), `registro de ${elemento.id} precisa ser 'pagina' ou 'quiz', não ${elemento.registro}`);
  }
});

test('o seletor de um elemento é sempre uma classe', () => {
  // Seletor de tag tornaria esta prova inútil: toda folha contém a letra "p".
  // Exigir classe é o que faz o elemento ter um endereço só dele.
  for (const elemento of catalogo) {
    assert.ok(elemento.seletor.startsWith('.'), `${elemento.id} precisa declarar uma classe, não ${elemento.seletor}`);
  }
});

// Onde cada elemento pode ser solto. A paleta do quiz é `[...blocks, ...quizBlocks]`
// (editor-shell.js), então tudo que tem registro: 'pagina' também é arrastável DENTRO de
// um quiz; só o registro: 'quiz' é exclusivo. A prova abaixo confere essa afirmação no
// fonte, para a tabela não virar convenção esquecida.
const canvasesDoElemento = (elemento) => elemento.registro === 'quiz' ? [true] : [false, true];
const nomeDoCanvas = (quizCanvas) => quizCanvas ? 'quiz' : 'landing';

test('a paleta do quiz soma os blocos de página aos do quiz', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /blocks: \[\.\.\.blocks, \.\.\.quizBlocks\]/, 'se a paleta do quiz mudar, a tabela canvasesDoElemento precisa mudar junto');
});

test('nenhum elemento nasce sem regra que o alcance, em nenhum canvas onde é arrastável', () => {
  // Esta prova já foi `elementosCss + templateCss`, uma união que nenhum canvas recebe: a
  // landing veste elementosCss+templateCss, o quiz veste quizCanvasCss. Com a união, o
  // `button` passava verde porque .cta morava em templateCss — folha que o quiz não
  // recebe — enquanto no quiz ele nascia sem regra nenhuma. Perguntar por canvas, usando
  // o mesmo folhasDoCanvas que o editor usa, é o que fecha esse buraco.
  for (const elemento of catalogo) {
    for (const quizCanvas of canvasesDoElemento(elemento)) {
      const folha = folhasDoCanvas({ quizCanvas, cssExistente: '' }).folhas.join('');
      assert.ok(
        folha.includes(`${elemento.seletor}{`) || folha.includes(`${elemento.seletor},`) || folha.includes(`${elemento.seletor} `),
        `${elemento.id} declara o seletor ${elemento.seletor}, que não abre regra em nenhuma folha do canvas de ${nomeDoCanvas(quizCanvas)}`,
      );
    }
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

test('lista, escala e arquivo nascem com a classe do sistema', () => {
  assert.match(elementoPorId('quiz-select').render(), /class="answer"/);
  assert.match(elementoPorId('quiz-range').render(), /class="scale"/);
  assert.match(elementoPorId('quiz-file').render(), /class="upload"/);
});

test('a escala mostra o valor escolhido', () => {
  const html = elementoPorId('quiz-range').render();
  assert.match(html, /<output/, 'sem output a pessoa move o controle e não sabe onde parou');
});

test('o campo de texto solto encontra regra fora do formulário', () => {
  const html = elementoPorId('input').render();
  assert.match(html, /class="answer-wrap"/);
  assert.match(html, /class="answer"/);
});

test('o campo aninhado dentro do formulário devolve o foco ao tratamento do formulário', () => {
  // .answer:focus (0,2,0) sozinho vazava para dentro de .alva-form: formCss só cobre
  // :focus-visible (outline), não :focus puro, então um clique deixava o campo aninhado
  // com borda e brilho diferentes dos irmãos do mesmo formulário. A correção precisa
  // vencer por especificidade — .alva-form .answer:focus é (0,3,0) — e reusar os mesmos
  // valores que .alva-form input já tem em repouso (formCss), não inventar cor nova.
  assert.match(formCss, /var\(--field-border\)/, 'o token que a correção reusa precisa existir em formCss');
  assert.match(elementosCss, /\.alva-form \.answer:focus\{border-top-color:var\(--field-border\);border-right-color:var\(--field-border\);border-bottom-color:var\(--field-border\);border-left-color:var\(--field-border\);box-shadow:none\}/);
});

test('a área de envio diz o que aceita em português', () => {
  const html = elementoPorId('quiz-file').render();
  assert.doesNotMatch(html, /Choose File/i);
  assert.match(html, /Escolher arquivo|Envie/i);
});

test('nenhum atalho com var() na folha, porque o atalho não sobrevive ao GrapesJS', () => {
  // O GrapesJS reserializa a folha ao injetá-la no canvas (editor.addStyle). Um ATALHO
  // com var() vira pending-substitution no CSSOM do navegador: serializa vazio e some.
  // `border:1px solid var(--alva-el-line)` sumia inteiro de .answer, .choice e
  // .choice-key — no canvas e no rendered_html — enquanto .upload, com cor literal,
  // sobrevivia. Sem border-style o estado escolhido, que só troca border-color, não tinha
  // o que colorir: a moldura azul nunca aparecia. Achado D3 do gate de 2026-09-12.
  //
  // A prova é sobre a CLASSE do defeito, não sobre a borda: todo atalho com var() dentro
  // cai igual. Por isso a lista abaixo cobre também font, margin e padding — para o
  // próximo elemento nascer protegido em vez de redescobrir isto num gate visual.
  //
  // `background` fica de FORA, embora sofra do mesmo defeito: a folha já tem seis regras
  // que o usam com var() dentro — .custom-cta, .timer-toggle, .legend i, .bar-row b,
  // .statement-line e .donut. Nenhuma delas é elemento do catálogo (são peças do
  // formulário dinâmico e dos gráficos do quiz, que vão cruas para dentro de um <style>
  // e nunca passam pelo GrapesJS), e expandi-las não é o assunto desta onda. Registrado
  // no relatório da onda final para quem for migrar essas peças para o catálogo.
  //
  // A prova é sobre o TEXTO da folha, e não sobre um round-trip, de propósito: em jsdom o
  // atalho com var() sobrevive, então um round-trip aqui passaria verde com o defeito de
  // volta. Longhand com var() sobrevive nos dois.
  // border-color, border-width e border-style também são atalhos — das quatro faces — e
  // também somem com var() dentro: medido no Chrome, `border-color:var(--alva-el-line)`
  // não chegava ao canvas e a moldura caía em currentColor.
  const atalhos = new Set([
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-width', 'border-style', 'border-color',
    'font', 'margin', 'padding',
  ]);
  const culpados = [];
  postcss.parse(elementosCss).walkDecls((declaracao) => {
    if (atalhos.has(declaracao.prop) && declaracao.value.includes('var('))
      culpados.push(`${declaracao.parent.selector}{${declaracao.prop}:${declaracao.value}}`);
  });
  assert.deepEqual(culpados, [], 'expanda o atalho em longhand: com var() dentro, ele não chega ao canvas');
});

test('cartão de escolha, campo e crachá declaram border-style, que é o que o estado colore', () => {
  const regras = new Map();
  postcss.parse(elementosCss).walkRules((regra) => { if (!regras.has(regra.selector)) regras.set(regra.selector, regra); });
  for (const seletor of ['.answer', '.choice', '.choice-key']) {
    const declaracoes = new Map(regras.get(seletor).nodes.map((no) => [no.prop, no.value]));
    assert.equal(declaracoes.get('border-width'), '1px', `${seletor} sem border-width`);
    assert.equal(declaracoes.get('border-style'), 'solid', `${seletor} sem border-style: o estado escolhido não tem o que colorir`);
    for (const face of ['top', 'right', 'bottom', 'left'])
      assert.equal(declaracoes.get(`border-${face}-color`), 'var(--alva-el-line)', `${seletor} sem border-${face}-color`);
  }
});

test('a moldura sobrevive a uma ida e volta pelo GrapesJS de verdade', () => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents('<input class="answer"><label class="choice"><span class="choice-key">1</span></label>');
    editor.addStyle(elementosCss);
    const css = editor.getCss();
    for (const seletor of ['.answer', '.choice', '.choice-key']) {
      const regra = css.match(new RegExp(`[};]${seletor.slice(1)}\\{[^}]*\\}`))?.[0] || css.match(new RegExp(`\\${seletor}\\{[^}]*\\}`))[0];
      assert.match(regra, /border-style:\s*solid/, `${seletor} perdeu border-style na serialização`);
      assert.match(regra, /border-width:\s*1px/, `${seletor} perdeu border-width na serialização`);
      for (const face of ['top', 'right', 'bottom', 'left'])
        assert.match(regra, new RegExp(`border-${face}-color:\\s*var\\(--alva-el-line\\)`), `${seletor} perdeu border-${face}-color na serialização`);
    }
  } finally {
    editor.destroy();
    Object.assign(globalThis, anterior);
    dom.window.close();
  }
});
