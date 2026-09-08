import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toggleTreeSection, isTreeSectionOpen } from '../public/editor-shell.js';

test('cada seção recolhe e expande por conta própria', () => {
  let estado = new Set();
  assert.equal(isTreeSectionOpen(estado, 'abertura'), true, 'seções começam abertas');
  estado = toggleTreeSection(estado, 'abertura');
  assert.equal(isTreeSectionOpen(estado, 'abertura'), false);
  assert.equal(isTreeSectionOpen(estado, 'beneficios'), true, 'recolher uma não mexe na outra');
  estado = toggleTreeSection(estado, 'abertura');
  assert.equal(isTreeSectionOpen(estado, 'abertura'), true);
});

test('o estado de recolhido não se perde entre seções diferentes', () => {
  let estado = new Set();
  estado = toggleTreeSection(estado, 'a');
  estado = toggleTreeSection(estado, 'b');
  assert.equal(isTreeSectionOpen(estado, 'a'), false);
  assert.equal(isTreeSectionOpen(estado, 'b'), false);
  assert.equal(isTreeSectionOpen(estado, 'c'), true);
});

test('a seção da árvore traz o botão de recolher', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /fe-tree-toggle/);
  assert.match(fonte, /aria-expanded/);
});
