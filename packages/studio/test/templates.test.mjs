import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templates, getTemplate, services, templateCss, formCss, blocks, normalizeForms } from '../public/templates.js';

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
