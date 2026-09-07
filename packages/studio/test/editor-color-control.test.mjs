import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { colorToHex, isHexColor } from '../public/editor-shell.js';

test('amostra de cor converte rgb/rgba herdado sem exigir gravação no modelo', () => {
  assert.equal(colorToHex('rgb(40, 110, 234)'), '#286eea');
  assert.equal(colorToHex('rgba(40, 110, 234, 0.5)'), '#286eea');
  assert.equal(colorToHex('#abc'), '#aabbcc');
  assert.equal(colorToHex(''), null);
});

test('campo hexadecimal aceita somente #RRGGBB', () => {
  assert.equal(isHexColor('#286eea'), true);
  assert.equal(isHexColor('#ABCDEF'), true);
  assert.equal(isHexColor('#abc'), false);
  assert.equal(isHexColor('286eea'), false);
  assert.equal(isHexColor('#gggggg'), false);
});

test('controle combinado preserva amostra, hex e acessibilidade sem usar field genérico', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /fe-color-control/);
  assert.match(source, /fe-color-swatch/);
  assert.match(source, /fe-color-hex/);
  assert.match(source, /aria-label.*HEX/);
  assert.match(source, /model\.addStyle\(\{ \[property\]:/);
  assert.match(css, /\.fe-color-control\s*\{/);
  assert.match(css, /\.fe-color-swatch\s*\{/);
  assert.match(css, /\.fe-color-hex\s*\{/);
});
