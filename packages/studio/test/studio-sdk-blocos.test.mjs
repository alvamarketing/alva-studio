import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alvaBlocks, alvaStylePlugin, studioEditorOptions } from '../public/studio-sdk-editor.js';
import { blocks } from '../public/templates.js';

// Os blocos do Alva — seção, gráfico, formulário, faixas prontas — existiam só no editor
// antigo. Sem eles no SDK, quem monta uma página perderia o catálogo inteiro e ficaria
// com os blocos genéricos de fábrica.

const editorFalso = () => {
  const adicionados = [];
  return {
    adicionados,
    BlockManager: { add: (id, config) => adicionados.push({ id, ...config }) },
    Css: { getAll: () => [], addRules: () => {} },
    setStyle: () => {},
    getCss: () => '',
    on: () => {},
    onReady: (fn) => fn(),
  };
};

test('todo bloco do Alva chega ao editor novo', () => {
  const catalogo = alvaBlocks();
  assert.equal(catalogo.length, blocks.length, 'o catálogo não pode encolher na troca de editor');
  for (const [id] of blocks) assert.ok(catalogo.some((b) => b.id === id), `bloco perdido: ${id}`);
});

test('cada bloco leva rótulo, categoria e conteúdo', () => {
  for (const bloco of alvaBlocks()) {
    assert.ok(bloco.label?.length, `bloco sem rótulo: ${bloco.id}`);
    assert.ok(bloco.category, `bloco sem categoria: ${bloco.id}`);
    assert.ok(bloco.content, `bloco sem conteúdo: ${bloco.id}`);
  }
});

test('o rótulo traz o ícone junto do nome, como na biblioteca atual', () => {
  const secao = alvaBlocks().find((b) => b.id === 'section');
  assert.match(secao.media || '', /material-symbols-outlined/, 'sem ícone o bloco vira uma lista de texto');
  assert.match(secao.media || '', /view_day/);
});

test('o editor novo já nasce com os blocos do Alva, no lugar dos de fábrica', () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  // o SDK lê blocks.default na configuração; registrar pelo BlockManager num plugin
  // não chega ao painel dele
  assert.ok(Array.isArray(opcoes.blocks?.default));
  assert.equal(opcoes.blocks.default.length, blocks.length);
});

test('o CSS dos blocos acompanha, senão gráfico e formulário chegam sem forma', () => {
  const editor = editorFalso();
  const aplicados = [];
  editor.setStyle = (css) => aplicados.push(css);
  alvaStylePlugin(editor);
  assert.ok(aplicados.some((css) => /alva-chart|alva-form/.test(css)), 'o estilo dos blocos precisa entrar na página');
});
