import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traducaoDoEditor, studioEditorOptions } from '../public/studio-sdk-editor.js';

// O SDK vem todo em inglês. Quem usa o Alva monta página em português, e "Layers",
// "Traits" ou "Selectors" não dizem nada para quem não é da área.

test('os painéis e ações aparecem em português', () => {
  const t = traducaoDoEditor();
  assert.equal(t.layerManager.layers, 'Camadas');
  assert.equal(t.pageManager.pages, 'Páginas');
  assert.equal(t.blockManager.blocks, 'Elementos');
  assert.equal(t.styleManager.panelLabel, 'Aparência');
  assert.equal(t.traitManager.panelLabel, 'Conteúdo');
});

test('as ações do topo dizem o que fazem, na língua de quem usa', () => {
  const t = traducaoDoEditor();
  assert.equal(t.actions.preview.title, 'Prévia');
  assert.equal(t.actions.undo.title, 'Desfazer');
  assert.equal(t.actions.redo.title, 'Refazer');
  assert.match(t.actions.clearCanvas.content, /tem certeza/i, 'confirmar apagar a página em português');
});

test('as mensagens de painel vazio orientam em vez de só avisar', () => {
  const t = traducaoDoEditor();
  assert.match(t.styleManager.empty, /selecione/i);
  assert.match(t.traitManager.empty, /selecione/i);
});

test('a tradução entra na configuração do editor', () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  // o SDK resolve o idioma pelo dicionário de 'en'; sobrescrever ali troca os rótulos
  // sem depender de um locale que talvez não exista no pacote
  assert.ok(opcoes.i18n?.locales?.en);
  assert.equal(opcoes.i18n.locales.en.layerManager.layers, 'Camadas');
});

test('nenhum rótulo traduzido ficou vazio', () => {
  const percorrer = (objeto, caminho = '') => {
    for (const [chave, valor] of Object.entries(objeto)) {
      if (typeof valor === 'string') assert.ok(valor.trim(), `rótulo vazio em ${caminho}${chave}`);
      else if (valor && typeof valor === 'object') percorrer(valor, `${caminho}${chave}.`);
    }
  };
  percorrer(traducaoDoEditor());
});
