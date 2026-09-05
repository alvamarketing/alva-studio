import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  safeDestination,
  componentLabel,
  panelMode,
  editorActionMeta,
  isCanvasBackgroundElement,
  blockIcons,
  editorKeyboardAction,
  componentTreeNodes,
  treeKeyAction,
  restoreTreeFocus,
  bindTreeItemActivation,
} from '../public/editor-shell.js';

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
  assert.equal(componentLabel({ is: () => true, get: () => 'body' }), 'Página');
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
  assert.ok(css.includes('grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 340px)'));
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

test('blocos usam os símbolos visuais anteriores na cor da interface', async () => {
  assert.deepEqual(
    Object.fromEntries(
      ['section', 'columns', 'heading', 'text', 'image', 'button', 'form', 'input'].map((id) => [id, blockIcons[id]]),
    ),
    { section: '▤', columns: '▥', heading: 'T', text: '≡', image: '▧', button: '↗', form: '☷', input: '▱' },
  );
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.fe-block-icon\s*\{[^}]*font-size:\s*25px/s);
});

test('landing pages oferecem ícones, gráficos e movimento por elemento', async () => {
  assert.equal(blockIcons.icon, '★');
  assert.equal(blockIcons['bar-chart'], '▥');
  assert.equal(blockIcons['donut-chart'], '◉');
  const source = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(source, /Movimento/);
  assert.match(source, /data-alva-motion/);
  assert.match(source, /Subir suavemente/);
  assert.match(source, /Dados do gráfico/);
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

test('somente o fundo estrutural do canvas fecha a edição', () => {
  const element = (tagName) => ({ tagName });
  assert.equal(isCanvasBackgroundElement(element('BODY')), true);
  assert.equal(isCanvasBackgroundElement(element('MAIN')), true);
  assert.equal(isCanvasBackgroundElement(element('SECTION')), true);
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
