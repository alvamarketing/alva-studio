import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementosCss, catalogo, elementoPorId } from '../public/catalogo-elementos.js';
import { quizElementCss } from '../public/quiz-elements.js';
import { templateCss } from '../public/templates.js';

test('a folha dos elementos desenha peças, não a página', () => {
  assert.match(elementosCss, /\.choice\{/);
  assert.match(elementosCss, /\.scale\{/);
  assert.match(elementosCss, /\.upload\{/);
  assert.match(elementosCss, /\.answer\{/);
  assert.doesNotMatch(elementosCss, /(^|})body\{/);
  assert.doesNotMatch(elementosCss, /\.shell/);
  assert.doesNotMatch(elementosCss, /@keyframes ambient/);
});

test('a paleta da folha vem de variáveis próprias', () => {
  assert.match(elementosCss, /--alva-el-accent:/);
  assert.doesNotMatch(elementosCss, /var\(--accent\)/);
});

test('os formulários dinâmicos publicados continuam com a folha inteira', () => {
  assert.match(quizElementCss, /\.choice\{/);
  assert.match(quizElementCss, /body\{/);
  assert.match(quizElementCss, /\.funnel-header\{/);
});

const folhaDoSistema = elementosCss + templateCss;

test('todo elemento do catálogo declara identidade completa', () => {
  assert.ok(catalogo.length > 0);
  for (const elemento of catalogo) {
    assert.ok(elemento.id, 'id');
    assert.ok(elemento.nome, `nome de ${elemento.id}`);
    assert.ok(elemento.grupo, `grupo de ${elemento.id}`);
    assert.ok(elemento.seletor, `seletor de ${elemento.id}`);
    assert.equal(typeof elemento.render, 'function', `render de ${elemento.id}`);
    // registro diz onde o elemento mora: 'pagina' entra em blocks (templates.js), 'quiz'
    // entra em quizBlocks (editor-shell.js). Sem essa declaração, um elemento novo podia
    // escapar da prova de catalogo-blocos.test.mjs sem que nada acusasse.
    assert.ok(['pagina', 'quiz'].includes(elemento.registro), `registro de ${elemento.id} precisa ser 'pagina' ou 'quiz', não ${elemento.registro}`);
  }
});

test('o seletor de um elemento é sempre uma classe', () => {
  // Seletor de tag tornaria esta prova inútil: toda folha contém a letra "p".
  // Exigir classe é o que faz o elemento ter um endereço só dele.
  for (const elemento of catalogo) {
    assert.ok(elemento.seletor.startsWith('.'), `${elemento.id} precisa declarar uma classe, não ${elemento.seletor}`);
  }
});

test('nenhum elemento nasce sem regra que o alcance', () => {
  for (const elemento of catalogo) {
    assert.ok(
      folhaDoSistema.includes(`${elemento.seletor}{`) || folhaDoSistema.includes(`${elemento.seletor},`) || folhaDoSistema.includes(`${elemento.seletor} `),
      `${elemento.id} declara o seletor ${elemento.seletor}, que não abre regra em nenhuma folha`,
    );
  }
});

test('o HTML do elemento casa com o seletor que ele declara', () => {
  for (const elemento of catalogo) {
    const classe = elemento.seletor.slice(1);
    assert.match(elemento.render(), new RegExp(`class="[^"]*\\b${classe}\\b`), `${elemento.id} não emite a classe ${classe}`);
  }
});

test('elemento não carrega cor nem tamanho embutidos no HTML', () => {
  for (const elemento of catalogo) {
    assert.doesNotMatch(elemento.render(), /style="[^"]*(color|font-size|background)/i, `${elemento.id} embute estilo no HTML`);
  }
});

test('elementoPorId acha e devolve indefinido para o que não existe', () => {
  assert.equal(elementoPorId('heading')?.nome, 'Título');
  assert.equal(elementoPorId('inexistente'), undefined);
});

test('lista, escala e arquivo nascem com a classe do sistema', () => {
  assert.match(elementoPorId('quiz-select').render(), /class="answer"/);
  assert.match(elementoPorId('quiz-range').render(), /class="scale"/);
  assert.match(elementoPorId('quiz-file').render(), /class="upload"/);
});

test('a escala mostra o valor escolhido', () => {
  const html = elementoPorId('quiz-range').render();
  assert.match(html, /<output/, 'sem output a pessoa move o controle e não sabe onde parou');
});

test('o campo de texto solto encontra regra fora do formulário', () => {
  const html = elementoPorId('input').render();
  assert.match(html, /class="answer-wrap"/);
  assert.match(html, /class="answer"/);
});

test('a área de envio diz o que aceita em português', () => {
  const html = elementoPorId('quiz-file').render();
  assert.doesNotMatch(html, /Choose File/i);
  assert.match(html, /Escolher arquivo|Envie/i);
});
