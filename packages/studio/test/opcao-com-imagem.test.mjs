import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { aplicarImagemDaOpcao, alvoDaSelecao } from '../public/editor-shell.js';

// O cartão da Escolha visual é uma grade de duas linhas: desenho em cima, texto embaixo.
// `.choice-image img{height:145px}` existe para a imagem ocupar a linha do desenho. Anexar a
// <img> no fim criava uma terceira linha e deixava o ícone no lugar — o cartão quebrava e a
// imagem nunca "trocava" nada.
const marcacao = '<div class="choices image-choices" data-quiz-type="image_choice" data-quiz-question="Nova escolha visual"><p>Nova escolha visual</p>'
  + '<label class="choice choice-image"><input type="radio" name="campo_visual" value="Opção 1" data-quiz-image="" data-quiz-icon="image">'
  + '<span class="choice-visual material-symbols-outlined">image</span><span>Opção 1</span></label></div>';

const comCartao = async (fn) => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    const [bloco] = editor.getWrapper().append(marcacao);
    const cartao = descendentes(bloco).find((f) => tagOf(f) === 'label' && f.getClasses().includes('choice-image'));
    return await fn({ editor, bloco, cartao });
  } finally { editor.destroy(); Object.assign(globalThis, anterior); }
};
const tagOf = (m) => String(m?.get?.('tagName') || '').toLowerCase();
// find() depende do DOM renderizado, que não existe no GrapesJS sem navegador.
const descendentes = (m) => (m?.components?.().models || []).flatMap((f) => [f, ...descendentes(f)]);
const todos = (m, teste) => descendentes(m).filter(teste);
const ehImg = (f) => tagOf(f) === 'img';
const ehDesenho = (f) => f.getClasses?.().includes('choice-visual');
const forma = (cartao) => cartao.components().models.map((f) => tagOf(f) + (f.getClasses().includes('choice-visual') ? '.icone' : ''));
const entrada = (cartao) => todos(cartao, (f) => tagOf(f) === 'input')[0];
const URL_A = 'https://exemplo.com/a.png';
const URL_B = 'https://exemplo.com/b.png';

test('a imagem entra no lugar do desenho, não no fim do cartão', () => comCartao(({ cartao }) => {
  aplicarImagemDaOpcao(cartao, URL_A);
  assert.deepEqual(forma(cartao), ['input', 'img', 'span']);
  assert.equal(todos(cartao, ehImg)[0].getAttributes().src, URL_A);
  assert.equal(entrada(cartao).getAttributes()['data-quiz-image'], URL_A);
}));

test('trocar a imagem de novo troca, não empilha', () => comCartao(({ cartao }) => {
  aplicarImagemDaOpcao(cartao, URL_A);
  aplicarImagemDaOpcao(cartao, URL_B);
  assert.equal(todos(cartao, ehImg).length, 1);
  assert.equal(todos(cartao, ehImg)[0].getAttributes().src, URL_B);
}));

test('apagar o endereço devolve o desenho escolhido', () => comCartao(({ cartao }) => {
  entrada(cartao).addAttributes({ 'data-quiz-icon': 'chat' });
  aplicarImagemDaOpcao(cartao, URL_A);
  aplicarImagemDaOpcao(cartao, '');
  assert.deepEqual(forma(cartao), ['input', 'span.icone', 'span']);
  assert.equal(todos(cartao, ehImg).length, 0);
  assert.equal(todos(cartao, ehDesenho)[0].components().at(0)?.get('content') ?? todos(cartao, ehDesenho)[0].get('content'), 'chat');
  assert.equal(entrada(cartao).getAttributes()['data-quiz-image'], '');
}));

test('clicar no desenho ou na imagem seleciona a Escolha visual, onde estão os controles', () => comCartao(({ bloco, cartao }) => {
  assert.equal(alvoDaSelecao(todos(cartao, ehDesenho)[0]), bloco);
  aplicarImagemDaOpcao(cartao, URL_A);
  assert.equal(alvoDaSelecao(todos(cartao, ehImg)[0]), bloco);
}));

test('o texto da opção continua selecionável para edição direta', () => comCartao(({ cartao }) => {
  const texto = cartao.components().models.at(-1);
  assert.equal(alvoDaSelecao(texto), texto);
}));
