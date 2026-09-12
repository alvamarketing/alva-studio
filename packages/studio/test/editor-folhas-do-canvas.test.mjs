import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folhasDoCanvas } from '../public/editor-shell.js';
import { templateCss } from '../public/templates.js';
import { elementosCss } from '../public/catalogo-elementos.js';

test('o canvas do quiz recebe a folha dos elementos', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: '' });
  assert.ok(folhas.includes(elementosCss), 'a folha dos elementos entra no quiz');
  assert.ok(folhas.includes(templateCss), 'a folha do modelo entra no quiz');
});

test('a landing também recebe a folha dos elementos', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '' });
  assert.ok(folhas.includes(elementosCss));
  assert.ok(folhas.includes(templateCss));
});

test('uma página que já tem o modelo não recebe o modelo de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '.hero-grid{display:grid}' });
  assert.ok(!folhas.includes(templateCss), 'não reaplica o modelo por cima do trabalho salvo');
});

test('formulários são normalizados nos dois canvases', () => {
  assert.equal(folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).normalizarFormularios, true);
  assert.equal(folhasDoCanvas({ quizCanvas: false, cssExistente: '' }).normalizarFormularios, true);
});

test('uma página que já tem a folha dos elementos não a recebe de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: ':root{--alva-el-accent:#286eea}' });
  assert.ok(!folhas.includes(elementosCss));
});
