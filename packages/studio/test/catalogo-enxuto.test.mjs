import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';
import { blockIcons } from '../public/editor-shell.js';

// O editor já traz vídeo, colunas e seções de fábrica, e os gráficos do Alva nunca
// ficaram bons de ver. Manter um catálogo paralelo só criava dois caminhos para a mesma
// coisa — e um deles pior. Fica o que é só nosso.

const REMOVIDOS = [
  'embedded-video', // o editor já tem vídeo
  'bar-chart', 'donut-chart', // feios, e gráfico bom não se resolve com um bloco solto
  'hero-section', 'benefits-section', 'testimonials-section', 'faq-section', 'contact-section', // faixas prontas
];

test('o catálogo não oferece o que o editor já faz melhor', () => {
  const ids = blocks.map(([id]) => id);
  for (const id of REMOVIDOS) assert.ok(!ids.includes(id), `${id} deveria ter saído do catálogo`);
});

test('o que é só do Alva continua', () => {
  const ids = blocks.map(([id]) => id);
  assert.ok(ids.includes('vsl'), 'o VSL é o que não existe em lugar nenhum');
  assert.ok(ids.includes('form'), 'o formulário liga na captação de leads do Studio');
});

test('nenhum bloco removido deixa ícone ou descrição órfãos', () => {
  for (const id of REMOVIDOS) {
    assert.ok(!(id in blockIcons), `ícone órfão: ${id}`);
    assert.ok(!(id in blockDescriptions), `descrição órfã: ${id}`);
  }
});

test('todo bloco que ficou tem ícone e descrição', () => {
  for (const [id] of blocks) {
    assert.ok(blockIcons[id], `sem ícone: ${id}`);
    assert.ok(blockDescriptions[id], `sem descrição: ${id}`);
  }
});
