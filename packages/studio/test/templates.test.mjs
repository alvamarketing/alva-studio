import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { templates, getTemplate, services, templateCss, formCss, chartCss, chartDonutBackgroundCss, blocks, normalizeForms, syncFormDelivery, normalizeCharts, donutBackgroundFromData } from '../public/templates.js';

test('galeria de modelos mantém prévias proporcionais e seleção acessível', async () => {
  const [css, app] = await Promise.all([
    readFile(new URL('../public/owner.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit, minmax\(210px, 1fr\)\)/);
  assert.match(css, /\.template-choice \.template-thumb[\s\S]*aspect-ratio:\s*16 \/ 10/);
  assert.match(css, /#create-dialog[\s\S]*max-height:\s*90vh[\s\S]*overflow:\s*auto/);
  assert.match(app, /button\.setAttribute\('aria-pressed', String\(template\.id === selected\)\)/);
  assert.match(app, /frame\.title = 'Modelo ' \+ template\.name/);
});

test('catálogo oferece cinco estruturas distintas e uma página em branco', () => {
  assert.equal(templates.length, 6);
  assert.equal(new Set(templates.map((t) => t.id)).size, 6);
  assert.equal(new Set(templates.map((t) => t.html)).size, 6);
  assert.equal(getTemplate('blank').html, '');
  assert.equal(getTemplate('services').html, services);
  for (const template of templates) {
    for (const key of ['id', 'name', 'description', 'category', 'html', 'css'])
      assert.equal(typeof template[key], 'string');
    assert.match(template.css, /--alva-form-base:1/);
    assert.doesNotMatch(template.html + template.css, /(?:src=|url\()['"]?https?:/);
  }
  assert.ok(services.indexOf('<form') < services.indexOf('class="benefits"'));
  assert.ok(
    getTemplate('presentation').html.indexOf('<form') > getTemplate('presentation').html.indexOf('class="benefits"'),
  );
  assert.match(getTemplate('offer').html, /offer-list/);
  assert.match(getTemplate('event').html, /event-agenda/);
  assert.doesNotMatch(getTemplate('thanks').html, /<form/);
});

test('busca usa IDs exatos sem interpretar HTML, protótipos ou seletores', () => {
  for (const id of [
    '<img src=x onerror=alert(1)>',
    'services" onclick="alert(1)',
    '__proto__',
    'constructor',
    '#services',
    null,
    {},
    1,
  ]) {
    assert.equal(getTemplate(id), undefined);
  }
});

test('CSS de formulário funciona sem ancestral de contato e controla todos os campos', () => {
  assert.doesNotMatch(formCss, /\.contact|\.hero-art/);
  for (const field of ['input', 'textarea', 'select', 'label', 'button', 'small'])
    assert.ok(formCss.includes(`.alva-form ${field}`));
  assert.match(formCss, /data-theme="dark"/);
  assert.match(formCss, /data-theme="transparent"/);
  assert.match(formCss, /\.alva-form input\[type="hidden"\]\{display:none\}/);
  assert.doesNotMatch(templateCss, /\.hero-art (?:span|small)\{/);
  assert.match(formCss, /font-size:16px/);
});

function formModel() {
  const attributes = {
    action: '/my-endpoint',
    method: 'post',
    class: 'custom',
    'data-theme': 'dark',
    'data-owner': 'user',
  };
  const fields = [
    { name: 'nome', value: 'Ana', required: true, style: { color: '#f00' } },
    { type: 'hidden', name: 'token', value: 'keep' },
  ];
  const style = { padding: '46px', background: '#ffddaa' };
  return {
    attributes,
    fields,
    style,
    getAttributes: () => ({ ...attributes }),
    addAttributes: (attrs) => Object.assign(attributes, attrs),
    addClass(name) {
      const set = new Set(attributes.class.split(' '));
      set.add(name);
      attributes.class = [...set].join(' ');
    },
  };
}

test('normalização preserva atributos, valores e estilos; injeta CSS só uma vez por projeto', () => {
  const forms = [formModel(), formModel()];
  const originalFields = JSON.stringify(forms.map((f) => f.fields));
  const originalStyle = JSON.stringify(forms.map((f) => f.style));
  let css = '.custom{font-size:18px}';
  let additions = 0;
  const editor = {
    getWrapper: () => ({
      find: (selector) => {
        assert.equal(selector, 'form');
        return forms;
      },
    }),
    getCss: () => css,
    addStyle: (added) => {
      additions++;
      css += added;
    },
  };
  assert.equal(normalizeForms(editor), 2);
  normalizeForms(editor);
  assert.equal(additions, 1);
  for (const form of forms) {
    assert.equal(form.attributes.class, 'custom alva-form');
    assert.equal(form.attributes.action, '/my-endpoint');
    assert.equal(form.attributes['data-theme'], 'dark');
    assert.equal(form.attributes['data-owner'], 'user');
  }
  assert.equal(JSON.stringify(forms.map((f) => f.fields)), originalFields);
  assert.equal(JSON.stringify(forms.map((f) => f.style)), originalStyle);
  assert.ok(css.startsWith('.custom{font-size:18px}'));
  css = ''; // Loading another project must restore its missing base styles.
  normalizeForms(editor);
  assert.equal(additions, 2);
});

test('sincronização de destino não muta formulário já configurado', () => {
  const attrs = { method: 'post', action: '#' }; let mutations = 0;
  const form = { getAttributes: () => ({ ...attrs }), addAttributes: (next) => { mutations += 1; Object.assign(attrs, next); }, removeAttributes: (key) => { mutations += 1; delete attrs[key]; } };
  assert.equal(syncFormDelivery(form, ''), 0); assert.equal(mutations, 0);
  assert.equal(syncFormDelivery(form, 'https://hook.test/form'), 1); assert.equal(attrs.action, 'https://hook.test/form');
});

test('normalização tolera canvas vazio e blocos mantêm contrato de quatro posições', () => {
  assert.equal(normalizeForms(null), 0);
  assert.equal(normalizeForms({ getWrapper: () => ({ find: () => [] }) }), 0);
  assert.equal(new Set(blocks.map((block) => block[0])).size, blocks.length);
  for (const block of blocks) assert.equal(block.length, 4);
  for (const id of [
    'form',
    'hero-section',
    'benefits-section',
    'testimonials-section',
    'faq-section',
    'contact-section',
  ])
    assert.ok(blocks.find((block) => block[0] === id));
  assert.match(blocks.find((block) => block[0] === 'form')[3], /class="alva-form"/);
  assert.match(blocks.find((block) => block[0] === 'testimonials-section')[3], /placeholder/);
  for (const id of ['icon', 'bar-chart', 'donut-chart']) assert.ok(blocks.find((block) => block[0] === id));
  assert.match(templateCss, /data-alva-motion/);
  assert.match(templateCss, /prefers-reduced-motion/);
});

test('normalização de gráficos adiciona somente o CSS ausente sem reescrever estilos da página', () => {
  let css = '.hero-grid{display:grid}.custom{color:purple}';
  const additions = [];
  const editor = {
    getCss: () => css,
    addStyle: (added) => { additions.push(added); css += added; },
  };
  assert.equal(normalizeCharts(editor), true);
  assert.deepEqual(additions, [chartCss + chartDonutBackgroundCss]);
  assert.match(css, /\.custom\{color:purple\}/);
  assert.equal(normalizeCharts(editor), false);
  assert.equal(additions.length, 1);
});

test('normalização de gráficos repara circular sem fundo e preserva fundo personalizado válido', () => {
  let css = '.alva-chart-bars{display:flex}.alva-donut{display:grid}';
  const additions = [];
  const editor = { getCss: () => css, addStyle: (added) => { additions.push(added); css += added; } };
  assert.equal(normalizeCharts(editor), true);
  assert.match(additions[0], /background-image:conic-gradient/);
  css = '.alva-chart-bars{display:flex}.alva-donut{background-image:linear-gradient(red,blue)}';
  assert.equal(normalizeCharts(editor), false);
});

test('normalização real do GrapesJS preserva CSS customizado e repara somente o fallback legado', async () => {
  const { JSDOM } = await import(new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url));
  const dom = new JSDOM('<!doctype html>');
  const previous = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.Node = dom.window.Node;
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setStyle('.alva-donut{background-image:linear-gradient(red,blue);width:310px}');
    const custom = editor.getWrapper().append({ tagName: 'div', classes: ['alva-donut'] })[0];
    const legacy = editor.getWrapper().append({
      tagName: 'div', classes: ['alva-donut'],
      attributes: { 'data-alva-chart-data': '[["A",30],["B",20]]' },
    })[0];
    legacy.addStyle({ background: 'conic-gradient(#286eea, #80d6c2, #ffc76b)' });
    assert.equal(normalizeCharts(editor), true);
    const css = editor.getCss();
    assert.match(css, /background-image:linear-gradient\(red, blue\)/);
    assert.match(css, /width:310px/);
    assert.deepEqual(custom.getStyle(), {});
    assert.match(legacy.getStyle().background, /0% 60%/);
    const saved = JSON.stringify(editor.getProjectData());
    assert.equal(normalizeCharts(editor), false);
    assert.equal(JSON.stringify(editor.getProjectData()), saved);
  } finally {
    editor.destroy();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.DOMParser = previous.DOMParser;
    globalThis.Node = previous.Node;
    dom.window.close();
  }
});

test('fundo circular calcula as proporções do dado salvo sem limitar quantidades', () => {
  assert.match(donutBackgroundFromData(JSON.stringify([['A', 30], ['B', 20]])), /0% 60%/);
  assert.match(donutBackgroundFromData(JSON.stringify([['A', 300], ['B', 200]])), /0% 60%/);
});

test('CSS personalizado do formulário prevalece quando GrapesJS mescla seletores', () => {
  let style = { padding: '71px', color: 'purple' };
  const rule = {
    selectorsToString: () => '.alva-form',
    getStyle: () => style,
    addStyle: (values) => {
      style = { ...style, ...values };
    },
  };
  normalizeForms({
    getWrapper: () => ({ find: () => [formModel()] }),
    getCss: () => '.alva-form{padding:71px;color:purple}',
    Css: { getAll: () => [rule] },
    addStyle: () => {
      style = { padding: '32px', color: '#203a32', display: 'block' };
    },
  });
  assert.deepEqual(style, { padding: '71px', color: 'purple', display: 'block' });
});
