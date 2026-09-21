import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { garantirTituloDaEscolhaVisual, folhasDoCanvas } from '../public/editor-shell.js';
import { quizCanvasCss } from '../public/quiz-elements.js';

// Achado em 2026-09-21, reproduzido no Studio: toda reabertura de quiz apagava o estilo
// dos elementos que ainda não estavam na página e regravava o projeto assim. O Taian
// arrastava um botão ou uma escolha e eles entravam crus — link azul sublinhado, rádio
// nativo. Medido: 83 regras de classe viravam 1, e o servidor passava de 221 regras a 132.
//
// A causa: a checagem do título da escolha visual procurava o TEXTO grid-column:1/-1, e
// no navegador o GrapesJS o reescreve em grid-column-start/grid-column-end. A checagem
// nunca achava, e a correção fazia setStyle(regra + getCss()) — mas getCss() só devolve
// regras de classes em uso, e setStyle substitui o CSS inteiro.

function comEditor(fn) {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try { return fn(editor); } finally { editor.destroy(); Object.assign(globalThis, anterior); dom.window.close(); }
}
const seletores = (editor) => editor.Css.getAll().map((regra) => regra.selectorsToString());

test('reconhece o título da escolha visual na forma que o navegador grava', () => {
  comEditor((editor) => {
    editor.setComponents('<form data-alva-quiz-capture="true"><section><h2>Oi</h2></section></form>');
    editor.addStyle('.cta{color:blue}.choice{color:green}.image-choices>:is(h1,h2,h3,p){grid-column-start:1;grid-column-end:-1}');
    assert.equal(garantirTituloDaEscolhaVisual(editor), false, 'achou que faltava a regra que já está lá');
    assert.ok(seletores(editor).includes('.cta'), 'a regra do botão, sem botão na página, sumiu');
    assert.ok(seletores(editor).includes('.choice'), 'a regra da escolha, sem escolha na página, sumiu');
  });
});

test('quando o título falta, entra sem apagar a regra de nenhum elemento', () => {
  comEditor((editor) => {
    editor.setComponents('<form data-alva-quiz-capture="true"><section><h2>Oi</h2></section></form>');
    editor.addStyle('.cta{color:blue}.choice{color:green}');
    assert.equal(garantirTituloDaEscolhaVisual(editor), true);
    const lista = seletores(editor);
    assert.ok(lista.includes('.cta') && lista.includes('.choice'), 'a correção apagou regras sem uso na página');
    assert.equal(lista.filter((s) => s.replace(/\s+/g, '') === '.image-choices>:is(h1,h2,h3,p)').length, 1);
    assert.equal(garantirTituloDaEscolhaVisual(editor), false, 'a segunda abertura duplicou a regra');
  });
});

test('quiz que já perdeu o estilo dos elementos recebe a pele de volta', () => {
  // O "lp" do Taian e todo quiz reaberto antes desta correção: têm --cloud (a marca de que
  // a pele foi aplicada), mas as regras dos elementos foram apagadas. Pela marca sozinha,
  // folhasDoCanvas nunca mais reaplicaria.
  comEditor((editor) => {
    editor.setComponents('<form data-alva-quiz-capture="true"><section><a class="cta">Ir</a></section></form>');
    editor.addStyle(':root{--cloud:#f7f9fd;--alva-quiz-corpo:1}[data-alva-quiz-capture]>section{max-width:440px}');
    const cssExistente = editor.getCss();
    assert.deepEqual(folhasDoCanvas({ quizCanvas: true, cssExistente }).folhas, [], 'premissa: pela marca, nada seria reaplicado');
    const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente, seletoresExistentes: new Set(seletores(editor)) });
    assert.deepEqual(folhas, [quizCanvasCss], 'o quiz danificado não recebe a pele de volta');
  });
});

test('quiz íntegro não recebe a pele de novo', () => {
  comEditor((editor) => {
    editor.setComponents('<form data-alva-quiz-capture="true"><section><h2>Oi</h2></section></form>');
    editor.addStyle(quizCanvasCss);
    const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: editor.getCss(), seletoresExistentes: new Set(seletores(editor)) });
    assert.deepEqual(folhas, []);
  });
});

// O bloco inserido sem nada selecionado ia para a raiz da página — FORA do <form> do quiz.
// Lá a pele do quiz não alcança (rádio nativo à mostra), a coluna não existe (o elemento
// ocupa a largura toda) e o runtime não o trata como etapa. Visto ao repetir o caminho do
// Taian em 2026-09-21.
test('bloco novo no quiz vai para a última etapa, não para fora do quiz', async () => {
  const { destinoPadraoNoQuiz } = await import('../public/editor-shell.js');
  comEditor((editor) => {
    editor.setComponents('<form data-alva-quiz-capture="true"><section id="um"></section><section id="dois"></section></form>');
    assert.equal(destinoPadraoNoQuiz(editor.getWrapper())?.getId(), 'dois');
  });
  comEditor((editor) => {
    editor.setComponents('<form id="raiz" data-alva-quiz-capture="true"></form>');
    assert.equal(destinoPadraoNoQuiz(editor.getWrapper())?.getId(), 'raiz', 'sem etapa, o destino é a raiz do quiz');
  });
});

test('o quiz novo nasce como quiz: uma etapa, na pele do quiz, sem modelo de landing', async () => {
  const { inicioDoQuiz } = await import('../public/quiz-elements.js');
  assert.equal(inicioDoQuiz.css, '', 'o quiz novo não pode trazer folha de landing');
  assert.equal((inicioDoQuiz.html.match(/<section/g) || []).length, 1);
  assert.match(inicioDoQuiz.html, /class="cta"/, 'a etapa precisa de um botão para avançar');
  assert.doesNotMatch(inicioDoQuiz.html, /hero|nav|lp-footer/, 'trouxe estrutura de landing');
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /page\.kind === 'quiz' \? inicioDoQuiz/, 'o quiz novo ainda cai no modelo de landing');
});

test('tudo o que fica direto na raiz do quiz entra na coluna', () => {
  const folha = folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).folhas.join('');
  assert.match(folha, /\[data-alva-quiz-capture\]>\*\{[^}]*max-width:440px/, 'elemento fora de etapa ocupa a largura toda');
  // O botão é inline-flex: margin:auto não centraliza elemento em linha, e ele ficava colado à esquerda.
  assert.match(folha, /\[data-alva-quiz-capture\]>\.cta\{[^}]*display:flex/, 'botão solto na raiz não centraliza');
});
