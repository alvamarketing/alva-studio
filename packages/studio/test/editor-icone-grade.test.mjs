import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');

test('escolher ícone é uma grade de miniaturas, não uma lista de nomes', () => {
  assert.match(fonte, /fe-icon-grid/);
  // o desenho do ícone é a informação; o nome técnico não ajuda quem não é técnico
  assert.match(fonte, /material-symbols-outlined"[^>]*>\$\{icone\}/);
});

test('a miniatura escolhida fica marcada e alcançável pelo teclado', () => {
  assert.match(fonte, /aria-pressed/);
  assert.match(css, /\.fe-icon-grid/);
  assert.match(css, /\.fe-icon-option\[aria-pressed='true'\]/);
});
