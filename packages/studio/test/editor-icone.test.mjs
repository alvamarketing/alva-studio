import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { templateCss } from '../public/templates.js';

test('o ícone tem tamanho próprio e não é encolhido pelo contexto', () => {
  // .cards article > span { font-size: 12px } vinha por cima e deixava o ícone em 16px
  assert.match(templateCss, /\.material-symbols-outlined\{[^}]*font-size:var\(--alva-icon-size,48px\)/);
  assert.match(templateCss, /\.cards article>span\.material-symbols-outlined\{font-size:var\(--alva-icon-size,48px\)\}/);
});

test('o inspetor deixa escolher o tamanho do ícone', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /Tamanho do ícone/);
  assert.match(fonte, /'font-size': `\$\{px\}px`/, 'aplica no componente, não só numa variável');
});
