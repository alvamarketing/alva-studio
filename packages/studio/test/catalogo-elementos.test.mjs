import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementosCss } from '../public/catalogo-elementos.js';
import { quizElementCss } from '../public/quiz-elements.js';

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
