import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { alvoDaSelecao, travarGruposDeEscolha } from '../public/editor-shell.js';

// Relato do Taian em 2026-09-21: "eu clico nele e ele vira aquela seção de campo... se eu
// mexer ele virou um campo normal". Clicar numa opção selecionava o <input> de dentro e o
// painel mostrava "Campo", não "Pergunta e opções"; arrastar levava só a peça para fora
// do grupo, e ela virava um campo solto. A escolha é uma peça só.

const marcacao = '<section><div class="choices" data-quiz-type="single_choice" data-quiz-question="Pergunta"><p>Pergunta</p>'
  + '<label class="choice"><input type="radio" name="p" value="A"><span class="choice-key">1</span><span>Opção A</span></label>'
  + '<label class="choice"><input type="radio" name="p" value="B"><span class="choice-key">2</span><span>Opção B</span></label></div></section>';

function comGrupo(fn) {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents(marcacao);
    const secao = editor.getWrapper().components().at(0);
    const grupo = secao.components().at(0);
    const opcao = grupo.components().at(1);
    const [radio, numero, texto] = opcao.components().models;
    return fn({ editor, grupo, opcao, radio, numero, texto, pergunta: grupo.components().at(0) });
  } finally { editor.destroy(); Object.assign(globalThis, anterior); dom.window.close(); }
}

test('clicar no rádio, na opção ou no número seleciona a escolha inteira', () => comGrupo(({ grupo, opcao, radio, numero }) => {
  assert.equal(alvoDaSelecao(radio), grupo, 'o rádio abre o painel de Campo');
  assert.equal(alvoDaSelecao(opcao), grupo);
  assert.equal(alvoDaSelecao(numero), grupo);
  assert.equal(alvoDaSelecao(grupo), grupo);
}));

test('o texto da opção e da pergunta continuam editáveis no lugar', () => comGrupo(({ texto, pergunta }) => {
  assert.equal(alvoDaSelecao(texto), texto);
  assert.equal(alvoDaSelecao(pergunta), pergunta);
}));

test('arrastar só move a escolha inteira', () => comGrupo(({ editor, grupo, opcao, radio, texto }) => {
  travarGruposDeEscolha(editor.getWrapper());
  assert.notEqual(grupo.get('draggable'), false, 'a escolha inteira precisa continuar arrastável');
  for (const peca of [opcao, radio, texto]) {
    assert.equal(peca.get('draggable'), false, 'uma peça de dentro ainda sai sozinha do grupo');
    assert.equal(peca.get('removable'), false, 'uma peça de dentro ainda some sozinha');
  }
  assert.equal(grupo.get('droppable'), false, 'soltar outro elemento dentro da escolha quebra o grupo');
}));
