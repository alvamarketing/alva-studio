import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { etapaAtivaDoQuiz, etapasNoCanvasCss } from '../public/editor-shell.js';

// Pedido do Taian em 2026-09-21: cada seção do quiz aparecer no canvas "como mini
// páginas, para a pessoa ter certeza que está colocando no lugar certo". Ele criou uma
// seção nova, foi adicionar um elemento e ele caiu na seção do plano.

function comQuiz(fn) {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents('<form data-alva-quiz-capture="true"><section id="um"><h2 id="titulo">Oi</h2></section><section id="dois"><p id="texto">Tchau</p></section></form>');
    const busca = (id) => { let achado; const visitar = (c) => { if (c.getId?.() === id) achado = c; c.components().forEach(visitar); }; visitar(editor.getWrapper()); return achado; };
    return fn({ editor, busca });
  } finally { editor.destroy(); Object.assign(globalThis, anterior); dom.window.close(); }
}

test('a etapa destacada é a que contém o que está selecionado', () => comQuiz(({ editor, busca }) => {
  assert.equal(etapaAtivaDoQuiz(busca('titulo'), editor.getWrapper())?.getId(), 'um');
  assert.equal(etapaAtivaDoQuiz(busca('dois'), editor.getWrapper())?.getId(), 'dois');
}));

test('sem seleção, a destacada é a última — a mesma que recebe o próximo bloco', () => comQuiz(({ editor }) => {
  assert.equal(etapaAtivaDoQuiz(null, editor.getWrapper())?.getId(), 'dois');
  assert.equal(etapaAtivaDoQuiz(editor.getWrapper(), editor.getWrapper())?.getId(), 'dois');
}));

test('cada etapa aparece como página própria, com nome, só no editor', () => {
  assert.match(etapasNoCanvasCss, /counter-increment:\s*alva-etapa/);
  assert.match(etapasNoCanvasCss, /'Etapa ' counter\(alva-etapa\)/);
  assert.match(etapasNoCanvasCss, /\.alva-etapa-ativa/);
  assert.match(etapasNoCanvasCss, /os elementos entram aqui/i);
  // O rótulo mora no ::after: o ::before já é o nome do elemento selecionado.
  assert.doesNotMatch(etapasNoCanvasCss, /::before/);
  // O painel lê o estilo calculado: fundo ou margem do destaque apareciam como se fossem da
  // seção ("Cor de fundo #f7faff", "Distância abaixo 24") e seriam gravados ao editar.
  const regrasDaEtapa = [...etapasNoCanvasCss.matchAll(/section(?:\.alva-etapa-ativa)?\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
  assert.doesNotMatch(regrasDaEtapa, /background|margin|padding/, 'o destaque do editor vaza para o painel da seção');
});
