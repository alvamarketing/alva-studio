import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFormsUI } from '../public/forms.js';
import { quizCanvasCss } from '../public/quiz-elements.js';
import { renderDynamicForm } from '../server/dynamic-form.mjs';
import { normalizeFormInput } from '../server/form-store.mjs';

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => { await pause(); await pause(); };

function record(elements) {
  return {
    id: 'quiz-inspector', projectId: 'project-inspector', revision: 1, name: 'Escolhas', headerElements: [],
    steps: [{
      id: 'choice-screen', title: 'Escolha',
      elements: elements || [{ id: 'canal', type: 'image_choice', title: 'Como prefere falar?', required: false, options: [
        { label: 'WhatsApp', imageUrl: '', icon: 'chat' },
        { label: 'Ligação', imageUrl: '', icon: 'phone' },
      ] }],
    }],
    completion: { title: 'Ok', message: 'Ok' }, webhook: '', publicPath: '', calculations: [{ id: 'calc_total', label: 'Total estimado', operation: 'add', operands: [{ value: 0 }, { value: 0 }] }],
  };
}

async function withUi(run) {
  const { JSDOM } = await import(jsdomPath);
  const dom = new JSDOM(indexHtml, { url: 'https://studio.test/', pretendToBeVisual: true });
  const old = Object.fromEntries(['window', 'document', 'DOMParser', 'Node', 'HTMLElement', 'MutationObserver', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  let editor;
  let initOptions;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  // GrapesJS captures the document used by its upstream view helpers at
  // import time, so load it only after JSDOM is installed globally.
  const { default: grapesjs } = await import('grapesjs');
  dom.window.grapesjs = { ...grapesjs, init(options) {
    initOptions = options;
    // The GrapesJS StyleManager renders its own canvas view and dereferences a
    // null iframe element in JSDOM. It is unrelated to the custom inspector
    // under test, so disable only that upstream visual manager.
    editor = grapesjs.init({ ...options, headless: true, styleManager: false });
    return editor;
  } };
  try { return await run({ document: dom.window.document, getEditor: () => editor, getInitOptions: () => initOptions }); }
  finally { editor?.destroy(); Object.assign(globalThis, old); dom.window.close(); }
}

function apiFor(source, puts) {
  let value = structuredClone(source);
  return async (path, method = 'GET', body) => {
    if (path === `/forms/${source.id}` && method === 'GET') return structuredClone(value);
    if (path === `/forms/${source.id}` && method === 'PUT') {
      puts.push(structuredClone(body)); value = { ...value, ...structuredClone(body), revision: value.revision + 1 }; return structuredClone(value);
    }
    if (path === '/forms' || path === `/projects/${source.projectId}/videos`) return [];
    throw new Error(`unexpected ${method} ${path}`);
  };
}

function change(document, label, value) {
  const input = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === label)?.querySelector('input,select,textarea');
  assert.ok(input, `controle ${label}`);
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value;
  input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
}

function descendants(component) {
  const children = component?.components?.().models || [];
  return children.flatMap((child) => [child, ...descendants(child)]);
}

test('inspector altera escolha visual pelo DOM, persiste e o schema derivado permanece válido', async () => {
  await withUi(async ({ document, getEditor }) => {
    const puts = [];
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, puts), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const wrapper = descendants(editor.getWrapper()).find((component) => String(component.getAttributes?.().class || '').split(/\s+/).includes('image-choices'));
    assert.ok(wrapper, 'seed deve projetar o grupo de escolha visual');
    editor.select(wrapper);
    editor.trigger('component:selected', wrapper);
    await settled();
    assert.equal([...document.querySelectorAll('.fe-control-section h3')].some((heading) => heading.textContent === 'Conteúdo'), false);
    assert.equal([...document.querySelectorAll('.fe-properties label span')].some((caption) => caption.textContent === 'Nome da seção (para links)'), false);
    const icon1 = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === 'Ícone 1')?.querySelector('select');
    const icon2 = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === 'Ícone 2')?.querySelector('select');
    assert.ok(icon1 && icon2, 'ícones devem usar seleção guiada');
    assert.ok([...icon1.options].some((option) => option.textContent === 'Ícone atual' && option.value === 'chat'), 'ícone legado desconhecido permanece disponível sem ser alterado');
    change(document, 'Escolha visual', 'Qual canal você usa?');
    change(document, 'Opção 1', 'Mensagem');
    change(document, 'Imagem 1', 'https://cdn.test/mensagem.png');
    change(document, 'Ícone 2', 'forum');
    change(document, 'Obrigatória', true);
    await settled();
    const html = editor.getHtml();
    assert.match(html, /Qual canal você usa\?/);
    assert.match(html, /value="Mensagem"/);
    assert.match(html, /data-quiz-image="https:\/\/cdn\.test\/mensagem\.png"/);
    assert.match(html, /data-quiz-icon="forum"/);
    assert.match(html, /<img[^>]+src="https:\/\/cdn\.test\/mensagem\.png"/);
    assert.match(html, />forum</);
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    const normalized = normalizeFormInput(puts[0]);
    const field = normalized.steps[0].elements.find((element) => element.id === 'canal');
    assert.equal(field?.type, 'image_choice');
    assert.equal(field?.required, true);
    assert.deepEqual(field?.options.map((option) => option.label), ['Mensagem', 'Ligação']);
    const reopened = puts[0].steps[0].canvas;
    assert.match(reopened.html, /Qual canal você usa\?/);
    assert.match(reopened.html, /value="Mensagem"/);
  });
});

test('item semântico da árvore seleciona a escolha visual e abre seu inspector', async () => {
  await withUi(async ({ document, getEditor }) => {
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const label = [...document.querySelectorAll('.fe-tree-label')].find((node) => node.textContent.trim() === 'Escolha visual');
    assert.ok(label, 'a árvore deve expor o grupo como Escolha visual');
    label.closest('button').click();
    await settled();
    assert.equal(getEditor().getSelected().getAttributes()['data-quiz-type'], 'image_choice');
    assert.equal(document.querySelector('.fe-inspector-title h2')?.textContent, 'Escolha visual');
    assert.ok([...document.querySelectorAll('.fe-properties label')].some((row) => row.firstElementChild?.textContent === 'Escolha visual'));
  });
});

test('biblioteca adapta hero/contact tanto no clique quanto no drop para submissão única', async () => {
  await withUi(async ({ getEditor, getInitOptions }) => {
    const puts = [];
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, puts), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const click = getInitOptions().blockManager.appendOnClick;
    for (const id of ['hero-section', 'contact-section']) {
      click(editor.BlockManager.get(id));
      assert.doesNotMatch(editor.getHtml(), /<form\b|\baction=|\bonsubmit=|type="submit"/i, `${id} via clique`);
      const canvas = { version: 1, editorState: editor.getProjectData(), html: editor.getHtml(), css: editor.getCss() };
      const normalized = normalizeFormInput({ headerElements: [], steps: [{ id: 'screen', title: 'Screen', elements: [], canvas }], completion: { title: 'Ok', message: 'Ok' }, webhook: '' });
      assert.ok(normalized.steps[0].elements.every((element) => element.id));
    }
    for (const id of ['hero-section', 'contact-section']) {
      const [dropped] = editor.getWrapper().append(editor.BlockManager.get(id).get('content'));
      editor.trigger('block:drag:stop', dropped);
      assert.doesNotMatch(editor.getHtml(), /<form\b|\baction=|\bonsubmit=|type="submit"/i, `${id} via drag`);
    }
  });
});

test('vídeo incorporado usa iframe HTTPS, preserva canvas no save/reabertura e entra na prévia publicada', async () => {
  await withUi(async ({ document, getEditor, getInitOptions }) => {
    const puts = [];
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, puts), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    let editor = getEditor();
    getInitOptions().blockManager.appendOnClick(editor.BlockManager.get('embedded-video'));
    const wrapper = descendants(editor.getWrapper()).find((component) => String(component.getAttributes?.().class || '').split(/\s+/).includes('alva-embed-video'));
    assert.ok(wrapper, 'catálogo deve inserir o wrapper do vídeo');
    const treeVideo = [...document.querySelectorAll('.fe-tree button')].find((button) => button.textContent.includes('Vídeo incorporado'));
    assert.ok(treeVideo, 'a árvore deve expor apenas o vídeo sem o iframe técnico');
    treeVideo.click();
    await settled();
    assert.equal(editor.getSelected(), wrapper, 'a árvore mantém o wrapper selecionado');
    change(document, 'Endereço do vídeo', 'https://video.example.test/embed/quiz-1');
    change(document, 'Título do vídeo', 'Demonstração comercial');
    await settled();
    assert.match(editor.getHtml(), /class="alva-embed-video"/);
    assert.match(editor.getHtml(), /src="https:\/\/video\.example\.test\/embed\/quiz-1"/);
    assert.match(editor.getHtml(), /title="Demonstração comercial"/);
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    const normalized = normalizeFormInput(puts[0]);
    const canvas = normalized.steps[0].canvas;
    assert.match(canvas.html, /https:\/\/video\.example\.test\/embed\/quiz-1/);
    const published = renderDynamicForm({ ...normalized, id: source.id, name: source.name }, '/api/forms/preview');
    assert.match(published, /<iframe[^>]+src="https:\/\/video\.example\.test\/embed\/quiz-1"/);
    await ui.openForm(source.id);
    await settled();
    editor = getEditor();
    const reopenedWrapper = descendants(editor.getWrapper()).find((component) => String(component.getAttributes?.().class || '').split(/\s+/).includes('alva-embed-video'));
    editor.select(reopenedWrapper);
    editor.trigger('component:selected', reopenedWrapper);
    await settled();
    change(document, 'Endereço do vídeo', 'javascript:alert(1)');
    await settled();
    const control = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === 'Endereço do vídeo')?.querySelector('input');
    assert.match(control.validationMessage, /HTTPS/);
    assert.doesNotMatch(editor.getHtml(), /javascript:/i);
  });
});

test('frame do canvas recebe CSP e fonte pelo payload window do GrapesJS, sem CSS Landing ao inserir bloco', async () => {
  await withUi(async ({ document, getEditor, getInitOptions }) => {
    const { JSDOM } = await import(jsdomPath);
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const projectBeforeFrameLoad = JSON.stringify(editor.getProjectData());
    const frame = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    editor.trigger('canvas:frame:load', { window: frame.window });
    // GrapesJS renders and replaces the head after frame:load, then emits the
    // explicit :head and :body events. Keep the canvas resources through that
    // real sequence.
    frame.window.document.head.replaceChildren();
    editor.trigger('canvas:frame:load:head', { window: frame.window });
    editor.trigger('canvas:frame:load:body', { window: frame.window });
    editor.trigger('canvas:frame:load:body', { window: frame.window });
    assert.equal(frame.window.document.head.querySelectorAll('[data-alva-canvas-policy]').length, 1);
    assert.equal(frame.window.document.head.querySelectorAll('[data-alva-material-symbols]').length, 1);
    assert.equal(frame.window.document.head.querySelectorAll('[data-alva-canvas-selection]').length, 1);
    assert.match(frame.window.document.head.querySelector('[data-alva-material-symbols]').href, /material-symbols\.css$/);
    assert.match(quizCanvasCss, /\.material-symbols-outlined\{font-family:'Material Symbols Outlined'/);
    assert.equal(JSON.stringify(editor.getProjectData()), projectBeforeFrameLoad, 'recursos do frame não podem alterar o snapshot GrapesJS');
    getInitOptions().blockManager.appendOnClick(editor.BlockManager.get('heading'));
    assert.doesNotMatch(editor.getCss(), /--alva-block-base|\.hero-grid|#faf9f5/);
    assert.match(editor.getCss(), /--accent:#286eea/);
    frame.window.close();
    assert.ok(document.querySelector('#form-save'));
  });
});

test('inspector altera apenas o título da pergunta selecionada', async () => {
  const choices = (id, title) => ({ id, type: 'image_choice', title, required: false, options: [
    { label: 'Primeira opção', imageUrl: '', icon: 'chat' },
    { label: 'Segunda opção', imageUrl: '', icon: 'phone' },
  ] });
  await withUi(async ({ document, getEditor }) => {
    const source = record([choices('primeira', 'Pergunta um'), choices('segunda', 'Pergunta dois')]);
    const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const groups = descendants(editor.getWrapper()).filter((component) => component.getAttributes?.()['data-quiz-type'] === 'image_choice');
    assert.equal(groups.length, 2);
    editor.select(groups[1]);
    editor.trigger('component:selected', groups[1]);
    await settled();
    change(document, 'Escolha visual', 'Pergunta dois atualizada');
    await settled();
    const html = editor.getHtml();
    assert.match(html, />Pergunta um</);
    assert.match(html, />Pergunta dois atualizada</);
    assert.doesNotMatch(html, />Pergunta um atualizada</);
  });
});

test('inspector adiciona opção visual com markup completo, preserva required e remove opção', async () => {
  await withUi(async ({ document, getEditor }) => {
    const puts = [];
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, puts), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    let editor = getEditor();
    const wrapper = descendants(editor.getWrapper()).find((component) => String(component.getAttributes?.().class || '').split(/\s+/).includes('image-choices'));
    assert.ok(wrapper);
    editor.select(wrapper);
    editor.trigger('component:selected', wrapper);
    await settled();
    change(document, 'Obrigatória', true);
    const add = [...document.querySelectorAll('.fe-properties button')].find((button) => button.textContent.trim() === 'Adicionar opção');
    assert.ok(add, 'inspector deve permitir adicionar opção');
    add.click();
    await settled();
    change(document, 'Opção 3', 'Mensagem');
    change(document, 'Imagem 3', 'https://cdn.test/mensagem.png');
    change(document, 'Ícone 3', 'forum');
    await settled();
    assert.match(editor.getHtml(), /value="Mensagem"/);
    assert.match(editor.getHtml(), /data-quiz-image="https:\/\/cdn\.test\/mensagem\.png"/);
    assert.match(editor.getHtml(), /data-quiz-icon="forum"/);
    assert.match(editor.getHtml(), /<img[^>]+src="https:\/\/cdn\.test\/mensagem\.png"/);
    assert.match(editor.getHtml(), />forum</);
    document.querySelector('#form-save').click();
    await settled();
    assert.equal(puts.length, 1);
    await ui.openForm(source.id);
    await settled();
    editor = getEditor();
    const reopenedHtml = editor.getHtml();
    assert.match(reopenedHtml, /value="Mensagem"/);
    const normalized = normalizeFormInput(puts[0]);
    const field = normalized.steps[0].elements.find((element) => element.id === 'canal');
    assert.equal(field?.required, true);
    assert.deepEqual(field?.options.map((option) => option.label), ['WhatsApp', 'Ligação', 'Mensagem']);
    const reopenedWrapper = descendants(editor.getWrapper()).find((component) => component.getAttributes?.()['data-quiz-type'] === 'image_choice');
    editor.select(reopenedWrapper);
    editor.trigger('component:selected', reopenedWrapper);
    await settled();
    const remove = [...document.querySelectorAll('.fe-properties button')].find((button) => button.textContent.trim() === 'Remover opção 3');
    assert.ok(remove, 'inspector deve permitir remover a terceira opção');
    remove.click();
    await settled();
    assert.doesNotMatch(editor.getHtml(), /value="Mensagem"/);
    assert.match(editor.getHtml(), /value="WhatsApp"/);
    assert.match(editor.getHtml(), /value="Ligação"/);
    assert.equal(editor.getSelected().getAttributes()['data-quiz-required'], 'true');
  });
});

test('blocos de escolha inseridos pelo catálogo usam opções editáveis e esquema válido', async () => {
  await withUi(async ({ document, getEditor, getInitOptions }) => {
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    const insert = getInitOptions().blockManager.appendOnClick;
    const cases = [
      ['quiz-single-choice', 'single_choice', 'Nova pergunta', 'Única'],
      ['quiz-multiple-choice', 'multiple_choice', 'Nova pergunta', 'Múltipla'],
      ['quiz-image-choice', 'image_choice', 'Nova escolha visual', 'Visual'],
    ];
    for (const [blockId, type, question, prefix] of cases) {
      insert(editor.BlockManager.get(blockId));
      await settled();
      const group = descendants(editor.getWrapper()).find((component) => component.getAttributes?.()['data-quiz-type'] === type && component.getAttributes?.()['data-quiz-question'] === question);
      assert.ok(group, `${type} inserida pelo catálogo`);
      editor.select(group);
      editor.trigger('component:selected', group);
      await settled();
      change(document, type === 'image_choice' ? 'Escolha visual' : 'Pergunta', `${prefix} pergunta`);
      change(document, 'Obrigatória', true);
      change(document, 'Opção 1', `${prefix} 1`);
      change(document, 'Opção 2', `${prefix} 2`);
      [...document.querySelectorAll('.fe-properties button')].find((button) => button.textContent.trim() === 'Adicionar opção').click();
      await settled();
      change(document, 'Opção 3', `${prefix} 3`);
      const html = editor.getHtml();
      assert.match(html, new RegExp(`data-quiz-type="${type}"`));
      assert.match(html, /class="choices/);
      assert.match(html, /class="choice/);
      const names = descendants(group).filter((component) => ['radio', 'checkbox'].includes(component.getAttributes?.().type)).map((component) => component.getAttributes().name);
      assert.equal(new Set(names).size, 1, `${type} mantém um nome por grupo`);
      assert.equal(names.length, 3, `${type} mantém as três opções`);
      if (type === 'multiple_choice') assert.equal(group.getAttributes()['data-quiz-required'], 'true');
      else assert.ok(descendants(group).filter((component) => ['radio', 'checkbox'].includes(component.getAttributes?.().type)).every((component) => component.getAttributes().required));
    }
    const canvas = { version: 1, editorState: editor.getProjectData(), html: editor.getHtml(), css: editor.getCss() };
    const normalized = normalizeFormInput({ headerElements: [], steps: [{ id: 'catalogo', title: 'Catálogo', elements: [], canvas }], completion: source.completion, webhook: '' });
    for (const [, type, , prefix] of cases) {
      const field = normalized.steps[0].elements.find((element) => element.type === type && element.options.map((option) => typeof option === 'string' ? option : option.label).join(',') === `${prefix} 1,${prefix} 2,${prefix} 3`);
      assert.ok(field, `${type} normalizada com três opções`);
      assert.equal(field.required, true);
    }
  });
});

test('gráfico do quiz preserva vínculos de cálculos por linha', async () => {
  await withUi(async ({ getEditor, getInitOptions }) => {
    const source = record();
    const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    getInitOptions().blockManager.appendOnClick(editor.BlockManager.get('bar-chart'));
    await settled();
    const chart = descendants(editor.getWrapper()).find((component) => String(component.getAttributes?.().class || '').split(/\s+/).includes('alva-chart-bars'));
    assert.ok(chart);
    editor.select(chart); editor.trigger('component:selected', chart);
    await settled();
    const sourceSelect = [...document.querySelectorAll('.fe-properties label')].find((row) => row.firstElementChild?.textContent === 'Fonte')?.querySelector('select');
    assert.ok(sourceSelect);
    sourceSelect.value = 'calc_total';
    sourceSelect.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await settled();
    assert.deepEqual(JSON.parse(chart.getAttributes()['data-alva-chart-bindings']), ['calc_total', null, null]);
  });
});

test('rótulo de campo atualiza o modelo e a view montada sem recriar o input', async () => {
  await withUi(async ({ document, getEditor, getInitOptions }) => {
    const source = record(); const ui = createFormsUI({ api: apiFor(source, []), toast: () => {}, can: () => true, getProjectId: () => source.projectId, mediaEnabled: () => false });
    await ui.openForm(source.id);
    const editor = getEditor();
    getInitOptions().blockManager.appendOnClick(editor.BlockManager.get('quiz-select'));
    await settled();
    const label = descendants(editor.getWrapper()).find((component) => component.get?.('tagName') === 'label' && component.getAttributes?.().name === undefined && descendants(component).some((child) => child.get?.('tagName') === 'select'));
    assert.ok(label);
    editor.select(label); editor.trigger('component:selected', label); await settled();
    change(document, 'Nome mostrado acima do campo', 'Quantidade');
    const textNode = label.components().models.find((component) => component.is('textnode'));
    assert.equal(textNode.get('content'), 'Quantidade');
    assert.match(editor.getHtml(), /Quantidade<select/);
  });
});
