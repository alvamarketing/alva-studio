import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { blocks, normalizeForms, templateCss } from '../public/templates.js';
import { createVslComponentType, setComponentText } from '../public/editor-shell.js';

const catalog = new Map(blocks.map(([id, label, category, content]) => [id, { label, category, content }]));
const componentChildren = (model) => model?.components?.().models || [];
const findFirst = (model, predicate) => {
  for (const child of componentChildren(model)) {
    if (predicate(child)) return child;
    const nested = findFirst(child, predicate);
    if (nested) return nested;
  }
};
const tagOf = (model) => String(model?.get?.('tagName') || '').toLowerCase();
const appendCatalogBlock = (editor, id) => {
  const block = catalog.get(id);
  assert.ok(block, `catálogo inclui ${id}`);
  const added = editor.getWrapper().append(block.content);
  return Array.isArray(added) ? added[0] : added;
};

test('catálogo Landing preserva blocos, edição, histórico e reabertura GrapesJS', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  const ids = [
    'section', 'columns', 'heading', 'text', 'button', 'icon', 'image', 'form', 'input',
    'hero-section', 'benefits-section', 'testimonials-section', 'faq-section', 'contact-section',
  ];
  try {
    editor.DomComponents.addType('vsl', createVslComponentType());
    editor.DomComponents.addType('alva-field', {
      isComponent: (element) => element.tagName === 'INPUT',
      model: { defaults: { tagName: 'input', void: true, droppable: false, traits: [] } },
    });
    editor.setStyle(templateCss);
    const inserted = new Map(ids.map((id) => [id, appendCatalogBlock(editor, id)]));
    assert.equal(inserted.size, ids.length);
    assert.equal(normalizeForms(editor), 3);
    const formLabels = componentChildren(inserted.get('form')).filter((model) => tagOf(model) === 'label');
    assert.deepEqual(formLabels.map((label) => label.components().at(0).get('content')), ['Seu nome', 'E-mail', 'WhatsApp']);
    const nameInput = componentChildren(formLabels[0]).find((model) => tagOf(model) === 'input');
    formLabels[0].components().at(0).set('content', 'Nome completo');
    assert.equal(nameInput.getAttributes().name, 'nome');
    const customLabels = editor.getWrapper().append('<form><label>Nome completo<input name="nome_custom"></label><label><span>Empresa</span><input name="empresa"></label><label><input name="vazio"></label></form>')[0];
    assert.equal(normalizeForms(editor), 4);
    assert.match(editor.getHtml(), /<label>Nome completo<input name="nome_custom"/);
    assert.match(editor.getHtml(), /<label><span>Empresa<\/span><input name="empresa"/);
    assert.match(editor.getHtml(), /<label><input name="vazio"/);
    assert.equal(customLabels.components().at(0).components().at(0).get('content'), 'Nome completo');

    const heading = findFirst(inserted.get('heading'), (model) => /^h[1-6]$/.test(tagOf(model))) || inserted.get('heading');
    heading.components('Título editado no catálogo');
    heading.addAttributes({ 'data-catalog-edit': 'heading' });
    heading.addStyle({ color: '#286eea' });
    const faqQuestion = findFirst(inserted.get('faq-section'), (model) => tagOf(model) === 'summary');
    setComponentText(faqQuestion, 'Como funciona?');
    assert.equal(tagOf(faqQuestion.parent()), 'details');
    const button = inserted.get('button');
    button.addAttributes({ href: '#contato' });
    const icon = inserted.get('icon');
    assert.ok(icon.getClasses().includes('material-symbols-outlined'));
    assert.equal(icon.components().at(0).get('content'), 'star');

    const wrapper = editor.getWrapper();
    const beforeClone = componentChildren(wrapper).length;
    editor.UndoManager.clear();
    const clone = button.clone();
    wrapper.append(clone, { at: button.index() + 1 });
    assert.equal(componentChildren(wrapper).length, beforeClone + 1);
    editor.UndoManager.undo();
    assert.equal(componentChildren(wrapper).length, beforeClone);
    editor.UndoManager.redo();
    assert.equal(componentChildren(wrapper).length, beforeClone + 1);
    editor.UndoManager.clear();
    const persistedClone = componentChildren(wrapper).find((candidate) => candidate !== button && tagOf(candidate) === 'a');
    persistedClone.remove();
    assert.equal(componentChildren(wrapper).length, beforeClone);
    editor.UndoManager.undo();
    assert.equal(componentChildren(wrapper).length, beforeClone + 1);
    editor.UndoManager.redo();
    assert.equal(componentChildren(wrapper).length, beforeClone);
    const formForHistory = inserted.get('form');
    editor.UndoManager.clear(); formForHistory.remove(); editor.UndoManager.undo();
    assert.equal(editor.UndoManager.hasRedo(), true);
    normalizeForms(editor);
    assert.equal(editor.UndoManager.hasRedo(), true);
    editor.UndoManager.redo();
    assert.equal(componentChildren(wrapper).includes(formForHistory), false);

    const legacy = wrapper.append({ type: 'alva-field', attributes: { id: 'legacy-field', name: 'legado', type: 'text' } })[0];
    assert.equal(tagOf(legacy), 'input');
    const snapshot = editor.getProjectData();
    const html = editor.getHtml();
    const css = editor.getCss();
    assert.match(html, /Título editado no catálogo/);
    assert.match(html, /material-symbols-outlined/);
    assert.match(html, /data-catalog-edit="heading"/);
    assert.match(html, /alva-form/);
    assert.match(html, /Como funciona\?/);
    assert.match(css, /\.hero-grid/);

    const reopened = grapesjs.init({ headless: true, storageManager: false });
    reopened.DomComponents.addType('vsl', createVslComponentType());
    reopened.DomComponents.addType('alva-field', {
      isComponent: (element) => element.tagName === 'INPUT',
      model: { defaults: { tagName: 'input', void: true, droppable: false, traits: [] } },
    });
    try {
      reopened.loadProjectData(snapshot);
      const reopenedHtml = reopened.getHtml();
      const reopenedCss = reopened.getCss();
      assert.match(reopenedHtml, /Título editado no catálogo/);
      assert.match(reopenedHtml, /data-catalog-edit="heading"/);
      assert.match(reopenedHtml, /material-symbols-outlined/);
      assert.match(reopenedHtml, /alva-form/);
      assert.match(reopenedHtml, /Como funciona\?/);
      assert.match(reopenedCss, /\.hero-grid/);
      const reopenedLegacy = findFirst(reopened.getWrapper(), (model) => model.getAttributes?.().id === 'legacy-field');
      assert.equal(tagOf(reopenedLegacy), 'input');
      const reopenedHeading = findFirst(reopened.getWrapper(), (model) => model.getAttributes?.()['data-catalog-edit'] === 'heading');
      assert.equal(reopenedHeading.getStyle().color, '#286eea');
    } finally { reopened.destroy(); }
  } finally {
    editor.destroy();
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
