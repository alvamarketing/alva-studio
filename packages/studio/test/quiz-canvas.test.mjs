import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuizCanvas, renderQuizCanvas, scopeCanvasCss } from '../server/quiz-canvas.mjs';
import { normalizeFormInput } from '../server/form-store.mjs';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';
import { parseFragment } from 'parse5';
import { canvasSnapshot, seedQuizCanvas } from '../public/quiz-canvas-seed.js';

const model = {
  pages: [{ frames: [{ component: { tagName: 'section', components: [
    { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: true } }] },
    { tagName: 'label', components: [{ type: 'textnode', content: 'Perfil' }, { tagName: 'input', attributes: { name: 'perfil', type: 'radio', value: 'Agência', required: true } }] },
    { tagName: 'label', components: [{ type: 'textnode', content: 'Perfil' }, { tagName: 'input', attributes: { name: 'perfil', type: 'radio', value: 'Consultoria', required: true } }] },
    { tagName: 'input', attributes: { name: 'nota', type: 'range', min: '2', max: '8' } },
    { tagName: 'input', attributes: { name: 'arquivo', type: 'file' } },
  ] } }] }],
};
const html = '<section><label>E-mail<input name="email" type="email" required></label><label>Perfil<input name="perfil" type="radio" value="Agência" required></label><label>Perfil<input name="perfil" type="radio" value="Consultoria" required></label><input name="nota" type="range" min="2" max="8"><input name="arquivo" type="file"></section>';

test('deriva respostas do canvas GrapesJS e torna somente esses inputs submetíveis', () => {
  const { canvas, fields } = normalizeQuizCanvas({ version: 1, editorState: model, html, css: '.campo{color:#123}' });
  assert.deepEqual(fields.map(({ id, type, required, options, range }) => ({ id, type, required, options, range })), [
    { id: 'email', type: 'email', required: true, options: undefined, range: undefined },
    { id: 'perfil', type: 'single_choice', required: true, options: ['Agência', 'Consultoria'], range: undefined },
    { id: 'nota', type: 'scale', required: false, options: undefined, range: { min: 2, max: 8 } },
    { id: 'arquivo', type: 'file', required: false, options: undefined, range: undefined },
  ]);
  assert.match(canvas.html, /data-answer=""/);
  assert.match(renderQuizCanvas(canvas, 'tela-a'), /\[data-quiz-canvas="tela-a"\] \.campo/);
});

test('recusa divergência entre HTML e modelo, atributos perigosos e respostas no topo', () => {
  assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: model, html: html.replace('name="email"', 'name="outro"'), css: '' }), /divergentes/);
  assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: model, html: html.replace('<section>', '<section srcdoc="<script>x</script>">'), css: '' }), /não permitido/);
  assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: model, html, css: '' }, { header: true }), /topo compartilhado/);
  for (const unsafe of ['java\nscript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
    assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: model, html: html.replace('<section>', `<section><iframe src="${unsafe}"></iframe>`), css: '' }), /não permitido/);
  }
  const executableModel = structuredClone(model);
  executableModel.pages[0].frames[0].component.components.push({ tagName: 'script', content: 'alert(1)' });
  assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: executableModel, html, css: '' }), /não permitido/);
  const srcdocModel = structuredClone(model);
  srcdocModel.pages[0].frames[0].component.attributes = { srcdoc: '<script>alert(1)</script>' };
  assert.throws(() => normalizeQuizCanvas({ version: 1, editorState: srcdocModel, html, css: '' }), /não permitido/);
});

test('mapeia textarea, data, select múltiplo e remoção de campo a partir do canvas', () => {
  const fields = [
    ['textarea', { name: 'relato' }, 'long_text'], ['input', { name: 'nascimento', type: 'date' }, 'date'],
    ['select', { name: 'interesses', multiple: true }, 'multiple_choice'],
  ];
  const component = { tagName: 'section', components: fields.map(([tagName, attributes]) => ({ tagName, attributes, components: tagName === 'select' ? [{ tagName: 'option', attributes: { value: 'A' } }, { tagName: 'option', attributes: { value: 'B' } }] : [] })) };
  const state = { pages: [{ frames: [{ component }] }] };
  const document = '<section><textarea name="relato"></textarea><input name="nascimento" type="date"><select name="interesses" multiple><option value="A">A</option><option value="B">B</option></select></section>';
  const normalized = normalizeQuizCanvas({ version: 1, editorState: state, html: document, css: '' });
  assert.deepEqual(normalized.fields.map((field) => field.id), ['relato', 'nascimento', 'interesses']);
  assert.deepEqual(normalized.fields.map((field) => field.type), ['long_text', 'date', 'multiple_choice']);
  assert.deepEqual(normalized.fields[2].options, ['A', 'B']);
});

test('escopa CSS de telas sem quebrar media, :is ou keyframes', () => {
  const css = ':root{--cor:red} body .card,:is(.a,.b){color:var(--cor)} @media (max-width:600px){.card{color:blue}} @keyframes entrar{from{opacity:0}to{opacity:1}}';
  const scoped = scopeCanvasCss(css, 'a');
  assert.match(scoped, /\[data-quiz-canvas="a"\]\{--cor:red/);
  assert.match(scoped, /\[data-quiz-canvas="a"\] \.card,\[data-quiz-canvas="a"\] :is\(\.a,\.b\)/);
  assert.match(scoped, /@media \(max-width:600px\)\{\[data-quiz-canvas="a"\] \.card/);
  assert.match(scoped, /@keyframes entrar\{from\{opacity:0\}to\{opacity:1\}\}/);
  assert.match(scopeCanvasCss('.card{color:blue}', 'b'), /\[data-quiz-canvas="b"\] \.card/);
  assert.match(scopeCanvasCss('html body .card{color:red}', 'a'), /\[data-quiz-canvas="a"\] \.card/);
  const rendered = renderQuizCanvas({ version: 1, editorState: { pages: [{ frames: [{ component: { tagName: 'div' } }] }] }, html: '<div>Seguro</div>', css: '/* </style><script>alert(1)</script> */.card{color:red}' }, 'a');
  const scripts = [];
  const collect = (node) => { if (node.tagName === 'script') scripts.push(node); (node.childNodes || []).forEach(collect); };
  parseFragment(rendered).childNodes.forEach(collect);
  assert.equal(scripts.length, 0, 'CSS não fecha a tag style no HTML publicado');
});

test('aceita getProjectData e getHtml reais do GrapesJS', async () => {
  const { default: grapesjs } = await import('grapesjs');
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.DomComponents.addType('alva-field', { model: { defaults: { tagName: 'input', void: true } } });
    editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'label', components: [{ type: 'textnode', content: 'Data' }, { type: 'alva-field', tagName: 'input', attributes: { name: 'data', type: 'date', required: true } }] }] });
    const result = normalizeQuizCanvas({ version: 1, editorState: editor.getProjectData(), html: editor.getHtml(), css: editor.getCss() });
    assert.deepEqual(result.fields.map(({ id, type, required }) => ({ id, type, required })), [{ id: 'data', type: 'date', required: true }]);
  } finally { editor.destroy(); }
});

test('schema publicado usa campos derivados, inclusive remoção de campo do canvas', () => {
  const canvas = normalizeQuizCanvas({ version: 1, editorState: model, html, css: '' }).canvas;
  const form = normalizeFormInput({
    headerElements: [],
    steps: [{ id: 'tela', title: 'Diagnóstico', elements: [{ id: 'forjado', type: 'short_text', title: 'Não publicar' }], canvas }],
    completion: { title: 'Obrigado', message: 'Recebido' }, webhook: '',
  });
  assert.deepEqual(form.steps[0].elements.map((field) => field.id), ['email', 'perfil', 'nota', 'arquivo']);
  assert.deepEqual(validateFormAnswers(form, { answers: { email: 'lead@example.test', perfil: 'Agência', nota: '4' } }), {
    email: 'lead@example.test', perfil: 'Agência', nota: '4', arquivo: '',
  });
  assert.throws(() => validateFormAnswers(form, { answers: { forjado: 'x' } }), /Responda “E-mail”/);
});

test('campo apagado não revive e canvas só de conteúdo aceita submissão vazia', () => {
  const empty = { version: 1, editorState: { pages: [{ frames: [{ component: { tagName: 'section', components: [{ tagName: 'h3', components: [{ type: 'textnode', content: 'Diagnóstico pronto' }] }] } }] }] }, html: '<section><h3>Diagnóstico pronto</h3></section>', css: '' };
  const form = normalizeFormInput({ headerElements: [], steps: [{ id: 'fim', title: 'Fim', elements: [{ id: 'forjado', type: 'email', title: 'Não reviver', required: true }], canvas: empty }], completion: { title: 'Ok', message: 'Ok' }, webhook: '' });
  assert.deepEqual(form.steps[0].elements, []);
  assert.deepEqual(validateFormAnswers(form, { answers: {} }), {});
});

test('usa títulos de heading irmão e semântica booleana do HTML', () => {
  const state = { pages: [{ frames: [{ component: { tagName: 'section', components: [{ tagName: 'div', attributes: { 'data-element-id': 'whats' }, components: [{ tagName: 'h3', components: [{ type: 'textnode', content: 'Seu WhatsApp' }] }, { tagName: 'input', attributes: { name: 'whatsapp', type: 'tel', required: 'false' } }] }] } }] }] };
  const result = normalizeQuizCanvas({ version: 1, editorState: state, html: '<section><div data-element-id="whats"><h3>Seu WhatsApp</h3><input name="whatsapp" type="tel" required="false"></div></section>', css: '' });
  assert.deepEqual(result.fields.map(({ id, type, title, required }) => ({ id, type, title, required })), [{ id: 'whatsapp', type: 'phone', title: 'Seu WhatsApp', required: true }]);
});

test('seed real preserva required de múltipla escolha e pergunta visual no schema derivado', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const { default: grapesjs } = await import('grapesjs');
  const seeded = seedQuizCanvas([
    { id: 'servicos', type: 'multiple_choice', title: 'Quais serviços você procura?', options: ['Tráfego', 'Landing'], required: true, icon: 'checklist' },
    { id: 'canal', type: 'image_choice', title: 'Como prefere conversar?', options: [{ label: 'WhatsApp', imageUrl: '', icon: 'chat' }, { label: 'Ligação', imageUrl: '', icon: 'call' }], required: true, icon: 'gallery_thumbnail' },
  ]);
  const editor = grapesjs.init({ headless: true, storageManager: false, components: seeded.html, style: seeded.css });
  try {
    const canvas = canvasSnapshot(editor);
    const normalized = normalizeQuizCanvas(canvas);
    assert.deepEqual(normalized.fields.map(({ id, type, title, required }) => ({ id, type, title, required })), [
      { id: 'servicos', type: 'multiple_choice', title: 'Quais serviços você procura?', required: true },
      { id: 'canal', type: 'image_choice', title: 'Como prefere conversar?', required: true },
    ]);
    const form = normalizeFormInput({ headerElements: [], steps: [{ id: 'tela', title: 'Tela', elements: [], canvas }], completion: { title: 'Ok', message: 'Ok' }, webhook: '' });
    assert.throws(() => validateFormAnswers(form, { answers: { canal: 'WhatsApp' } }), /Quais serviços você procura/);
    assert.deepEqual(validateFormAnswers(form, { answers: { servicos: ['Tráfego'], canal: 'WhatsApp' } }).servicos, ['Tráfego']);
    const changedHtml = canvas.html.replace('data-quiz-required="true"', 'data-quiz-required="false"');
    assert.throws(() => normalizeQuizCanvas({ ...canvas, html: changedHtml }), /divergentes/);
  } finally {
    editor.destroy();
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
