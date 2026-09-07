import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedQuizCanvas, canvasSnapshot } from '../public/quiz-canvas-seed.js';
import { normalizeCharts } from '../public/templates.js';

test('seed legado converte gráficos e choices para componentes reconhecidos pelo editor', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const { default: grapesjs } = await import('grapesjs');
  const seeded = seedQuizCanvas([
    { id: 'visitas', type: 'chart', title: 'Visitas', chart: { type: 'bar', labels: ['Página', 'Oferta'], values: [72, 48] } },
    { id: 'resultados', type: 'chart', title: 'Resultados', chart: { type: 'donut', labels: ['Visitas', 'Contatos', 'Vendas'], values: [72, 48, 86] } },
    { id: 'perfil', type: 'single_choice', title: 'Perfil', options: ['Agência', 'Consultoria'] },
    { id: 'interesses', type: 'multiple_choice', title: 'Interesses', options: ['Landing', 'Quiz'] },
    { id: 'visual', type: 'image_choice', title: 'Visual', options: [{ label: 'A', imageUrl: '/a.png' }, { label: 'B', imageUrl: '/b.png' }] },
  ]);
  assert.match(seeded.css, /\.alva-chart-bars/);
  assert.match(seeded.css, /\.alva-donut/);
  const editor = grapesjs.init({ headless: true, storageManager: false, components: seeded.html, style: seeded.css });
  try {
    const walk = (model) => [model, ...(model.components?.().models || []).flatMap(walk)];
    const components = () => walk(editor.getWrapper());
    const withClass = (name) => components().filter((model) => (model.get('classes')?.models || []).some((item) => item.get('name') === name));
    const withAttr = (name, value) => components().filter((model) => model.getAttributes()?.[name] === value);
    assert.equal(withClass('alva-chart-bars').length, 1);
    assert.equal(withClass('alva-donut').length, 1);
    assert.equal(withAttr('data-quiz-type', 'single_choice').length, 1);
    assert.equal(withAttr('data-quiz-type', 'multiple_choice').length, 1);
    assert.equal(withAttr('data-quiz-type', 'image_choice').length, 1);
    assert.match(editor.getHtml(), /Página/);
    assert.match(editor.getHtml(), /Oferta/);
    assert.match(editor.getCss(), /--value:72%/);
    assert.match(editor.getCss(), /--value:48%/);
    assert.deepEqual(JSON.parse(withClass('alva-donut')[0].getAttributes()['data-alva-chart-data']), [['Visitas', 72], ['Contatos', 48], ['Vendas', 86]]);
    normalizeCharts(editor);
    const snapshot = canvasSnapshot(editor);
    const reopened = grapesjs.init({ headless: true, storageManager: false });
    try {
      reopened.loadProjectData(snapshot.editorState);
      const reopenedComponents = () => walk(reopened.getWrapper());
      const reopenedClass = (name) => reopenedComponents().filter((model) => (model.get('classes')?.models || []).some((item) => item.get('name') === name));
      assert.equal(reopenedClass('alva-chart-bars').length, 1);
      assert.equal(reopenedClass('alva-donut').length, 1);
      assert.match(reopened.getHtml(), /Página/);
      assert.match(reopened.getHtml(), /Oferta/);
      assert.match(reopened.getCss(), /--value:72%/);
      assert.match(reopened.getCss(), /--value:48%/);
      assert.deepEqual(JSON.parse(reopenedClass('alva-donut')[0].getAttributes()['data-alva-chart-data']), [['Visitas', 72], ['Contatos', 48], ['Vendas', 86]]);
    } finally { reopened.destroy(); }
  } finally { editor.destroy(); Object.assign(globalThis, previous); dom.window.close(); }
});
