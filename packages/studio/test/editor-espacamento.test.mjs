import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boxSpacingStyle, readBoxSpacing } from '../public/editor-shell.js';

test('o padrão de espaçamento é zero nos quatro lados', () => {
  assert.deepEqual(readBoxSpacing({}, 'padding'), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(readBoxSpacing(null, 'margin'), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('cada lado é lido do estilo do elemento', () => {
  const estilo = { 'padding-top': '10px', 'padding-right': '20px', 'padding-bottom': '30px', 'padding-left': '40px' };
  assert.deepEqual(readBoxSpacing(estilo, 'padding'), { top: 10, right: 20, bottom: 30, left: 40 });
});

test('com a trava ligada, mexer num lado move os quatro', () => {
  assert.deepEqual(boxSpacingStyle('padding', { top: 10, right: 0, bottom: 0, left: 0 }, { lado: 'top', valor: 24, travado: true }), {
    'padding-top': '24px', 'padding-right': '24px', 'padding-bottom': '24px', 'padding-left': '24px',
  });
});

test('com a trava solta, só o lado mexido muda', () => {
  assert.deepEqual(boxSpacingStyle('margin', { top: 5, right: 6, bottom: 7, left: 8 }, { lado: 'bottom', valor: 30, travado: false }), {
    'margin-top': '5px', 'margin-right': '6px', 'margin-bottom': '30px', 'margin-left': '8px',
  });
});

test('valor inválido vira zero, e não NaN no css', () => {
  const estilo = boxSpacingStyle('padding', { top: 0, right: 0, bottom: 0, left: 0 }, { lado: 'top', valor: 'abc', travado: false });
  assert.equal(estilo['padding-top'], '0px');
});

test('o inspetor mostra os quatro lados com a trava', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /fe-box-spacing/);
  assert.match(fonte, /Espaço interno/);
  assert.match(fonte, /Espaço externo/);
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.fe-box-spacing/);
});
