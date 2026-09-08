import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aparenciaPlugin, setorPrioritario, idDoSetor, NOMES_DE_SETOR } from '../public/studio-sdk-editor.js';

// As categorias de estilo vêm do código do SDK, não do dicionário: ficavam em inglês e
// todas fechadas. Quem clica num texto quer mexer no texto — então a categoria que
// interessa àquele elemento sobe já aberta, e as outras esperam.

const setorFalso = (id, name) => {
  const dados = { id, name, open: false };
  return { get: (k) => dados[k], set: (k, v) => { dados[k] = v; }, dados };
};

const editorFalso = (setores) => {
  const eventos = {};
  return {
    eventos,
    selecionado: null,
    StyleManager: { getSectors: () => setores },
    getSelected() { return this.selecionado; },
    on: (nome, fn) => { (eventos[nome] ||= []).push(fn); },
    onReady: (fn) => fn(),
    emitir(nome) { for (const fn of eventos[nome] || []) fn(); },
  };
};

test('as categorias de estilo ganham nome em português', () => {
  const setores = [setorFalso('typography', 'Typography'), setorFalso('dimension', 'Size')];
  aparenciaPlugin(editorFalso(setores));
  assert.equal(setores[0].dados.name, NOMES_DE_SETOR.typography);
  assert.equal(setores[0].dados.name, 'Texto');
  assert.equal(setores[1].dados.name, 'Tamanho');
});

test('categoria sem tradução conhecida mantém o nome, em vez de virar vazio', () => {
  const setores = [setorFalso('desconhecido', 'Something New')];
  aparenciaPlugin(editorFalso(setores));
  assert.equal(setores[0].dados.name, 'Something New');
});

test('o que interessa ao elemento clicado é o que abre', () => {
  assert.equal(setorPrioritario('h1'), 'typography');
  assert.equal(setorPrioritario('p'), 'typography');
  assert.equal(setorPrioritario('a'), 'typography');
  assert.equal(setorPrioritario('section'), 'background');
  assert.equal(setorPrioritario('div'), 'background');
  assert.equal(setorPrioritario('img'), 'dimension');
});

test('elemento sem prioridade conhecida não força nada aberto', () => {
  assert.equal(setorPrioritario('table'), null);
  assert.equal(setorPrioritario(''), null);
  assert.equal(setorPrioritario(null), null);
});

test('clicar num título abre a categoria de texto e fecha as outras', () => {
  const setores = [setorFalso('typography', 'Typography'), setorFalso('background', 'Background')];
  const editor = editorFalso(setores);
  aparenciaPlugin(editor);
  editor.selecionado = { get: () => 'h1' };
  editor.emitir('component:selected');
  assert.equal(setores[0].dados.open, true, 'texto abre para quem clicou num título');
  assert.equal(setores[1].dados.open, false);
});

test('clicar numa seção abre o fundo, não a tipografia', () => {
  const setores = [setorFalso('typography', 'Typography'), setorFalso('background', 'Background')];
  const editor = editorFalso(setores);
  aparenciaPlugin(editor);
  editor.selecionado = { get: () => 'section' };
  editor.emitir('component:selected');
  assert.equal(setores[1].dados.open, true);
  assert.equal(setores[0].dados.open, false);
});

test('o prefixo do SDK não impede reconhecer a categoria', () => {
  // no SDK os setores chegam como gs-typography; no GrapesJS puro, typography
  assert.equal(idDoSetor('gs-typography'), 'typography');
  assert.equal(idDoSetor('typography'), 'typography');
  assert.equal(idDoSetor(undefined), '');
});

test('as categorias do SDK, com prefixo, também são traduzidas', () => {
  const setores = [setorFalso('gs-typography', 'Typography'), setorFalso('gs-background', 'Background')];
  aparenciaPlugin(editorFalso(setores));
  assert.equal(setores[0].dados.name, 'Texto');
  assert.equal(setores[1].dados.name, 'Fundo');
});

test('a categoria certa abre mesmo com o prefixo do SDK', () => {
  const setores = [setorFalso('gs-typography', 'Typography'), setorFalso('gs-background', 'Background')];
  const editor = editorFalso(setores);
  aparenciaPlugin(editor);
  editor.selecionado = { get: () => 'h1' };
  editor.emitir('component:selected');
  assert.equal(setores[0].dados.open, true);
  assert.equal(setores[1].dados.open, false);
});
