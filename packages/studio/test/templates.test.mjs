import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateCss, formCss } from '../public/templates.js';

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


