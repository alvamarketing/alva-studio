import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alvaStylePlugin, studioEditorOptions } from '../public/studio-sdk-editor.js';

// Os blocos ficam sendo os do GrapesJS: os do Alva nunca funcionaram bem e o catálogo do
// SDK já cobre o que eles cobriam. O que continua nosso é o CSS — as páginas já criadas
// usam essas classes, e sem elas gráfico, formulário e carrossel perdem a forma.

test('o editor novo usa os blocos do GrapesJS, sem catálogo próprio por cima', async () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  assert.equal(opcoes.blocks, undefined, 'blocks.default substituiria o catálogo de fábrica');
  const fonte = await readFile(new URL('../public/studio-sdk-editor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /alvaBlocks/, 'o catálogo próprio sai junto');
});

test('o CSS do Alva continua entrando, senão a página salva perde a forma', () => {
  const aplicados = [];
  alvaStylePlugin({ setStyle: (css) => aplicados.push(css), getCss: () => '', onReady: (fn) => fn() });
  assert.ok(aplicados.some((css) => /alva-chart|alva-form/.test(css)));
});

test('o estilo espera o editor ficar pronto antes de aplicar', () => {
  const ordem = [];
  alvaStylePlugin({ setStyle: () => ordem.push('estilo'), getCss: () => '', onReady: (fn) => { ordem.push('pronto'); fn(); } });
  assert.deepEqual(ordem, ['pronto', 'estilo']);
});
