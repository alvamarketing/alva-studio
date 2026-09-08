import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import grapesjs from 'grapesjs';
import {
  safeDestination,
  chartAncestor,
  chartBlockContainer,
  chartInsertionTarget,
  chartRows,
  donutSegments,
  updateChartRow,
  removeChartRow,
  componentLabel,
  editorialLabel,
  editorialElementLabel,
  isMaterialIcon,
  setHeadingLevel,
  inspectorTextAlign,
  inspectorNumber,
  setComponentText,
  renderMotionPopover,
  bindInspectorRepaintOnFocusout,
  panelMode,
  editorActionMeta,
  isCanvasBackgroundElement,
  blockIcons,
  editorKeyboardAction,
  componentTreeNodes,
  treeKeyAction,
  restoreTreeFocus,
  bindTreeItemActivation,
  vslBlockState,
  publishedVslOptions,
  vslEmbedUrl,
  createVslComponentType,
  renderVslReferences,
  buildPageExportHtml,
  vslEditorOptions,
  vslCanvasMessage,
  renderVslOptionCards,
  vslOptionKeyboardAction,
  editorInteractionPolicy,
  applyEditorInteractionPolicy,
  createReadOnlyMutationGuard,
  restoreVslOptionFocus,
} from '../public/editor-shell.js';

test('heading troca somente a tag e ícone é reconhecido pelas classes do modelo', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    const heading = editor.getWrapper().append({ tagName: 'h2', attributes: { id: 'titulo' }, components: [{ type: 'textnode', content: 'Título com destaque' }] })[0];
    heading.addStyle({ color: '#286eea' });
    const children = heading.components().models;
    assert.equal(setHeadingLevel(heading, 'h1'), true);
    assert.equal(heading.get('tagName'), 'h1');
    assert.equal(heading.components().models[0], children[0]);
    assert.equal(heading.getAttributes().id, 'titulo');
    assert.equal(heading.getStyle().color, '#286eea');
    assert.equal(setHeadingLevel(heading, 'script'), false);
    const editableButton = editor.getWrapper().append({ tagName: 'a', attributes: { href: '#contato' }, components: [{ type: 'textnode', content: 'Antes' }] })[0];
    setComponentText(editableButton, 'Ver a oferta');
    assert.match(editor.getHtml(), /<a href="#contato">Ver a oferta<\/a>/);
    const icon = editor.getWrapper().append({ tagName: 'span', classes: ['material-symbols-outlined'], components: [{ type: 'textnode', content: 'star' }] })[0];
    assert.equal(isMaterialIcon(icon), true);
    assert.equal(editorialElementLabel(icon), 'Ícone');
  } finally { editor.destroy(); }
});

test('controles DOM do inspector respeitam a permissão e o popover de movimento', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<div class="fe-properties"><textarea aria-label="Texto"></textarea><div class="fe-heading-levels"><button>H1</button><button>H2</button><button>H3</button></div><input aria-label="Cor"><select aria-label="Alinhamento"><option>À esquerda</option></select><div class="fe-element-actions"><button>Mover</button></div></div>');
  try {
    const root = dom.window.document.querySelector('.fe-properties');
    const changes = [];
    const motion = renderMotionPopover({ document: dom.window.document, value: 'float', onChange: (value) => changes.push(value) });
    root.append(motion);
    const trigger = motion.querySelector('.fe-motion-trigger');
    const popover = motion.querySelector('.fe-motion-popover');
    assert.equal(trigger.firstElementChild.textContent, 'Flutuar');
    assert.equal(popover.hidden, true);
    let repaints = 0;
    const unbindRepaint = bindInspectorRepaintOnFocusout(root, () => { repaints += 1; });
    const text = root.querySelector('textarea');
    text.focus();
    const pointer = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(pointer);
    assert.equal(pointer.defaultPrevented, true);
    text.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: trigger }));
    trigger.click();
    assert.equal(repaints, 0);
    assert.equal(popover.hidden, false);
    trigger.click();
    assert.equal(popover.hidden, true);
    assert.equal(dom.window.document.activeElement, trigger);
    trigger.click();
    popover.querySelector('[data-motion="fade-up"]').click();
    assert.deepEqual(changes, ['fade-up']);
    assert.equal(trigger.firstElementChild.textContent, 'Suave');
    assert.equal(popover.hidden, true);
    trigger.click();
    popover.querySelector('[data-motion="fade-up"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(popover.hidden, true);
    assert.equal(inspectorTextAlign('start', 'ltr'), 'left');
    assert.equal(inspectorTextAlign('start', 'rtl'), 'right');
    assert.equal(inspectorTextAlign('end', 'rtl'), 'left');
    assert.equal(inspectorNumber(28.139999389648438), 28.14);
    text.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    assert.equal(repaints, 1);
    unbindRepaint();
    const policy = applyEditorInteractionPolicy(root, () => false);
    assert.equal(policy.canEdit, false);
    assert.ok([...root.querySelectorAll('textarea, input, select, button')].every((control) => control.disabled));
  } finally { dom.window.close(); }
});

test('referência de VSL no editor persiste somente o identificador público', () => {
  assert.deepEqual(vslBlockState(' public-vsl-123456 '), { type: 'vsl', publicId: 'public-vsl-123456' });
  assert.deepEqual(vslBlockState(''), { type: 'vsl', publicId: '' });
  assert.equal(JSON.stringify(vslBlockState('vsl-1')).includes('sourceUrl'), false);
  assert.equal(JSON.stringify(vslBlockState('vsl-1')).includes('cta'), false);
  assert.equal(JSON.stringify(vslBlockState('vsl-1')).includes('version'), false);
});

test('catálogo do editor mostra somente VSLs publicadas e a prévia usa o embed público', () => {
  assert.deepEqual(
    publishedVslOptions([
      { publicId: 'draft', name: 'Rascunho' },
      { publicId: 'draft-version-id', name: 'Sem publicação', versionId: 'version-1' },
      { publicId: 'draft-version-number', name: 'Sem publicação', versionNumber: 1 },
      { publicId: 'published', name: 'Publicada', publishedVersionId: 'version-1', sourceUrl: 'https://draft.invalid' },
    ]),
    [{ publicId: 'published', name: 'Publicada', status: 'Publicada' }],
  );
  assert.equal(vslEmbedUrl('https://studio.example.test', 'public/vsl'), 'https://studio.example.test/embed/v/public%2Fvsl');
  assert.throws(() => vslEmbedUrl('javascript:alert(1)', 'public-vsl-123456'), /origem pública/i);
});

test('catálogo visual da VSL expõe somente nome, status e estado de prévia', () => {
  assert.deepEqual(vslEditorOptions([
    { publicId: 'draft', name: 'Rascunho' },
    { publicId: 'published', name: 'Oferta', publishedVersionId: 'version-1', sourceUrl: 'https://private.invalid/video.mp4' },
  ]), [{ publicId: 'published', name: 'Oferta', status: 'Publicada' }]);
  assert.equal(vslCanvasMessage({ publicId: 'missing', canRead: true }), 'VSL não encontrada. Publique a VSL antes de usar.');
  assert.equal(vslCanvasMessage({ publicId: '', canRead: true }), 'Escolha uma VSL publicada.');
  assert.equal(vslCanvasMessage({ publicId: 'missing', canRead: false }), 'Você não tem permissão para visualizar VSLs.');
});

test('cards de VSL oferecem remoção acessível e navegação por setas', () => {
  const markup = renderVslOptionCards([
    { publicId: 'published', name: 'Oferta', publishedVersionId: 'version-1' },
  ], 'published');
  assert.match(markup, /role="radiogroup"/);
  assert.match(markup, /data-vsl-option=""/);
  assert.match(markup, /Remover seleção/);
  assert.match(markup, /aria-checked="true"/);
  assert.doesNotMatch(markup, /aria-pressed/);
  assert.equal(vslOptionKeyboardAction({ key: 'ArrowDown' }, ['', 'published'], ''), 'published');
  assert.equal(vslOptionKeyboardAction({ key: 'ArrowUp' }, ['', 'published'], ''), 'published');
  assert.equal(vslOptionKeyboardAction({ key: 'ArrowDown' }, ['', 'disabled', 'published'], '', ['disabled']), 'published');
  assert.equal(vslOptionKeyboardAction({ key: 'ArrowDown' }, ['', 'disabled', 'published'], 'published', ['disabled']), '');
  assert.equal(vslOptionKeyboardAction({ key: 'Home' }, ['', 'published'], 'published'), '');
  let focused = '';
  assert.equal(restoreVslOptionFocus([{ dataset: { vslOption: 'published' }, focus: () => { focused = 'published'; } }], 'published'), true);
  assert.equal(focused, 'published');
  const radios = [
    { dataset: { vslOption: '' }, focus: () => { focused = ''; } },
    { dataset: { vslOption: 'disabled' }, disabled: true, focus: () => { focused = 'disabled'; } },
    { dataset: { vslOption: 'published' }, focus: () => { focused = 'published'; } },
  ];
  let selected = '';
  selected = vslOptionKeyboardAction({ key: 'ArrowRight' }, radios.map((radio) => radio.dataset.vslOption), selected, ['disabled']);
  assert.equal(selected, 'published');
  restoreVslOptionFocus(radios, selected);
  assert.equal(focused, 'published');
  selected = vslOptionKeyboardAction({ key: 'ArrowRight' }, radios.map((radio) => radio.dataset.vslOption), selected, ['disabled']);
  assert.equal(selected, '');
  restoreVslOptionFocus(radios, selected);
  assert.equal(focused, '');
});

test('landing page sem page.write mantém catálogo, edição, ordem e exclusão inativos', () => {
  const policy = editorInteractionPolicy((capability) => capability === 'video.read');
  assert.deepEqual(policy, {
    canEdit: false,
    canAdd: false,
    canReorder: false,
    canDelete: false,
    canInlineEdit: false,
    canReadVsl: true,
  });
  assert.equal(editorInteractionPolicy((capability) => capability === 'page.write').canAdd, true);
  assert.equal(editorInteractionPolicy(() => false).canReadVsl, false);
  const library = {};
  const controls = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const root = {
    querySelector(selector) { return selector === '.fe-library' ? library : null; },
    querySelectorAll() { return controls; },
  };
  applyEditorInteractionPolicy(root, (capability) => capability === 'video.read');
  assert.equal(library.hidden, true);
  assert.deepEqual(controls.map((control) => control.disabled), [true, true, true]);
  const editableLibrary = {};
  const editableControls = [{ disabled: false }, { disabled: false }];
  applyEditorInteractionPolicy({
    querySelector() { return editableLibrary; },
    querySelectorAll() { return editableControls; },
  }, (capability) => capability === 'page.write');
  assert.equal(editableLibrary.hidden, false);
  assert.deepEqual(editableControls.map((control) => control.disabled), [false, false]);
});

test('preview da VSL mantém iframe fora do botão de seleção', async () => {
  const { previewVslElementMarkup } = await import('../public/forms.js');
  const markup = previewVslElementMarkup({
    element: { type: 'vsl', title: 'Oferta', publicId: 'public-vsl' },
    index: 0,
    options: { vslEmbedUrls: new Map([['public-vsl', 'https://studio.test/embed/v/public-vsl']]) },
  });
  assert.match(markup, /<button[^>]*data-preview-element="0"/);
  assert.match(markup, /<iframe[^>]+src="https:\/\/studio\.test\/embed\/v\/public-vsl"/);
  assert.doesNotMatch(markup, /<button[^>]*>[^]*<iframe[^]*<\/button>/);
  const headerMarkup = previewVslElementMarkup({
    element: { type: 'vsl', title: 'Topo', publicId: 'public-vsl' },
    index: 1,
    header: true,
    options: { vslEmbedUrls: new Map([['public-vsl', 'https://studio.test/embed/v/public-vsl']]) },
  });
  assert.match(headerMarkup, /data-preview-header="1"/);
  assert.doesNotMatch(headerMarkup, /<button[^>]*>[^]*<iframe[^]*<\/button>/);
});

test('guard read-only restaura mutações programáticas reais do GrapesJS', async () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const main = editor.getWrapper().append({ tagName: 'main' })[0];
  main.append({ tagName: 'section', attributes: { id: 'one' } });
  main.append({ tagName: 'section', attributes: { id: 'two' } });
  const snapshot = editor.getProjectData();
  let restores = 0;
  const guard = createReadOnlyMutationGuard(editor, { snapshot, lock: () => { restores += 1; } });
  const original = JSON.stringify(snapshot);
  const mutateAndAssert = async (mutation) => {
    mutation();
    await Promise.resolve();
    assert.equal(JSON.stringify(editor.getProjectData()), original);
  };
  await mutateAndAssert(() => editor.getWrapper().components().at(0).components().at(0).set('attributes', { id: 'changed' }));
  await mutateAndAssert(() => editor.getWrapper().components().at(0).set('style', { color: 'red' }));
  await mutateAndAssert(() => editor.getWrapper().components().at(0).set('foo', 'bar'));
  await mutateAndAssert(() => editor.getWrapper().components().at(0).addStyle({ background: 'red' }));
  await mutateAndAssert(() => editor.getWrapper().append({ tagName: 'div', attributes: { id: 'new' } }));
  await mutateAndAssert(() => editor.getWrapper().components().at(0).remove());
  await mutateAndAssert(() => editor.getWrapper().components().at(0).components().at(1).move(editor.getWrapper().components().at(0), { at: 0 }));
  assert.equal(restores, 7);
  guard.dispose();
  editor.destroy();
});

test('modelo VSL montado no caminho headless do GrapesJS elimina configuração legada', () => {
  const definition = createVslComponentType({
    publicOrigin: 'https://studio.example.test',
    publishedVslById: new Map([['public-vsl-123456', { publicId: 'public-vsl-123456', name: 'VSL publicada' }]]),
  });
  const model = {
    attributes: {
      type: 'vsl',
      publicId: 'public-vsl-123456',
      tagName: 'div',
      droppable: false,
      attributes: { 'data-alva-vsl': 'public-vsl-123456', sourceUrl: 'https://draft.invalid' },
      sourceUrl: 'https://draft.invalid',
      cta: { text: 'Comprar', url: 'https://draft.invalid' },
      version: 4,
      config: { autoplayMuted: true },
    },
    get(key) { return this.attributes[key]; },
    set(key, value) { this.attributes[key] = value; },
    unset(key) { delete this.attributes[key]; },
    listenTo() {},
  };
  definition.model.init.call(model);
  assert.deepEqual(model.attributes, {
    type: 'vsl',
    publicId: 'public-vsl-123456',
    tagName: 'div',
    droppable: false,
    attributes: { 'data-alva-vsl': 'public-vsl-123456' },
  });
});

test('prévia do componente troca e remove o iframe público e a saída transforma placeholders', () => {
  const definition = createVslComponentType({
    publicOrigin: 'https://studio.example.test',
    publishedVslById: new Map([['public-vsl-123456', { publicId: 'public-vsl-123456', name: 'VSL publicada' }]]),
  });
  const doc = { createElement(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      classList: { add() {} },
      setAttribute(name, value) { this.attributes = { ...(this.attributes || {}), [name]: value }; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children = [...(this.children || []), ...children]; },
      ownerDocument: doc,
    };
  } };
  const element = doc.createElement('div');
  const view = { el: element, model: { get: (key) => key === 'publicId' ? 'public-vsl-123456' : undefined } };
  definition.view.onRender.call(view);
  assert.equal(element.children[0].src, 'https://studio.example.test/embed/v/public-vsl-123456');
  view.model.get = (key) => key === 'publicId' ? 'other-vsl' : undefined;
  definition.view.onRender.call(view);
  assert.match(element.children[0].textContent, /VSL não encontrada/);
  definition.view.removed.call(view);
  assert.deepEqual(element.children, []);
  assert.match(renderVslReferences('<div data-alva-vsl="public-vsl-123456"></div>', { publicOrigin: 'https://studio.example.test' }), /<iframe[^>]+src="https:\/\/studio\.example\.test\/embed\/v\/public-vsl-123456"/);
});

test('fluxo comportamental de exportação materializa o iframe público com título seguro', () => {
  const output = buildPageExportHtml({
    title: 'Página <VSL>',
    css: '.alva-vsl-frame{aspect-ratio:16/9}',
    html: '<main><div data-alva-vsl="public-vsl-123456"></div></main>',
    js: 'window.pageReady = true;',
    publicOrigin: 'https://studio.example.test',
  });
  assert.match(output, /<title>Página &lt;VSL&gt;<\/title>/);
  assert.match(output, /<iframe[^>]+src="https:\/\/studio\.example\.test\/embed\/v\/public-vsl-123456"/);
  assert.match(output, /window\.pageReady/);
  assert.doesNotMatch(output, /data-alva-vsl/);
});

test('endereços de botão permitem contatos e links de seção sem executar código', () => {
  for (const url of [
    'https://example.com/path?q=1',
    'http://example.com',
    '#contato',
    '/contato',
    './obrigado.html',
    'mailto:oi@example.com',
    'tel:+5511999999999',
  ]) {
    assert.equal(safeDestination(url), url);
  }
  for (const url of [
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,hello',
    '//example.com',
    'https://example.com/a b',
  ]) {
    assert.throws(() => safeDestination(url));
  }
});

test('imagem local aceita apenas dados raster e não conteúdo executável', () => {
  assert.equal(safeDestination('data:image/png;base64,aGVsbG8=', true), 'data:image/png;base64,aGVsbG8=');
  for (const url of [
    'data:image/svg+xml;base64,aGVsbG8=',
    'data:text/html;base64,aGVsbG8=',
    'javascript:alert(1)',
    'mailto:oi@example.com',
  ]) {
    assert.throws(() => safeDestination(url, true));
  }
});

test('nomes visíveis dos componentes usam linguagem de edição', () => {
  const component = (tag) => ({ get: () => tag, is: () => false });
  assert.equal(componentLabel(component('h1')), 'Título');
  assert.equal(componentLabel(component('input')), 'Campo');
  assert.equal(componentLabel(component('section')), 'Seção');
  assert.equal(componentLabel(component('div')), 'Grupo de elementos');
  assert.equal(componentLabel({ get: (key) => key === 'type' ? 'vsl' : 'div', is: () => false }), 'VSL');
  assert.equal(componentLabel({ is: () => true, get: () => 'body' }), 'Página');
});

test('rótulos editoriais nunca expõem tags técnicas na seleção ou no inspetor', () => {
  const component = (tag, children = []) => ({
    get: (key) => key === 'tagName' ? tag : undefined,
    is: () => false,
    components: () => ({ models: children }),
    parent: () => null,
  });

  assert.equal(editorialLabel(component('div')), 'Bloco de conteúdo');
  assert.equal(editorialLabel(component('span')), 'Elemento');
  assert.equal(editorialLabel(component('section')), 'Seção');
  assert.equal(editorialLabel(component('div', [component('h1')])), 'Bloco de conteúdo');
  assert.equal(editorialElementLabel(component('summary')), 'Pergunta');
});

test('a seleção distingue catálogo contextual de edição de elemento', () => {
  assert.equal(panelMode(null), 'library');
  assert.equal(panelMode({ is: (type) => type === 'wrapper' }), 'library');
  assert.equal(panelMode({ is: () => false }), 'inspector');
});

test('árvore de componentes preserva a ordem, níveis e uma única seleção', () => {
  const component = (cid, tagName, children = [], wrapper = false) => ({
    cid,
    get: (key) => (key === 'tagName' ? tagName : undefined),
    components: () => children,
    is: (type) => wrapper && type === 'wrapper',
  });
  const heading = component('heading', 'h1');
  const button = component('button', 'button');
  const section = component('section', 'section', [heading, button]);
  const footer = component('footer', 'footer');
  const wrapper = component('wrapper', 'body', [section, footer], true);

  assert.deepEqual(componentTreeNodes(wrapper, button), [
    { id: 'section', label: 'Seção', level: 1, selected: false },
    { id: 'heading', label: 'Título', level: 2, selected: false },
    { id: 'button', label: 'Botão', level: 2, selected: true },
    { id: 'footer', label: 'Rodapé', level: 1, selected: false },
  ]);
});

test('teclado da árvore percorre itens visíveis sem acionar exclusão', () => {
  const ids = ['section', 'heading', 'button'];

  assert.equal(treeKeyAction({ key: 'ArrowDown' }, ids, 'heading'), 'button');
  assert.equal(treeKeyAction({ key: 'ArrowDown' }, ids, 'button'), 'button');
  assert.equal(treeKeyAction({ key: 'ArrowUp' }, ids, 'section'), 'section');
  assert.equal(treeKeyAction({ key: 'Home' }, ids, 'button'), 'section');
  assert.equal(treeKeyAction({ key: 'End' }, ids, 'section'), 'button');
  assert.equal(treeKeyAction({ key: 'Delete' }, ids, 'button'), null);
  assert.equal(treeKeyAction({ key: 'Backspace' }, ids, 'button'), null);
});

test('binding de ativação nativa restaura o foco após click, Enter e Espaço', () => {
  const activate = (name, event, active) => {
    let focused = false;
    const item = { dataset: { treeId: 'button' } };
    const replacement = {
      dataset: { treeId: 'button' },
      focus() {
        focused = true;
      },
    };
    bindTreeItemActivation(
      item,
      (activeItem) => restoreTreeFocus([replacement], 'button', activeItem),
      () => (active ? item : null),
    );

    item.onclick(event);
    assert.equal(focused, active, name);
  };

  activate('clique nativo', { type: 'click', detail: 0 }, true);
  activate('Enter', { type: 'click', detail: 0 }, true);
  activate('Espaço', { type: 'click', detail: 0 }, true);
  activate('ponteiro sem foco', { type: 'click', detail: 1 }, false);
});

test('landing declara árvore acessível, regiões persistentes e abas móveis', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /role="tree"/);
  assert.match(source, /setAttribute\('role', 'treeitem'\)/);
  assert.match(source, /aria-level/);
  assert.match(source, /aria-selected/);
  assert.match(source, /data-editor-panel="structure"/);
  assert.match(source, /data-editor-panel="canvas"/);
  assert.match(source, /data-editor-panel="inspector"/);
  assert.match(source, /workspaceState/);
  assert.match(source, /workspaceKeyAction/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-labelledby=/);
  assert.match(source, /panel\.hidden\s*=/);
  assert.match(source, /panel\.inert\s*=/);
  assert.doesNotMatch(source, /fe-breadcrumb/);
  assert.ok(css.includes('grid-template-columns: 270px minmax(480px, 1fr) 320px'));
  assert.match(css, /\.fe-canvas-bar\s*\{[\s\S]*background:\s*var\(--alva-white\)/);
  assert.match(css, /\.editor-workspace-tabs/);
  assert.match(css, /\[data-editor-panel\]\[hidden\]/);
});

test('ações compactas preservam nomes acessíveis e ícones', () => {
  for (const action of ['undo', 'redo', 'moveUp', 'moveDown', 'selectParent', 'duplicate', 'delete']) {
    assert.match(editorActionMeta[action].label, /\S/);
    assert.match(editorActionMeta[action].icon, /^<svg/);
    assert.match(editorActionMeta[action].icon, /aria-hidden="true"/);
  }
});

test('blocos usam ícones da fonte do editor, um distinto por bloco', async () => {
  // caracteres soltos como ▤ e ▥ dependiam da fonte do sistema e se repetiam entre blocos
  assert.deepEqual(
    Object.fromEntries(
      ['section', 'columns', 'heading', 'text', 'image', 'button', 'form', 'input'].map((id) => [id, blockIcons[id]]),
    ),
    { section: 'view_day', columns: 'view_column_2', heading: 'title', text: 'notes', image: 'image', button: 'smart_button', form: 'list_alt', input: 'text_fields' },
  );
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /fe-block-icon material-symbols-outlined/);
});

test('landing pages oferecem ícones, gráficos e movimento por elemento', async () => {
  assert.equal(blockIcons.icon, 'star');
  const source = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(source, /Movimento/);
  assert.match(source, /data-alva-motion/);
  assert.match(source, /Suave/);
  assert.match(source, /\+ Adicionar barra/);
  assert.match(source, /\+ Adicionar fatia/);
});

test('um filho selecionado resolve o gráfico ancestral, valida dados e persiste a edição GrapesJS', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
  const bars = editor.getWrapper().append({
    tagName: 'div',
    classes: ['alva-chart-bars'],
    components: [{ tagName: 'div', components: [{ tagName: 'i' }, { tagName: 'small', components: [{ type: 'textnode', content: 'Visitas' }] }] }],
  })[0];
  const circularFrame = editor.getWrapper().append({
    tagName: 'div',
    classes: ['alva-chart'],
    components: [{
      tagName: 'div',
      classes: ['alva-donut'],
      components: [{ tagName: 'strong', components: [{ type: 'textnode', content: 'Resultados' }] }],
    }],
  })[0];
  const circular = circularFrame.components().at(0);
  const barLabel = bars.components().at(0).components().at(1);
  const circularTitle = circular.components().at(0);
  editor.select(barLabel);
  assert.equal(chartAncestor(editor.getSelected()), bars);
  assert.equal(chartBlockContainer(editor.getSelected()), bars);
  assert.deepEqual(chartInsertionTarget(editor.getSelected(), editor.getWrapper()), { target: editor.getWrapper(), at: 1 });
  assert.equal(editorialLabel(editor.getSelected()), 'Gráfico de barras');
  editor.select(circularTitle);
  assert.equal(chartAncestor(editor.getSelected()), circular);
  assert.equal(chartBlockContainer(editor.getSelected()), circular.parent());
  assert.deepEqual(chartInsertionTarget(editor.getSelected(), editor.getWrapper()), { target: editor.getWrapper(), at: 2 });
  assert.equal(editorialLabel(editor.getSelected()), 'Gráfico circular');
  assert.equal(chartInsertionTarget(editor.getWrapper(), editor.getWrapper()), null);
  assert.equal(chartInsertionTarget(circularFrame.parent(), editor.getWrapper()), null);
  assert.throws(() => chartRows(`Visitas: ${'9'.repeat(400)}\nVendas: 1`), /finito/i);
  assert.throws(() => donutSegments([['Visitas', Infinity], ['Vendas', 1]]), /finito/i);
  const rows = chartRows('Leads: 300\nVendas: 500');
  assert.match(donutSegments(rows), /37\.5%/);
  const renamed = updateChartRow([['Visitas', 52], ['Contatos', 26], ['Vendas', 22]], 0, { name: 'Concluído' });
  const changed = updateChartRow(renamed, 0, { value: 30 });
  assert.deepEqual(changed[0], ['Concluído', 30]);
  assert.deepEqual(removeChartRow(changed, 1), [['Concluído', 30], ['Vendas', 22]]);
  circular.addAttributes({ 'data-alva-chart-data': JSON.stringify(rows) });
  circular.addStyle({ '--alva-chart-segments': donutSegments(rows) });
  circularTitle.components([{ type: 'textnode', content: 'Conversões' }]);
  const snapshot = editor.getProjectData();
  const html = editor.getHtml();
  const css = editor.getCss();
  assert.match(html, /data-alva-chart-data/);
  assert.match(html, /Conversões/);
  assert.match(css, /--alva-chart-segments/);
  assert.match(JSON.stringify(snapshot), /Leads/);
  } finally {
    editor.destroy();
  }
});

test('Escape limpa a seleção e Delete remove o elemento fora de campos editáveis', () => {
  const selected = { is: () => false };
  assert.equal(editorKeyboardAction({ key: 'Escape', target: { tagName: 'BODY' } }, selected), 'clear');
  assert.equal(editorKeyboardAction({ key: 'Delete', target: { tagName: 'BODY' } }, selected), 'delete');
  assert.equal(editorKeyboardAction({ key: 'Backspace', target: { tagName: 'BODY' } }, selected), 'delete');
  assert.equal(editorKeyboardAction({ key: 'Delete', target: { tagName: 'INPUT' } }, selected), null);
  assert.equal(editorKeyboardAction({ key: 'Backspace', target: { tagName: 'TEXTAREA' } }, selected), null);
  assert.equal(
    editorKeyboardAction({ key: 'Delete', target: { tagName: 'DIV', isContentEditable: true } }, selected),
    null,
  );
  assert.equal(editorKeyboardAction({ key: 'Delete', target: { tagName: 'BODY' } }, { is: () => true }), null);
});

test('painel de edição oferece retorno explícito aos elementos', async () => {
  const source = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(source, /fe-back-library/);
  assert.match(source, /Adicionar elementos/);
});

test('clicar fora da página fecha a edição; clicar numa seção abre a dela', () => {
  const element = (tagName) => ({ tagName });
  assert.equal(isCanvasBackgroundElement(element('HTML')), true);
  assert.equal(isCanvasBackgroundElement(element('BODY')), true);
  // Seção e main são conteúdo, não moldura: as páginas são feitas de <section>, e
  // tratá-las como fundo limpava a seleção a cada clique. O painel voltava para
  // "Selecione um elemento" e nenhuma propriedade — cor, espaço, tamanho — abria.
  assert.equal(isCanvasBackgroundElement(element('SECTION')), false);
  assert.equal(isCanvasBackgroundElement(element('MAIN')), false);
  assert.equal(isCanvasBackgroundElement(element('DIV')), false);
  assert.equal(isCanvasBackgroundElement(element('BUTTON')), false);
  assert.equal(isCanvasBackgroundElement(null), false);
});

test('layout móvel alterna painéis sem largura mínima forçada', async () => {
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  const mobile = css.match(/@media \(max-width: 740px\) \{([\s\S]+)\}\s*$/)?.[1] || '';
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobile, /grid-template-rows:/);
  assert.match(mobile, /\.editor-workspace-tabs\s*\{[\s\S]*display:\s*flex/);
  assert.match(mobile, /\[data-editor-panel\]\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(mobile, /\.fe-element-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*height:\s*calc\(100dvh - 112px\)/);
});
