import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import grapesjs from 'grapesjs';
import { bindTreeDragInteraction, editorialElementLabel, editorialTreeEntries, reorderTreeComponent, restoreTreeSelection, scrollTreeComponent, treeDragSourceId, treeDropPosition } from '../public/editor-shell.js';

test('item da árvore rola o componente selecionado no canvas', () => {
  const calls = [];
  const component = { cid: 'target' };
  scrollTreeComponent({ Canvas: { scrollTo: (...args) => calls.push(args) } }, component);
  assert.deepEqual(calls, [[component, { behavior: 'smooth', block: 'nearest' }]]);
});

test('drag da árvore move antes e depois no mesmo parent e passa por canMove', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const parent = editor.getWrapper().append({
    tagName: 'section',
    components: [{ tagName: 'h1' }, { tagName: 'p' }, { tagName: 'button' }],
  })[0];
  const source = parent.components().at(0);
  const target = parent.components().at(1);
  const calls = [];
  const components = {
    canMove: (...args) => {
      calls.push(args);
      return editor.Components.canMove(...args);
    },
  };

  assert.equal(reorderTreeComponent({ source, target, position: 'after', canReorder: true, components }), true);
  assert.deepEqual(parent.components().models.map((model) => model.get('tagName')), ['p', 'h1', 'button']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], parent);
  assert.equal(calls[0][1], source);

  const moved = parent.components().at(2);
  const first = parent.components().at(0);
  assert.equal(reorderTreeComponent({ source: moved, target: first, position: 'before', canReorder: true, components }), true);
  assert.deepEqual(parent.components().models.map((model) => model.get('tagName')), ['button', 'p', 'h1']);
  editor.destroy();
});

test('arrastar leva o elemento para outra seção, que é o motivo de arrastar', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const primeira = editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'h1' }] })[0];
  const segunda = editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'p' }] })[0];
  const titulo = primeira.components().at(0);
  const paragrafo = segunda.components().at(0);

  // exigir o mesmo pai deixava a árvore só reordenando dentro da própria seção:
  // mover conteúdo de uma seção para outra, que é o caso comum, nunca funcionava
  assert.equal(reorderTreeComponent({ source: titulo, target: paragrafo, position: 'after', canReorder: true, components: editor.Components }), true);
  assert.equal(segunda.components().length, 2);
  assert.equal(primeira.components().length, 0);
  editor.destroy();
});

test('arrastar recusa sem permissão e não deixa um elemento cair dentro de si mesmo', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const outer = editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'div' }] })[0];
  const inner = outer.components().at(0);
  assert.equal(reorderTreeComponent({ source: inner, target: inner, position: 'after', canReorder: true, components: editor.Components }), false);
  assert.equal(reorderTreeComponent({ source: outer, target: inner, position: 'after', canReorder: true, components: editor.Components }), false, 'mover o pai para dentro do filho some com os dois');
  assert.equal(reorderTreeComponent({ source: inner, target: outer, position: 'after', canReorder: false, components: editor.Components }), false);
  editor.destroy();
});

test('desfazer e refazer podem restaurar a seleção pela árvore reconstruída', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const parent = editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'h1' }, { tagName: 'p' }, { tagName: 'button' }] })[0];
  const source = parent.components().at(0);
  const replacement = new Map([[source.cid, source]]);
  editor.select(source);
  assert.equal(reorderTreeComponent({ source, target: parent.components().at(1), position: 'after', canReorder: true, components: editor.Components }), true);
  editor.UndoManager.undo();
  assert.equal(restoreTreeSelection(editor, source.cid, replacement), true);
  assert.equal(editor.getSelected(), source);
  editor.UndoManager.redo();
  assert.equal(restoreTreeSelection(editor, source.cid, replacement), true);
  assert.equal(editor.getSelected(), source);
  editor.destroy();
});

test('landing mantém a árvore completa e expõe a affordance de reordenação', async () => {
  const source = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /section\.elements\.slice\(0,\s*8\)/);
  assert.match(source, /bindTreeDragInteraction\(item,\s*\{[\s\S]*canReorder:\s*interactionPolicy\.canReorder/);
  assert.match(source, /fe-tree-drop-before/);
  assert.match(source, /fe-tree-drop-after/);
  assert.match(source, /Canvas\?\.scrollTo/);
});

test('dragover usa a origem local quando o dataTransfer está protegido e vazio', () => {
  assert.equal(treeDragSourceId('source-cid', { getData: () => '' }), 'source-cid');
  assert.equal(treeDragSourceId('', { getData: () => 'fallback-cid' }), 'fallback-cid');
});

test('drag sobre span usa clientY do item para distinguir antes/depois', () => {
  const event = { target: { tagName: 'SPAN' }, offsetY: 0, clientY: 80 };
  assert.equal(treeDropPosition(event, { top: 60, height: 30 }), 'after');
  assert.equal(treeDropPosition({ ...event, clientY: 65 }, { top: 60, height: 30 }), 'before');
});

test('listeners reais movem Logo depois de Menu com dataTransfer protegido e target span', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html><button id="source"><span>Logo</span></button><button id="target"><span>Menu</span></button>');
  const sourceItem = dom.window.document.querySelector('#source');
  const targetItem = dom.window.document.querySelector('#target');
  targetItem.getBoundingClientRect = () => ({ top: 60, height: 30 });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const parent = editor.getWrapper().append({ tagName: 'section', components: [{ tagName: 'h1' }, { tagName: 'p' }, { tagName: 'button' }] })[0];
  const source = parent.components().at(0);
  const target = parent.components().at(1);
  const nodes = new Map([[source.cid, source], [target.cid, target]]);
  const dragState = { sourceId: null };
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, getData: () => '' };
  const bind = (item, id, component) => bindTreeDragInteraction(item, {
    id, component, canReorder: true, dragState,
    getSource: (sourceId) => nodes.get(sourceId),
    canMove: (from, to, position) => editor.Components.canMove(from.parent(), from, to.index() + (position === 'after' ? 1 : 0)).result,
    reorder: (from, to, position) => reorderTreeComponent({ source: from, target: to, position, canReorder: true, components: editor.Components }),
  });
  bind(sourceItem, source.cid, source);
  bind(targetItem, target.cid, target);
  sourceItem.ondragstart({ dataTransfer });
  const dragEvent = { target: targetItem.querySelector('span'), offsetY: 0, clientY: 80, dataTransfer, preventDefault() { this.defaultPrevented = true; } };
  targetItem.ondragover(dragEvent);
  assert.equal(dragEvent.defaultPrevented, true);
  targetItem.ondrop(dragEvent);
  assert.deepEqual(parent.components().models.map((model) => model.get('tagName')), ['p', 'h1', 'button']);
  editor.destroy();
  dom.window.close();
});

test('árvore trata gráficos como um único item atômico', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const bars = editor.getWrapper().append({ tagName: 'div', classes: ['alva-chart-bars'], components: [{ tagName: 'i' }] })[0];
  const donut = editor.getWrapper().append({ tagName: 'div', classes: ['alva-chart'], components: [{ tagName: 'div', classes: ['alva-donut'], components: [{ tagName: 'small' }] }] })[0];
  assert.equal(editorialElementLabel(bars), 'Gráfico de barras');
  assert.equal(editorialElementLabel(donut), 'Gráfico circular');
  editor.destroy();
});

test('árvore trata grupos de escolha do quiz como itens semânticos únicos', () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const section = editor.getWrapper().append({
    tagName: 'section',
    components: [
      { tagName: 'div', attributes: { 'data-quiz-type': 'single_choice' }, components: [{ tagName: 'p', components: [{ type: 'textnode', content: 'Canal' }] }, { tagName: 'label', components: [{ tagName: 'input', attributes: { type: 'radio', name: 'canal' } }] }] },
      { tagName: 'div', attributes: { 'data-quiz-type': 'multiple_choice' }, components: [{ tagName: 'p', components: [{ type: 'textnode', content: 'Interesses' }] }, { tagName: 'label', components: [{ tagName: 'input', attributes: { type: 'checkbox', name: 'interesses' } }] }] },
      { tagName: 'div', attributes: { 'data-quiz-type': 'image_choice' }, components: [{ tagName: 'p', components: [{ type: 'textnode', content: 'Formato' }] }, { tagName: 'label', components: [{ tagName: 'input', attributes: { type: 'radio', name: 'formato' } }] }] },
    ],
  })[0];
  const groups = section.components().models;
  const entries = editorialTreeEntries(editor.getWrapper(), groups[2]);
  const quizEntries = entries.flatMap((entry) => entry.elements).filter((entry) => entry.component.getAttributes?.()['data-quiz-type']);
  assert.deepEqual(quizEntries.map((entry) => entry.label), ['Escolha única', 'Múltipla escolha', 'Escolha visual']);
  assert.deepEqual(quizEntries.map((entry) => entry.component), groups);
  assert.equal(quizEntries.find((entry) => entry.component === groups[2])?.selected, true);
  assert.equal(entries.flatMap((entry) => entry.elements).some((entry) => ['Texto', 'Campo'].includes(entry.label)), false);
  assert.equal(editorialElementLabel(groups[0]), 'Escolha única');
  assert.equal(editorialElementLabel(groups[1]), 'Múltipla escolha');
  assert.equal(editorialElementLabel(groups[2]), 'Escolha visual');
  editor.destroy();
});

test('árvore inclui gráficos irmãos após main com seções internas', async () => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const wrapper = editor.getWrapper();
  wrapper.components([
    {
      tagName: 'main',
      components: [{ tagName: 'section', components: [{ tagName: 'h2', components: [{ type: 'textnode', content: 'Benefícios' }] }] }],
    },
    { tagName: 'div', classes: ['alva-chart', 'alva-chart-bars'], components: [{ tagName: 'i' }] },
    { tagName: 'div', classes: ['alva-chart'], components: [{ tagName: 'div', classes: ['alva-donut'], components: [{ tagName: 'small' }] }] },
    { tagName: 'div', classes: ['alva-chart'], components: [{ tagName: 'div', classes: ['alva-donut'], components: [{ tagName: 'small' }] }] },
  ]);
  const entries = editorialTreeEntries(wrapper, null);
  const labels = entries.flatMap((section) => section.elements.map((element) => element.label));
  assert.ok(entries.some((section) => section.label !== 'Elementos soltos' && section.elements.some((element) => element.label === 'Título')));
  assert.ok(labels.includes('Gráfico de barras'));
  assert.ok(labels.includes('Gráfico circular'));
  assert.equal(entries.find((section) => section.label === 'Elementos soltos')?.elements.length, 3);
  assert.equal(entries.find((section) => section.label === 'Elementos soltos')?.component, null);
  assert.equal(entries.find((section) => section.label === 'Elementos soltos')?.selected, false);
  const source = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(source, /fe-tree-synthetic/);
  editor.destroy();
});

test('restaurar parent após undo trunca redo sem skip e o preserva com skip', () => {
  const run = (childDefinition, useSkip) => {
    const editor = grapesjs.init({ headless: true, storageManager: false });
    try {
      const parent = editor.getWrapper().append({ tagName: 'div', components: [childDefinition] })[0];
      const child = parent.components().at(0);
      editor.select(child);
      editor.UndoManager.clear();
      child.remove();
      editor.select(parent);
      editor.UndoManager.undo();
      assert.equal(editor.UndoManager.hasRedo(), true);
      assert.equal(editor.getSelected(), child);
      const restore = () => restoreTreeSelection(editor, parent.cid, new Map([[parent.cid, parent]]));
      if (useSkip) editor.UndoManager.skip(restore);
      else assert.equal(restore(), true);
      const redoPreserved = editor.UndoManager.hasRedo();
      if (useSkip) {
        assert.equal(redoPreserved, true);
        editor.UndoManager.redo();
        assert.equal(parent.components().models.includes(child), false);
      } else assert.equal(redoPreserved, false);
    } finally { editor.destroy(); }
  };
  for (const child of [
    { tagName: 'button', components: [{ type: 'textnode', content: 'Enviar' }] },
    { tagName: 'form', components: [{ tagName: 'label', components: [{ type: 'textnode', content: 'Nome' }, { tagName: 'input', attributes: { name: 'nome' } }] }] },
  ]) {
    run(child, false);
    run(child, true);
  }
});
