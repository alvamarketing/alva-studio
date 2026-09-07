import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedQuizCanvas } from '../public/quiz-canvas-seed.js';
import { quizElementCss, renderQuizElement } from '../public/quiz-elements.js';
import { canvasSnapshot } from '../public/quiz-canvas-seed.js';
import { normalizeQuizCanvas } from '../server/quiz-canvas.mjs';
import { allocateQuizFieldNames } from '../public/editor-shell.js';

test('seed do canvas preserva campos legados e não cria form aninhado', () => {
  const seeded = seedQuizCanvas([
    { id: 'nome', type: 'short_text', title: 'Seu nome', placeholder: 'Nome', required: true, icon: 'person' },
    { id: 'perfil', type: 'single_choice', title: 'Perfil', options: ['Agência', 'Consultoria'], required: true, icon: 'radio_button_checked' },
    { id: 'grafico', type: 'chart', title: 'Resultados', chart: { type: 'bar', labels: ['A'], values: [90] }, icon: 'analytics' },
  ]);
  assert.match(seeded.html, /name="nome"/);
  assert.match(seeded.html, /name="perfil"/);
  assert.match(seeded.html, /data-element-id="grafico"/);
  assert.doesNotMatch(seeded.html, /<form\b/i);
  assert.match(seeded.css, /\.screen-elements/);
});

test('seed do topo nunca contém campos de resposta', () => {
  const seeded = seedQuizCanvas([{ id: 'marca', type: 'logo', title: 'Alva', required: false, icon: 'gesture' }], { header: true });
  assert.match(seeded.html, /funnel-header/);
  assert.doesNotMatch(seeded.html, /data-answer/);
});

test('nomes de grupos inseridos preservam radio e checkbox no mesmo grupo em click e drag', () => {
  const fixed = () => 'campo_novo';
  for (const inserted of [['campo_escolha', 'campo_escolha'], ['campo_multiplas', 'campo_multiplas']]) {
    const click = allocateQuizFieldNames(inserted, new Set(['campo_escolha', 'campo_multiplas']), fixed);
    const drag = allocateQuizFieldNames(inserted, new Set(['campo_escolha', 'campo_multiplas']), fixed);
    assert.equal(click[0], click[1]);
    assert.equal(drag[0], drag[1]);
    assert.notEqual(click[0], inserted[0]);
  }
});

test('seed vira snapshot GrapesJS válido sem perder ids, campos ou gráfico', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const { default: grapesjs } = await import('grapesjs');
  const seeded = seedQuizCanvas([
    { id: 'nome', type: 'short_text', title: 'Nome', placeholder: 'Nome', required: true, icon: 'person' },
    { id: 'perfil', type: 'single_choice', title: 'Perfil', options: ['Agência', 'Consultoria'], required: true, icon: 'radio_button_checked' },
    { id: 'grafico', type: 'chart', title: 'Resultados', chart: { type: 'bar', labels: ['A'], values: [90] }, icon: 'analytics' },
  ]);
  const editor = grapesjs.init({ headless: true, storageManager: false, components: seeded.html, style: seeded.css });
  try {
    const snapshot = canvasSnapshot(editor);
    const normalized = normalizeQuizCanvas(snapshot);
    assert.deepEqual(normalized.fields.map((field) => field.id), ['nome', 'perfil']);
    assert.ok(normalized.elementIds.has('grafico'));
  } finally {
    editor.destroy();
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('GrapesJS configura três opções, remove uma e reabre com marcadores de grupo', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const { default: grapesjs } = await import('grapesjs');
  const html = '<div data-quiz-type="multiple_choice" data-quiz-question="Perfis" data-quiz-required="true"><label><input type="checkbox" name="perfil" value="A"> A</label><label><input type="checkbox" name="perfil" value="B"> B</label><label><input type="checkbox" name="perfil" value="C"> C</label></div>';
  const editor = grapesjs.init({ headless: true, storageManager: false, components: html });
  try {
    const group = editor.getWrapper().components().at(0);
    group.addAttributes({ 'data-quiz-question': 'Perfis atualizados', 'data-quiz-required': 'true' });
    group.components().at(2).remove();
    const snapshot = canvasSnapshot(editor);
    const normalized = normalizeQuizCanvas(snapshot);
    assert.deepEqual(normalized.fields, [{ id: 'perfil', type: 'multiple_choice', title: 'Perfis atualizados', required: true, options: ['A', 'B'], range: undefined }]);
    const reopened = grapesjs.init({ headless: true, storageManager: false });
    try {
      reopened.loadProjectData(snapshot.editorState);
      assert.match(reopened.getHtml(), /data-quiz-required="true"/);
      assert.match(reopened.getHtml(), /name="perfil"/);
    } finally { reopened.destroy(); }
  } finally { editor.destroy(); Object.assign(globalThis, previous); dom.window.close(); }
});


test('título direto de escolha visual ocupa toda a linha do grupo', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const choice = renderQuizElement({
    id: 'canal', type: 'image_choice', title: 'Como prefere conversar?', required: true,
    options: [{ label: 'WhatsApp', imageUrl: '', icon: 'chat' }, { label: 'Ligação', imageUrl: '', icon: 'phone' }],
  });
  assert.match(choice, /<h3>Como prefere conversar\?<\/h3>/);
  const dom = new JSDOM(`<!doctype html><style>${quizElementCss}</style><div class="choices image-choices"><p>Como prefere conversar?</p><label class="choice choice-image">WhatsApp</label><label class="choice choice-image">Ligação</label></div>`);
  const question = dom.window.document.querySelector('.image-choices > p');
  assert.equal(dom.window.getComputedStyle(question).gridColumn, '1/-1');
  dom.window.close();
});
