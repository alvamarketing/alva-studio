import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { blocks } from '../public/templates.js';
import { sectionInsertionTarget } from '../public/editor-shell.js';

const catalog = new Map(blocks.map(([id, label, category, content]) => [id, { label, category, content }]));
const filhos = (model) => model?.components?.().models || [];
const tagOf = (model) => String(model?.get?.('tagName') || '').toLowerCase();

async function comEditor(callback) {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    await callback(editor);
  } finally {
    editor.destroy();
    Object.assign(globalThis, anterior);
  }
}

test('uma seção nova entra ao lado da atual, nunca dentro dela', async () => {
  await comEditor((editor) => {
    const wrapper = editor.getWrapper();
    const primeira = wrapper.append(catalog.get('section').content)[0];
    const dentro = filhos(primeira)[0];

    // com um elemento de dentro selecionado, a seção nova ainda é irmã
    const alvo = sectionInsertionTarget(dentro, wrapper);
    assert.equal(alvo.target, wrapper, 'a seção entra no corpo da página');
    assert.equal(alvo.at, primeira.index() + 1, 'logo depois da seção onde se estava');
  });
});

test('a seção nova não se aninha nem quando a página já tem seções aninhadas', async () => {
  await comEditor((editor) => {
    const wrapper = editor.getWrapper();
    const externa = wrapper.append('<section class="externa"></section>')[0];
    const interna = externa.append('<section class="interna"></section>')[0];

    const alvo = sectionInsertionTarget(interna, wrapper);
    assert.equal(alvo.target, wrapper, 'sobe até o corpo, não para na primeira seção');
    assert.equal(alvo.at, externa.index() + 1, 'entra depois da seção de mais alto nível');
  });
});

test('excluir uma seção não leva as outras junto', async () => {
  await comEditor((editor) => {
    const wrapper = editor.getWrapper();
    const topo = wrapper.append('<header class="topo"></header>')[0];
    const abertura = wrapper.append(catalog.get('section').content)[0];
    const beneficios = wrapper.append(catalog.get('section').content)[0];

    abertura.remove();
    const restantes = filhos(wrapper);
    assert.ok(restantes.includes(topo), 'o topo continua na página');
    assert.ok(restantes.includes(beneficios), 'as outras seções continuam');
    assert.equal(restantes.length, 2);
  });
});
