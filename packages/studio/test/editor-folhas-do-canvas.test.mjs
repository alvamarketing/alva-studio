import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { folhasDoCanvas } from '../public/editor-shell.js';
import { formCss, getTemplate, normalizeForms, templateCss } from '../public/templates.js';
import { elementosCss } from '../public/catalogo-elementos.js';
import { quizCanvasCss } from '../public/quiz-elements.js';

test('o canvas do quiz veste a pele do quiz publicado, não a da landing', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: '' });
  assert.deepEqual(folhas, [quizCanvasCss]);
  // quizCanvasCss já traz a folha dos elementos dentro: o cartão de escolha continua
  // desenhado sem precisar de uma segunda folha.
  assert.ok(folhas.join('').includes('.choice{'), 'a folha dos elementos viaja dentro da pele do quiz');
});

test('a folha da landing não entra no quiz, porque a raiz do quiz é um .alva-form', () => {
  // templateCss termina em ${formCss}. Com ele dentro, `.alva-form label{display:block}`
  // (0,1,1) vence `.choice{display:flex}` (0,1,0) e o cartão vira rádio empilhado; e
  // `.alva-form input{display:block}` vence o [hidden] do navegador, devolvendo o
  // "Choose File" nativo. Achados D1 e D2 do gate visual de 2026-09-12.
  const folha = folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).folhas.join('');
  assert.ok(!folha.includes(templateCss), 'a folha do modelo da landing não entra no quiz');
  assert.ok(!folha.includes(formCss), 'formCss não entra no quiz por nenhum caminho');
  assert.ok(!folha.includes('.alva-form label'), 'nada no quiz achata o rótulo do cartão');
  assert.ok(!folha.includes('.alva-form input'), 'nada no quiz redesenha o input escondido');
});

test('o canvas do quiz declara a tipografia e o fundo do quiz publicado', () => {
  const folha = folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).folhas.join('');
  // Em longhand de propósito: o GrapesJS descarta atalho com var(), e era por isso que
  // `:root{background:var(--cloud)}` sozinho não pintava o canvas. Achado D4.
  assert.match(folha, /background-color:var\(--cloud\)/);
  assert.match(folha, /color:var\(--ink\)/);
  assert.match(folha, /font-family:Inter,system-ui,sans-serif/);
  assert.match(folha, /--cloud:#f7f9fd/);
  assert.match(folha, /--ink:#111827/);
});

test('a landing continua exatamente como estava', () => {
  const { folhas, normalizarFormularios } = folhasDoCanvas({ quizCanvas: false, cssExistente: '' });
  assert.deepEqual(folhas, [elementosCss, templateCss]);
  assert.equal(normalizarFormularios, true);
});

test('uma página que já tem o modelo não recebe o modelo de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '.hero-grid{display:grid}' });
  assert.ok(!folhas.includes(templateCss), 'não reaplica o modelo por cima do trabalho salvo');
});

test('só a landing normaliza formulários', () => {
  // normalizeForms injeta formCss por conta própria assim que acha um <form>, e a raiz do
  // quiz é um <form>. No quiz quem cuida do formulário é ensureQuizCapture.
  assert.equal(folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).normalizarFormularios, false);
  assert.equal(folhasDoCanvas({ quizCanvas: false, cssExistente: '' }).normalizarFormularios, true);
});

test('uma página que já tem a folha dos elementos não a recebe de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: ':root{--alva-el-accent:#286eea}' });
  assert.ok(!folhas.includes(elementosCss));
});

test('um quiz já vestido não recebe a pele de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: ':root{--cloud:#f7f9fd}' });
  assert.deepEqual(folhas, []);
});

test('ninguém chama normalizeForms no quiz por fora de folhasDoCanvas', async () => {
  const { readFile } = await import('node:fs/promises');
  // A decisão precisa morar num lugar só. Uma chamada solta de normalizeForms no caminho
  // do quiz reintroduz formCss mesmo com folhasDoCanvas correto — e havia três: abrir o
  // editor, inserir um bloco e SALVAR. A do salvamento era a pior: gravava a folha dentro
  // do projeto, e o cartão de escolha voltava achatado na reabertura.
  for (const arquivo of ['../public/editor-shell.js', '../public/app.js']) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    for (const chamada of fonte.matchAll(/normalizeForms\(editor\)/g)) {
      const contexto = fonte.slice(Math.max(0, chamada.index - 320), chamada.index);
      assert.match(contexto, /normalizarFormularios/, `${arquivo}: toda chamada de normalizeForms passa por folhasDoCanvas`);
    }
  }
});

test('a pele do quiz sobrevive ao GrapesJS sem trazer a folha do formulário', () => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents('<form class="alva-form" data-alva-quiz-capture="true"><div class="choices"><label class="choice"><input type="radio" name="q"><span class="choice-key">1</span><span>Opção 1</span></label></div><label class="upload"><span>Escolher arquivo</span><input type="file" name="arq" hidden></label></form>');
    const { folhas, normalizarFormularios } = folhasDoCanvas({ quizCanvas: true, cssExistente: editor.getCss() });
    folhas.forEach((folha) => editor.addStyle(folha));
    if (normalizarFormularios) normalizeForms(editor);
    const css = editor.getCss();
    assert.ok(!css.includes('.alva-form label'), 'formCss entrou no quiz e achataria o cartão');
    assert.ok(!/\.alva-form input/.test(css), 'formCss entrou e o "Choose File" voltaria');
    assert.match(css, /\.choice\{[^}]*display:flex/, 'o cartão de escolha continua sendo cartão');
    assert.ok(css.includes('--cloud:#f7f9fd'), 'a paleta do quiz publicado chega ao canvas');
    assert.match(css, /background-color:var\(--cloud\)/, 'o fundo do quiz publicado sobrevive à serialização');
    // A segunda passada é o que acontece a cada bloco inserido: não pode reaplicar nada.
    assert.deepEqual(folhasDoCanvas({ quizCanvas: true, cssExistente: css }).folhas, []);
  } finally {
    editor.destroy();
    Object.assign(globalThis, anterior);
    dom.window.close();
  }
});

test('o modelo semeia o quiz sem a folha do formulário', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const inicio = fonte.indexOf('editor.setComponents(html)');
  assert.match(fonte.slice(inicio, inicio + 900), /editor\.setStyle\(quizCanvas \? css\.split\(formCss\)\.join\(''\) : css\)/);
  // folhasDoCanvas decide o que o editor ACRESCENTA; o modelo decide com o que a página
  // nova NASCE, e é outro caminho para a mesma folha. O modelo "Página em branco" é
  // formCss puro: sem esta poda o quiz em branco já abre com `.alva-form label` dentro e
  // o cartão de escolha nasce achatado, com blockStyles correto e tudo.
  assert.equal(getTemplate('blank').css, formCss);
  assert.equal(getTemplate('blank').css.split(formCss).join(''), '');
  assert.ok(getTemplate('services').css.includes(formCss), 'os modelos de página terminam em formCss');
  const semFormulario = getTemplate('services').css.split(formCss).join('');
  assert.ok(!semFormulario.includes('.alva-form label'), 'a poda tira o que achata o cartão');
  assert.ok(semFormulario.includes('.hero-grid'), 'e deixa o resto do modelo de pé');
});
