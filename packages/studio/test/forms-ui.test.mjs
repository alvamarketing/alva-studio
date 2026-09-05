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

test('catálogo dinâmico oferece perguntas, mídia, conversão e gráficos com ícone e movimento', () => {
  for (const type of ['long_text', 'multiple_choice', 'image', 'video', 'date', 'number', 'scale', 'address', 'file', 'cta', 'statement', 'chart']) {
    const step = createStep(type, `etapa-${type}`);
    assert.equal(step.type, type);
    assert.match(step.icon, /^[a-z_]+$/);
    assert.equal(step.motion, 'fade-up');
  }
  assert.deepEqual(createStep('scale', 'escala').range, { min: 1, max: 10 });
  assert.deepEqual(createStep('chart', 'grafico').chart.values, [72, 48, 86]);
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
