import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';

test('a categoria diz que aquilo é uma faixa inteira, montada', () => {
  const prontas = blocks.filter(([id]) => id.endsWith('-section'));
  assert.ok(prontas.length >= 4);
  for (const [, , categoria] of prontas) {
    assert.equal(categoria, 'Faixas prontas');
  }
});

test('a abertura diz o que traz dentro dela', () => {
  const [, rotulo] = blocks.find(([id]) => id === 'hero-section');
  assert.equal(rotulo, 'Abertura com formulário');
  assert.match(blockDescriptions['hero-section'], /t[íi]tulo/i);
  assert.match(blockDescriptions['hero-section'], /formul[áa]rio/i);
});
