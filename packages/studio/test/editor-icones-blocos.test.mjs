import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blockIcons } from '../public/editor-shell.js';
import { blocks } from '../public/templates.js';

test('cada bloco tem um ícone de verdade, não um caractere solto', () => {
  for (const [id] of blocks) {
    const icone = blockIcons[id];
    assert.ok(icone, `bloco sem ícone: ${id}`);
    assert.match(icone, /^[a-z0-9_]+$/, `${id} usa "${icone}", que não é nome de ícone`);
  }
});

test('ícones repetidos tornam blocos indistinguíveis', () => {
  const usados = blocks.map(([id]) => blockIcons[id]);
  assert.equal(new Set(usados).size, usados.length, `ícone repetido entre blocos: ${usados.join(' ')}`);
});

test('o card mostra só ícone e nome; a descrição fica no hover', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /fe-block-hint/, 'a descrição sai do card');
  // continua acessível pelo title e pelo aria-label
  assert.match(fonte, /title: blockDescriptions\[id\]/);
});
