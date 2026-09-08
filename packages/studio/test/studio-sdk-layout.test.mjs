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

test('a barra de cima fica, com o que se usa à mão', () => {
  // definir o layout substitui a tela inteira: sem declarar a barra, ela some junto com
  // dispositivos, desfazer e prévia
  const layout = layoutDoEditor();
  assert.ok(achar(layout, 'devices'), 'trocar entre computador, tablet e celular é uso diário');
  const botoes = [];
  const varrer = (no) => { if (no?.type === 'button') botoes.push(no.id); (no?.children || []).forEach(varrer); };
  varrer(layout);
  for (const id of ['undo', 'redo', 'preview']) assert.ok(botoes.includes(id), `faltou ${id}`);
});

test('o que quase nunca se usa vai para o menu, não para a barra', () => {
  const menu = achar(layoutDoEditor(), 'buttonMenu');
  assert.ok(menu, 'sem menu, ou tudo fica na barra ou some');
  const itens = menu.options.map((item) => item.id);
  for (const id of ['code', 'fullscreen', 'clear']) assert.ok(itens.includes(id), `faltou ${id} no menu`);
  assert.ok(menu.options.every((item) => item.label), 'item de menu sem rótulo não diz o que faz');
  assert.equal(typeof menu.onOptionSelect, 'function', 'sem isto o menu abre e não faz nada');
});

test('o cabeçalho do painel está em português', () => {
  // o cabeçalho vem do layout, não do dicionário: sem isto fica "Layers" em inglês
  assert.equal(achar(layoutDoEditor(), 'panelPagesLayers').header.label, 'Estrutura da página');
});

test('o layout entra na configuração do editor', () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  assert.ok(opcoes.layout?.default);
  assert.equal(opcoes.layout.default.type, 'column');
});

test('os ícones da barra existem no conjunto do SDK', () => {
  const botoes = [];
  const varrer = (no) => { if (no?.type === 'button') botoes.push(no); (no?.children || []).forEach(varrer); };
  varrer(layoutDoEditor());
  // 'undo' e 'redo' não existem lá: o botão saía como um quadrado vazio, sem dizer nada
  const conhecidos = ['arrowULeftTop', 'arrowURightTop', 'eye', 'fullscreen', 'codeBraces', 'delete', 'cog', 'dotsVertical'];
  for (const botao of botoes) assert.ok(conhecidos.includes(botao.icon), `ícone inexistente: ${botao.icon}`);
});

test('o seletor de dispositivo não estica pela barra inteira', () => {
  const achar = (no, tipo) => (no?.type === tipo ? no : (no?.children || []).reduce((r, f) => r || achar(f, tipo), null));
  const devices = achar(layoutDoEditor(), 'devices');
  assert.ok(devices.style?.width, 'sem largura, empurra os outros botões para a ponta');
});

test('o menu tem rótulo próprio, e não o da primeira opção', () => {
  const achar = (no, tipo) => (no?.type === tipo ? no : (no?.children || []).reduce((r, f) => r || achar(f, tipo), null));
  const menu = achar(layoutDoEditor(), 'buttonMenu');
  // sem label, o componente usa a primeira opção como rótulo e o botão vira "Ver o
  // código"; devolvendo um ícone pelo label, o size é ignorado e ele sai gigante
  assert.equal(typeof menu.label, 'string');
  assert.ok(menu.label.length && menu.label.length <= 12, 'rótulo curto cabe na barra');
});
