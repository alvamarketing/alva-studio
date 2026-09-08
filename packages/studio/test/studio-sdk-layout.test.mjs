import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDoEditor, studioEditorOptions } from '../public/studio-sdk-editor.js';

// Quase tudo aqui é página única, então o gerenciador de páginas não precisa da coluna
// inteira. As camadas, que a pessoa usa o tempo todo, ficam com o espaço que sobra.

const achar = (no, tipo) => {
  if (no?.type === tipo) return no;
  for (const filho of no?.children || []) {
    const achado = achar(filho, tipo);
    if (achado) return achado;
  }
  return null;
};

test('o layout traz a estrutura, o canvas e os ajustes', () => {
  const layout = layoutDoEditor();
  for (const tipo of ['panelPagesLayers', 'canvas', 'panelSidebarTabs'])
    assert.ok(achar(layout, tipo), `painel ausente: ${tipo}`);
});

test('o cabeçalho do painel está em português', () => {
  // o cabeçalho vem do layout, não do dicionário: sem isto fica "Layers" em inglês
  assert.equal(achar(layoutDoEditor(), 'panelPagesLayers').header.label, 'Estrutura da página');
});

test('o layout entra na configuração do editor', () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  assert.ok(opcoes.layout?.default);
  assert.equal(opcoes.layout.default.type, 'row');
});
