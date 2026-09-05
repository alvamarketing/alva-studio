import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFormsUI,
  createStep,
  createScreen,
  formTreeNodes,
  formTreeSelection,
  moveStep,
  parseOptions,
} from '../public/forms.js';
import * as FormsModule from '../public/forms.js';

const htmlPath = new URL('../public/index.html', import.meta.url);
const cssPath = new URL('../public/forms.css', import.meta.url);
const formsPath = new URL('../public/forms.js', import.meta.url);

test('dashboard oferece páginas e formulários dinâmicos como destinos principais', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /id="nav-pages"/);
  assert.match(html, /id="nav-forms"/);
  assert.match(html, /Formulários Dinâmicos/);
  assert.match(html, /id="forms-view"/);
  assert.match(html, /id="new-form"/);
  assert.match(html, /id="form-editing"/);
  assert.match(html, /id="form-responses-dialog"/);
});

test('editor cria e reordena etapas sem alterar o array original', () => {
  const step = createStep('single_choice', 'etapa-1');
  assert.equal(step.type, 'single_choice');
  assert.equal(step.options.length, 2);
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveStep(rows, 1, -1).map((row) => row.id), ['b', 'a', 'c']);
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(moveStep(rows, 0, -1), rows);
});

test('árvore do formulário preserva topo, telas, elementos e a seleção compartilhada', () => {
  const nodes = formTreeNodes({
    headerElements: [{ id: 'logo', type: 'logo', title: 'Marca' }],
    steps: [
      { id: 'tela-inicial', title: 'Início', elements: [{ id: 'nome', type: 'short_text', title: 'Seu nome' }] },
      { id: 'tela-final', title: 'Confirmação', elements: [{ id: 'aviso', type: 'statement', title: 'Tudo certo' }] },
    ],
    selected: 1,
    selectedElement: 0,
    editingHeader: false,
  });

  assert.deepEqual(nodes.map(({ id, parentId, kind, label, level, selected }) => ({ id, parentId, kind, label, level, selected })), [
    { id: 'header', parentId: null, kind: 'header', label: 'Topo fixo', level: 1, selected: false },
    { id: 'header:0', parentId: 'header', kind: 'element', label: 'Marca', level: 2, selected: false },
    { id: 'screen:0', parentId: null, kind: 'screen', label: 'Início', level: 1, selected: false },
    { id: 'screen:0:element:0', parentId: 'screen:0', kind: 'element', label: 'Seu nome', level: 2, selected: false },
    { id: 'screen:1', parentId: null, kind: 'screen', label: 'Confirmação', level: 1, selected: false },
    { id: 'screen:1:element:0', parentId: 'screen:1', kind: 'element', label: 'Tudo certo', level: 2, selected: true },
  ]);
  assert.deepEqual(formTreeSelection(nodes[1]), { editingHeader: true, selected: 1, selectedElement: 0 });
  assert.deepEqual(formTreeSelection(nodes[5]), { editingHeader: false, selected: 1, selectedElement: 0 });
  assert.equal(formTreeSelection({}), null);
});

test('árvore de formulários navega por setas, Home e End e restaura o foco após renderizar', () => {
  assert.equal(typeof FormsModule.formTreeKeyAction, 'function');
  assert.equal(typeof FormsModule.bindFormTreeItem, 'function');
  assert.equal(typeof FormsModule.restoreFormTreeFocus, 'function');

  const ids = ['header', 'header:0', 'screen:0'];
  let items = [];
  let selectedId = ids[0];
  let focusedId = null;
  const makeItem = (id) => ({
    dataset: { treeId: id },
    focus() {
      focusedId = id;
    },
  });
  const render = (nextId, activeItem) => {
    selectedId = nextId;
    items = ids.map(makeItem);
    items.forEach((item) => FormsModule.bindFormTreeItem(item, ids, (id, sourceItem) => render(id, sourceItem)));
    FormsModule.restoreFormTreeFocus(items, nextId, activeItem);
  };

  render(ids[0], null);
  let prevented = false;
  items[0].onkeydown({ key: 'ArrowDown', preventDefault: () => { prevented = true; } });
  assert.equal(selectedId, 'header:0');
  assert.equal(focusedId, 'header:0');
  assert.equal(prevented, true);

  items[1].onkeydown({ key: 'End', preventDefault: () => {} });
  assert.equal(selectedId, 'screen:0');
  assert.equal(focusedId, 'screen:0');
  items[2].onkeydown({ key: 'Home', preventDefault: () => {} });
  assert.equal(selectedId, 'header');
  assert.equal(focusedId, 'header');
});

test('editor mantém headerElements vazio editável sem substituir o schema', async () => {
  const previousDocument = globalThis.document;
  const elements = new Map();
  const element = () => ({
    classList: { toggle() {} },
    hidden: false,
    value: '',
    textContent: '',
    innerHTML: '',
    children: [],
    replaceChildren() {
      this.children = [];
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {},
  });
  for (const selector of [
    '#nav-pages', '#nav-forms', '#pages-view', '#forms-view', '#form-search', '#form-count', '#new-form',
    '#dynamic-create-form', '#dynamic-form-name', '#form-save', '#form-back', '#form-public-link',
    '#form-responses', '#form-list', '#form-editing', '#form-save-state', '#dynamic-editor', '#dynamic-preview',
  ]) elements.set(selector, element());
  const headerButton = { dataset: { treeNode: 'header' }, focus() {} };
  globalThis.document = {
    querySelector: (selector) => [
      '[data-screen-duplicate]', '[data-screen-delete]', '[data-element-duplicate]', '[data-element-delete]',
    ].includes(selector) ? null : elements.get(selector) || element(),
    querySelectorAll: (selector) => selector === '[data-tree-node]' ? [headerButton] : [],
  };
  try {
    const headerElements = [];
    const formsUI = createFormsUI({
      api: async (path) => path === '/forms/form-empty' ? {
        id: 'form-empty', name: 'Vazio', revision: 1, headerElements,
        steps: [{ id: 'screen-1', title: 'Pergunta', elements: [createStep('short_text', 'field-1')] }],
        completion: { title: 'Obrigado!', message: 'Recebemos.' }, webhook: '',
      } : [],
      toast: () => {},
    });

    await formsUI.openForm('form-empty');

    headerButton.onclick();

    assert.deepEqual(headerElements, []);
    assert.match(elements.get('#dynamic-editor').innerHTML, /Topo fixo/);
    assert.match(elements.get('#dynamic-editor').innerHTML, /Adicionar ao topo/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('catálogo dinâmico oferece perguntas, mídia, conversão e gráficos com ícone e movimento', () => {
  for (const type of ['long_text', 'multiple_choice', 'image', 'video', 'vsl', 'date', 'number', 'scale', 'address', 'file', 'cta', 'statement', 'chart']) {
    const step = createStep(type, `etapa-${type}`);
    assert.equal(step.type, type);
    assert.match(step.icon, /^[a-z_]+$/);
    assert.equal(step.motion, 'fade-up');
  }
  assert.deepEqual(createStep('scale', 'escala').range, { min: 1, max: 10 });
  assert.deepEqual(createStep('chart', 'grafico').chart.values, [72, 48, 86]);
  assert.equal(createStep('vsl', 'vsl-1').required, false);
  assert.equal(createStep('vsl', 'vsl-1').publicId, '');
});

test('editor de formulários lista VSLs publicadas do projeto e mantém somente publicId no schema', async () => {
  const [css, source] = await Promise.all([readFile(cssPath, 'utf8'), readFile(formsPath, 'utf8')]);
  assert.match(source, /\/projects\/.*\/videos/);
  assert.match(source, /video\.read/);
  assert.match(source, /form\.write/);
  assert.match(source, /publicId/);
  assert.match(source, /data-field="motion"/);
  assert.match(source, /MOTIONS\.map/);
  assert.match(source, /INFORMATIONAL = new Set\(\[[^\]]*['"]vsl['"]/);
  assert.match(source, /filter\(\(element\) => !INFORMATIONAL\.has\(element\.type\)\)/);
  assert.doesNotMatch(source, /data-field="sourceUrl"|data-field="posterUrl"|data-field="ctaUrl"/);
  assert.match(source, /vslEmbedUrl|embed\/v/);
  assert.match(css, /dynamic-vsl/);
});

test('editor de formulários oferece opções visuais e estados acessíveis da VSL', async () => {
  const source = await readFile(formsPath, 'utf8');
  assert.match(source, /dynamic-vsl-options/);
  assert.match(source, /data-vsl-option/);
  assert.match(source, /status.*Publicada/);
  assert.match(source, /VSL não encontrada\. Publique a VSL antes de usar/);
  assert.match(source, /aria-label="Prévia da VSL/);
  assert.match(source, /disabled = !editable/);
  assert.match(source, /Remover seleção/);
  assert.match(source, /role="radio"/);
  assert.match(source, /aria-checked/);
  assert.doesNotMatch(source, /dynamic-vsl-option[^\n]*aria-pressed/);
  assert.match(source, /previewVslElementMarkup/);
});

test('opções eliminam linhas vazias e preservam rótulos únicos', () => {
  assert.deepEqual(parseOptions(' Empresa\n\nProfissional\nEmpresa '), ['Empresa', 'Profissional']);
});

test('editor dinâmico tem árvore única, prévia central, inspetor, abas móveis e controles acessíveis', async () => {
  const [css, source] = await Promise.all([readFile(cssPath, 'utf8'), readFile(formsPath, 'utf8')]);
  assert.match(css, /\.dynamic-editor-grid/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /\.dynamic-structure-tree/);
  assert.match(css, /\.dynamic-tree-item\[aria-selected=['"]true['"]\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.material-symbols-outlined/);
  assert.match(source, /role="tree"/);
  assert.match(source, /role="treeitem"/);
  assert.match(source, /aria-level=/);
  assert.match(source, /aria-selected=/);
  assert.match(source, /dynamic-preview-panel/);
  assert.match(source, /dynamic-properties-panel/);
  assert.match(source, /workspaceState/);
  assert.match(source, /workspaceKeyAction/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-labelledby=/);
  assert.match(source, /panel\.hidden\s*=/);
  assert.match(source, /panel\.inert\s*=/);
  assert.match(source, /aria-label="Mover tela para cima"/);
  assert.match(source, /aria-label="Duplicar elemento"/);
  assert.match(source, /aria-label="Excluir elemento"/);
  assert.doesNotMatch(source, /dynamic-elements-list/);
  assert.match(css, /\.editor-workspace-tabs/);
  assert.match(css, /\[data-editor-panel\]\[hidden\]/);
  assert.match(css, /height:\s*calc\(100dvh\s*-\s*112px\)/);
});

test('editor cria telas compostas com mais de um elemento', () => {
  const screen = createScreen('capture', 'tela-inicial');
  assert.equal(screen.id, 'tela-inicial');
  assert.ok(screen.elements.length >= 3);
  assert.ok(screen.elements.some((element) => element.type === 'short_text'));
  assert.ok(screen.elements.some((element) => element.type === 'phone'));
});

test('reset público remove cartões de formulários do contexto anterior', () => {
  const previousDocument = globalThis.document;
  const elements = new Map();
  const element = () => ({
    classList: { toggle() {} },
    hidden: false,
    children: ['cartão antigo'],
    replaceChildren() {
      this.children = [];
    },
  });
  for (const selector of [
    '#nav-pages',
    '#nav-forms',
    '#pages-view',
    '#forms-view',
    '#form-search',
    '#new-form',
    '#dynamic-create-form',
    '#dynamic-form-name',
    '#form-save',
    '#form-back',
    '#form-public-link',
    '#form-responses',
    '#form-list',
    '#form-editing',
  ]) {
    elements.set(selector, element());
  }
  globalThis.document = {
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: () => [],
  };
  try {
    const formsUI = createFormsUI({ api: async () => [], toast: () => {} });

    formsUI.reset();

    assert.deepEqual(elements.get('#form-list').children, []);
    assert.equal(elements.get('#form-editing').hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('resposta de formulário iniciada antes do reset não recompõe cartões antigos', async () => {
  const previousDocument = globalThis.document;
  const elements = new Map();
  const element = () => ({
    classList: { toggle() {} },
    hidden: false,
    value: '',
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
    append(child) {
      this.children.push(child);
    },
    querySelector() {
      return element();
    },
  });
  for (const selector of [
    '#nav-pages', '#nav-forms', '#pages-view', '#forms-view', '#form-search', '#form-count', '#new-form',
    '#dynamic-create-form', '#dynamic-form-name', '#form-save', '#form-back', '#form-public-link',
    '#form-responses', '#form-list', '#form-editing',
  ]) {
    elements.set(selector, element());
  }
  let resolveForms;
  globalThis.document = {
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: () => [],
    createElement: element,
  };
  try {
    const formsUI = createFormsUI({
      api: () => new Promise((resolve) => (resolveForms = resolve)),
      toast: () => {},
    });

    const pending = formsUI.showForms();
    formsUI.reset();
    resolveForms([{ id: 'form-old', name: 'Formulário antigo', stepCount: 1, submissionCount: 0 }]);
    await pending;

    assert.deepEqual(elements.get('#form-list').children, []);
  } finally {
    globalThis.document = previousDocument;
  }
});
