import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormsUI } from '../public/forms.js';
import { canvasSnapshot } from '../public/quiz-canvas-seed.js';
import { normalizeFormInput } from '../server/form-store.mjs';

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => { await pause(); await pause(); };

const canvasHtml = '<div><label for="email-id">E-mail<input id="email-id" data-answer name="email" type="email"></label><div data-quiz-type="multiple_choice" data-quiz-question="Interesses"><label for="choice-a"><input id="choice-a" data-answer type="checkbox" name="interesses" value="A">A</label><label for="choice-b"><input id="choice-b" data-answer type="checkbox" name="interesses" value="B">B</label></div></div>';
const canvasState = {
  components: [{ tagName: 'div', components: [
    { tagName: 'label', attributes: { for: 'email-id' }, components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { id: 'email-id', name: 'email', type: 'email', 'data-answer': true } }] },
    { tagName: 'div', attributes: { 'data-quiz-type': 'multiple_choice', 'data-quiz-question': 'Interesses' }, components: [
      { tagName: 'label', attributes: { for: 'choice-a' }, components: [{ tagName: 'input', attributes: { id: 'choice-a', name: 'interesses', type: 'checkbox', value: 'A', 'data-answer': true } }, { type: 'textnode', content: 'A' }] },
      { tagName: 'label', attributes: { for: 'choice-b' }, components: [{ tagName: 'input', attributes: { id: 'choice-b', name: 'interesses', type: 'checkbox', value: 'B', 'data-answer': true } }, { type: 'textnode', content: 'B' }] },
    ] },
  ] }],
};

function record() {
  return {
    id: 'quiz-duplicate', projectId: 'project-duplicate', revision: 1, name: 'Duplicação', headerElements: [],
    steps: [{ id: 'step-a', title: 'Perguntas', elements: [], canvas: { version: 1, editorState: canvasState, html: canvasHtml, css: '' } }],
    completion: { title: 'Ok', message: 'Ok' }, webhook: '', publicPath: '',
  };
}

function descendants(component) {
  return (component?.components?.().models || []).flatMap((child) => [child, ...descendants(child)]);
}

async function withUi(run) {
  const { JSDOM } = await import(jsdomPath);
  const dom = new JSDOM(indexHtml, { url: 'https://studio.test/', pretendToBeVisual: true });
  const old = Object.fromEntries(['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'MutationObserver', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  let editor;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  const { default: grapesjs } = await import('grapesjs');
  dom.window.grapesjs = { ...grapesjs, init(options) { editor = grapesjs.init({ ...options, headless: true, styleManager: false }); return editor; } };
  try { return await run(dom.window.document, () => editor); }
  finally { editor?.destroy(); Object.assign(globalThis, old); dom.window.close(); }
}

function apiFor(source) {
  return async (path, method = 'GET', body) => {
    if (path === `/forms/${source.id}` && method === 'GET') return structuredClone(source);
    if (path === `/forms/${source.id}` && method === 'PUT') return { ...source, ...structuredClone(body), revision: source.revision + 1 };
    if (path === '/forms' || path === `/projects/${source.projectId}/videos`) return [];
    throw new Error(`unexpected API call: ${method} ${path}`);
  };
}

async function duplicateSelected(document, editor, model) {
  editor.select(model);
  assert.equal(editor.getSelected(), model);
  editor.trigger('component:selected', model);
  await settled();
  const button = [...document.querySelectorAll('.fe-element-actions button')].find((candidate) => candidate.getAttribute('aria-label') === 'Duplicar');
  assert.ok(button, 'inspector deve oferecer Duplicar');
  button.click();
}

function uniqueIdsAndLabelRefs(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs DOM devem ser únicos');
  for (const match of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) assert.ok(ids.includes(match[1]), `label-for ${match[1]} deve apontar para um ID existente`);
}

test('duplicar campo input pelo inspector regenera ID e preserva schema', async () => {
  await withUi(async (document, getEditor) => {
    const source = record();
    const ui = createFormsUI({ api: apiFor(source), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const input = descendants(editor.getWrapper()).find((model) => model.getAttributes?.().name === 'email');
    assert.ok(input);
    await duplicateSelected(document, editor, input);
    const snapshot = canvasSnapshot(editor);
    uniqueIdsAndLabelRefs(snapshot.html);
    const normalized = normalizeFormInput({ headerElements: [], steps: [{ id: 'step-a', title: 'Perguntas', elements: [], canvas: snapshot }], completion: source.completion, webhook: '' });
    const fields = normalized.steps[0].elements.filter((field) => field.id === 'email');
    assert.equal(fields.length, 1);
    assert.equal(new Set(normalized.steps[0].elements.map((field) => field.id)).size, normalized.steps[0].elements.length);
  });
});

test('duplicar grupo de escolhas preserva opções e separa nome do grupo', async () => {
  await withUi(async (document, getEditor) => {
    const source = record();
    const ui = createFormsUI({ api: apiFor(source), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const group = descendants(editor.getWrapper()).find((model) => model.getAttributes?.()['data-quiz-type'] === 'multiple_choice');
    assert.ok(group);
    await duplicateSelected(document, editor, group);
    const snapshot = canvasSnapshot(editor);
    uniqueIdsAndLabelRefs(snapshot.html);
    const normalized = normalizeFormInput({ headerElements: [], steps: [{ id: 'step-a', title: 'Perguntas', elements: [], canvas: snapshot }], completion: source.completion, webhook: '' });
    const choices = normalized.steps[0].elements.filter((field) => field.type === 'multiple_choice');
    assert.equal(choices.length, 2);
    assert.equal(new Set(choices.map((field) => field.id)).size, 2);
    assert.deepEqual(choices.map((field) => field.options), [['A', 'B'], ['A', 'B']]);
  });
});
