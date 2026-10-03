// O fluxo que o Puck lê das zonas do canvas. O Puck 0.23 escolhe onde um bloco entra (ao
// arrastar entre zonas ou da biblioteca) pelo display e pelo flex-direction calculados da
// zona: flex em linha é horizontal, e aí antes/depois vira questão de mouse à esquerda ou à
// direita. Estes testes conferem o que ele vai ler, com as folhas reais do canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { elementosCss } from '../public/catalogo-elementos.js';
import { ZONAS_DO_CANVAS } from '../editor/zonas-do-canvas.js';

const canvas = (miolo, folhas = elementosCss + ZONAS_DO_CANVAS) => {
  const { window } = new JSDOM(`<!doctype html><html><head><style>${folhas}</style></head><body>
    <main class="alva-pagina" data-puck-dropzone="root:itens">
      <section class="alva-secao" data-puck-component="s1"><div class="alva-conteudo" data-puck-dropzone="s1:itens">${miolo}</div></section>
    </main></body></html>`);
  const estilo = (seletor) => window.getComputedStyle(window.document.querySelector(seletor));
  // O JSDOM devolve vazio para propriedade sem regra: vale o valor inicial do CSS.
  const direcao = (seletor) => estilo(seletor).flexDirection || 'row';
  return { estilo, direcao };
};
const bloco = (id, classe = '') => `<div class="alva-bloco${classe}" data-puck-component="${id}"><p class="alva-texto">${id}</p></div>`;

test('sem as folhas do canvas, a zona da seção é lida como horizontal (o defeito)', () => {
  const { estilo, direcao } = canvas(bloco('a') + bloco('b'), elementosCss);
  assert.equal(estilo('.alva-conteudo').display, 'flex');
  assert.equal(direcao('.alva-conteudo'), 'row');
});

test('seção só com blocos na linha inteira é uma pilha: o Puck lê coluna', () => {
  const { estilo } = canvas(bloco('a') + bloco('b'));
  assert.equal(estilo('.alva-conteudo').flexDirection, 'column');
  assert.equal(estilo('.alva-conteudo').flexWrap, 'nowrap');
  assert.equal(estilo('[data-puck-component="a"]').width, '100%');
});

test('seção com bloco de largura parcial continua em linha, para os blocos ficarem lado a lado', () => {
  const { direcao } = canvas(bloco('a', ' alva-l-1-2') + bloco('b', ' alva-l-1-2'));
  assert.equal(direcao('.alva-conteudo'), 'row');
});

test('a página empilha as seções, e nenhuma zona herda a altura toda do canvas', () => {
  const { estilo } = canvas(bloco('a'));
  assert.equal(estilo('.alva-pagina').flexDirection, 'column');
  assert.equal(estilo('.alva-secao').flexGrow, '0');
  assert.equal(estilo('.alva-conteudo').height, 'auto');
});

test('a zona da seção avança sobre o respiro sem mover nada: margem negativa igual ao acréscimo', () => {
  const { estilo } = canvas(bloco('a'));
  assert.equal(estilo('.alva-conteudo').paddingTop, '32px');
  assert.equal(estilo('.alva-conteudo').marginTop, '-32px');
  assert.equal(estilo('.alva-conteudo').paddingBottom, '32px');
  assert.equal(estilo('.alva-conteudo').marginBottom, '-32px');
});

// Os campos do formulário: pilha com todos na linha inteira, lado a lado com metade/terço.
const formulario = (campos) => {
  const { window } = new JSDOM(`<!doctype html><html><head><style>${elementosCss + ZONAS_DO_CANVAS}</style></head><body>
    <form class="alva-form"><div class="alva-form-campos" data-puck-dropzone="f:itens">${campos}</div></form></body></html>`);
  return (seletor) => window.getComputedStyle(window.document.querySelector(seletor));
};
const campo = (id, classe = '') => `<div class="alva-campo${classe}" data-puck-component="${id}"><label class="answer-wrap${classe}">${id}<input></label></div>`;

test('formulário com todos os campos inteiros é uma pilha no canvas', () => {
  const estilo = formulario(campo('a') + campo('b'));
  assert.equal(estilo('.alva-form-campos').flexDirection, 'column');
  assert.equal(estilo('[data-puck-component="a"]').width, '100%');
});

test('campo de metade deixa a zona do formulário em linha, para ficar ao lado do outro', () => {
  const estilo = formulario(campo('a', ' alva-campo-metade') + campo('b', ' alva-campo-metade'));
  assert.equal(estilo('.alva-form-campos').flexDirection || 'row', 'row');
  assert.equal(estilo('.alva-form-campos').flexWrap, 'wrap');
});
