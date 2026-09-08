import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFormsUI } from '../public/forms.js';
import { normalizeFormInput } from '../server/form-store.mjs';

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settled() {
  await pause();
  await pause();
}

const imageChoiceHeadingRule = '.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}';
function oldVisualCanvas() {
  return {
    version: 1,
    html: '<div class="choices image-choices" data-quiz-type="image_choice" data-quiz-question="Canal"><p>Canal</p><label class="choice choice-image"><input type="radio" name="canal" value="WhatsApp"><span>WhatsApp</span></label><label class="choice choice-image"><input type="radio" name="canal" value="E-mail"><span>E-mail</span></label></div>',
    css: '.image-choices p{color:rebeccapurple}',
  };
}

function legacyForm() {
  return {
    id: 'quiz-lifecycle', projectId: 'project-lifecycle', revision: 3, name: 'Diagnóstico',
    headerElements: [{ id: 'marca', type: 'logo', title: 'Alva', altText: 'Alva', mediaUrl: '' }],
    steps: [
      { id: 'screen-a', title: 'Contexto', elements: [{ id: 'nome', type: 'short_text', title: 'Nome', required: true, placeholder: '' }] },
      { id: 'screen-b', title: 'Perfil', elements: [{ id: 'perfil', type: 'single_choice', title: 'Perfil', required: false, options: ['Agência', 'Consultoria'] }] },
    ],
    completion: { title: 'Obrigado', message: 'Recebemos suas respostas.' }, webhook: '', publicPath: '',
  };
}

async function withCanvasDom(run) {
  const { JSDOM } = await import(jsdomPath);
  const dom = new JSDOM(indexHtml, { url: 'https://studio.test/', pretendToBeVisual: true });
  const previous = Object.fromEntries(['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'MutationObserver', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  let activeEditor = null;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
    Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  // GrapesJS captures document at import time; load it only after JSDOM.
  const { default: grapesjs } = await import('grapesjs');
  // GrapesJS stays real, but uses its documented headless mode because JSDOM
  // cannot complete the iframe canvas boot performed by the visual runtime.
  dom.window.grapesjs = { ...grapesjs, init: (options) => {
    activeEditor = grapesjs.init({ ...options, headless: true, styleManager: false });
    return activeEditor;
  } };
  dom.window.confirm = () => true;
  dom.window.open = () => null;
  try {
    return await run(dom.window.document, () => activeEditor);
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
}

function apiFor(record, puts, { previewHtml = '<!doctype html><html><body>Prévia</body></html>', previewError = null, saveError = null, events = [] } = {}) {
  let current = structuredClone(record);
  return async (path, method = 'GET', body) => {
    if (path === `/forms/${record.id}` && method === 'GET') return structuredClone(current);
    if (path === `/forms/${record.id}` && method === 'PUT') {
      events.push('save');
      if (saveError) throw saveError;
      puts.push(structuredClone(body));
      current = { ...current, ...structuredClone(body), revision: current.revision + 1 };
      return structuredClone(current);
    }
    if (path === `/forms/${record.id}/preview` && method === 'GET') {
      events.push('preview');
      if (previewError) throw previewError;
      return { html: previewHtml };
    }
    if (path === '/forms') return [];
    if (path === `/projects/${record.projectId}/videos`) return [];
    throw new Error(`unexpected API call: ${method} ${path}`);
  };
}

function formsUi(record, puts, { can = () => true, previewHtml, previewError, saveError, events, toast = () => {} } = {}) {
  return createFormsUI({ api: apiFor(record, puts, { previewHtml, previewError, saveError, events }), toast, can, getProjectId: () => record.projectId, mediaEnabled: () => false });
}

function addHeading(editor) {
  editor.getWrapper().append(editor.BlockManager.get('heading').get('content'));
  // GrapesJS normally emits this while its iframe view applies the mutation.
  // Its headless renderer has no iframe view, so dispatch the native editor
  // update event after mutating the real component tree.
  editor.trigger('update');
}

test('abrir quiz legado e voltar não converte nem envia PUT sem edição', async () => {
  await withCanvasDom(async (document) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts);
    await ui.openForm('quiz-lifecycle');
    document.querySelector('#form-back').click();
    await settled();
    assert.equal(puts.length, 0);
  });
});

test('editar o topo persiste headerCanvas no PUT', async () => {
  await withCanvasDom(async (document, getEditor) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts);
    await ui.openForm('quiz-lifecycle');
    document.querySelector('[data-quiz-canvas-target="header"]').click();
    await settled();
    // O canvas visual é um iframe que o JSDOM não implementa; exercitamos a
    // mesma operação de inserção no GrapesJS real, em modo headless.
    addHeading(getEditor());
    await settled();
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].headerCanvas?.version, 1);
    assert.match(puts[0].headerCanvas.html, /heading|h[1-6]/i);
  });
});

test('trocar de tela preserva a composição da tela anterior antes de salvar', async () => {
  await withCanvasDom(async (document, getEditor) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts);
    await ui.openForm('quiz-lifecycle');
    addHeading(getEditor());
    await settled();
    document.querySelector('[data-quiz-canvas-target="1"]').click();
    await settled();
    document.querySelector('[data-quiz-canvas-target="0"]').click();
    await settled();
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    const savedA = puts[0].steps.find((step) => step.id === 'screen-a');
    const savedB = puts[0].steps.find((step) => step.id === 'screen-b');
    assert.match(savedA.canvas?.html || '', /heading|h[1-6]/i);
    assert.match(savedB.canvas?.html || '', /name="perfil"/);
  });
});

test('prévia salva antes de abrir o dialog e aponta o iframe para a rota HTML autenticada', async () => {
  await withCanvasDom(async (document, _getEditor) => {
    const puts = [];
    const events = [];
    const ui = formsUi(legacyForm(), puts, { events, previewHtml: '<!doctype html><html><body>Servidor</body></html>' });
    await ui.openForm('quiz-lifecycle');
    const title = document.querySelector('[data-quiz-screen-title]');
    title.value = 'Alterado';
    title.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    const preview = document.querySelector('#form-preview');
    preview.onclick = null;
    preview.click();
    await settled();

    assert.deepEqual(events, ['save']);
    const dialog = document.querySelector('#form-preview-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('iframe').src, 'https://studio.test/api/forms/quiz-lifecycle/preview?format=html');
  });
});

test('prévia exibe erro e não abre o dialog quando salvar falha', async () => {
  await withCanvasDom(async (document) => {
    const puts = [];
    const events = [];
    const errors = [];
    const ui = formsUi(legacyForm(), puts, {
      events,
      saveError: new Error('falha de prévia'),
      toast: (message) => errors.push(message),
    });
    await ui.openForm('quiz-lifecycle');
    const title = document.querySelector('[data-quiz-screen-title]');
    title.value = 'Alterado';
    title.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    document.querySelector('#form-preview').click();
    await settled();

    assert.deepEqual(events, ['save']);
    assert.deepEqual(errors, ['falha de prévia']);
    assert.equal(document.querySelector('#form-preview-dialog'), null);
  });
});

test('reordenar e excluir tela preserva o snapshot da tela remanescente', async () => {
  await withCanvasDom(async (document) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts);
    await ui.openForm('quiz-lifecycle');
    document.querySelector('[data-quiz-canvas-target="1"]').click();
    await settled();
    document.querySelector('[data-quiz-screen-move="-1"]').click();
    await settled();
    document.querySelector('[data-quiz-screen-delete]').click();
    await settled();
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].steps.map((step) => step.id), ['screen-a']);
    assert.match(puts[0].steps[0].canvas?.html || '', /name="nome"/);
  });
});

test('somente leitura não habilita mutação ou PUT', async () => {
  await withCanvasDom(async (document) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts, { can: () => false });
    await ui.openForm('quiz-lifecycle');
    assert.equal(document.querySelector('[data-quiz-add-screen]'), null);
    assert.match(document.querySelector('#dynamic-editor').textContent, /Somente leitura/);
    document.querySelector('#form-back').click();
    await settled();
    assert.equal(puts.length, 0);
  });
});

test('snapshot antigo recebe regra estrutural sem PUT em abertura somente leitura', async () => {
  await withCanvasDom(async (document, getEditor) => {
    const puts = [];
    const source = legacyForm();
    source.steps[0].canvas = oldVisualCanvas();
    const ui = formsUi(source, puts, { can: () => false });
    await ui.openForm(source.id);
    const css = getEditor().getCss();
    assert.match(css, /\.image-choices>:is\(h1,\s*h2,\s*h3,\s*p\)\{grid-column:1\/-1;?\}/);
    assert.ok(css.indexOf('.image-choices>:is') < css.indexOf('.image-choices p'), 'CSS explícito do usuário permanece posterior ao default');
    document.querySelector('#form-back').click();
    await settled();
    assert.equal(puts.length, 0);
  });
});

test('salvar e reabrir snapshot antigo preserva a regra estrutural de escolha visual', async () => {
  await withCanvasDom(async (document, getEditor) => {
    const puts = [];
    const source = legacyForm();
    source.steps[0].canvas = oldVisualCanvas();
    const ui = formsUi(source, puts);
    await ui.openForm(source.id);
    assert.match(getEditor().getCss(), /\.image-choices>:is\(h1,\s*h2,\s*h3,\s*p\)\{grid-column:1\/-1;?\}/);
    const title = document.querySelector('[data-quiz-screen-title]');
    title.value = 'Contexto atualizado';
    title.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    assert.match(puts[0].steps[0].canvas.css, /\.image-choices>:is\(h1,\s*h2,\s*h3,\s*p\)\{grid-column:1\/-1;?\}/);
    await ui.openForm(source.id);
    await settled();
    assert.match(getEditor().getCss(), /\.image-choices>:is\(h1,\s*h2,\s*h3,\s*p\)\{grid-column:1\/-1;?\}/);
  });
});

test('regras e cálculos usam catálogo do canvas, salvam e passam pela normalização do formulário', async () => {
  await withCanvasDom(async (document) => {
    const puts = [];
    const ui = formsUi(legacyForm(), puts);
    await ui.openForm('quiz-lifecycle');
    document.querySelector('[data-quiz-canvas-target="1"]').click();
    await settled();
    const flow = document.querySelector('[data-quiz-flow-editor]');
    assert.ok(flow, 'a tela deve expor os controles de fluxo');
    [...flow.querySelectorAll('button')].find((button) => button.textContent === 'Adicionar regra').click();
    [...flow.querySelectorAll('button')].find((button) => button.textContent === 'Adicionar cálculo').click();
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    const saved = puts[0];
    assert.equal(saved.steps[1].branching.rules[0].fieldId, 'perfil');
    assert.equal(saved.steps[1].branching.rules[0].value, 'Agência');
    assert.equal(saved.steps[1].branching.rules[0].nextScreenId, '$complete');
    assert.equal(saved.calculations.length, 1);
    const normalized = normalizeFormInput(saved);
    assert.equal(normalized.steps[1].branching.rules[0].fieldId, 'perfil');
    assert.equal(normalized.calculations.length, 1);
  });
});

test('atualiza regras e cálculos ao alterar o canvas sem trocar de tela', async () => {
  await withCanvasDom(async (document, getEditor) => {
    const ui = formsUi(legacyForm(), []);
    await ui.openForm('quiz-lifecycle');
    const editor = getEditor();
    const flow = () => document.querySelector('[data-quiz-flow-editor]');
    const addRule = () => [...flow().querySelectorAll('button')].find((button) => button.textContent === 'Adicionar regra');
    assert.equal(addRule().disabled, true, 'sem escolha o botão fica indisponível');
    editor.getWrapper().append(editor.BlockManager.get('quiz-single-choice').get('content'));
    editor.trigger('update');
    await settled();
    assert.equal(addRule().disabled, false, 'a nova escolha entra no catálogo sem trocar de tela');
    [...flow().querySelectorAll('button')].find((button) => button.textContent === 'Adicionar cálculo').click();
    await settled();
    editor.getWrapper().append(editor.BlockManager.get('bar-chart').get('content'));
    editor.trigger('update');
    const chart = editor.getWrapper().components().models.find((component) => String(component.getAttributes?.().class || '').includes('alva-chart-bars')) || editor.getWrapper().find('.alva-chart-bars')[0];
    editor.select(chart); editor.trigger('component:selected', chart);
    await settled();
    const source = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === 'Fonte')?.querySelector('select');
    assert.ok(source);
    assert.ok([...source.options].some((option) => option.textContent === 'Novo cálculo'), 'o gráfico lê cálculo criado nesta mesma montagem');
  });
});
