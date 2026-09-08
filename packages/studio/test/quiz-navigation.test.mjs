import assert from 'node:assert/strict';
import test from 'node:test';
import { nextQuizScreenId, normalizeQuizNavigation, quizVisitedScreenIds } from '../public/quiz-navigation.js';

const screen = (id, elements = []) => ({ id, title: id, elements });
const choice = (id, type, options) => ({ id, type, title: id, options });
const base = () => [screen('intro'), screen('offer')];

test('mantém navegação sequencial e não muta entradas', () => {
  const steps = base(); const before = structuredClone(steps);
  assert.deepEqual(normalizeQuizNavigation(steps), steps);
  assert.equal(nextQuizScreenId(steps, 'intro'), 'offer');
  assert.deepEqual(quizVisitedScreenIds(steps), ['intro', 'offer']);
  assert.deepEqual(steps, before);
});

test('aplica equals para escolha única e image_choice', () => {
  const steps = [screen('q', [choice('kind', 'single_choice', ['A', 'B'])]), screen('a'), screen('b')];
  steps[0].branching = { rules: [{ fieldId: 'kind', operator: 'equals', value: 'B', nextScreenId: 'b' }] };
  assert.equal(nextQuizScreenId(steps, 'q', { kind: 'B' }), 'b');
  const image = [screen('q', [choice('kind', 'image_choice', [{ label: 'A' }, { label: 'B' }])]), screen('b')];
  image[0].branching = { rules: [{ fieldId: 'kind', operator: 'equals', value: 'B', nextScreenId: 'b' }] };
  assert.equal(nextQuizScreenId(image, 'q', { kind: 'B' }), 'b');
});

test('aplica includes, default, complete e primeira regra vencedora', () => {
  const steps = [screen('q', [choice('k', 'multiple_choice', ['A', 'B'])]), screen('middle'), screen('offer'), screen('fallback')];
  steps[0].branching = { rules: [{ fieldId: 'k', operator: 'includes', value: 'B', nextScreenId: 'offer' }, { fieldId: 'k', operator: 'includes', value: 'A', nextScreenId: 'middle' }], defaultNextScreenId: 'fallback' };
  assert.equal(nextQuizScreenId(steps, 'q', { k: ['A', 'B'] }), 'offer');
  assert.equal(nextQuizScreenId(steps, 'q', { k: ['A'] }), 'middle');
  assert.equal(nextQuizScreenId(steps, 'q', { k: [] }), 'fallback');
  steps[0].branching.defaultNextScreenId = '$complete';
  assert.equal(nextQuizScreenId(steps, 'q', { k: [] }), '$complete');
});

test('percorre uma entrada direto para oferta e ignora respostas fora da rota', () => {
  const steps = [screen('entry', [choice('answer', 'single_choice', ['Oferta', 'Outro'])]), screen('other'), screen('offer')];
  steps[0].branching = { rules: [{ fieldId: 'answer', operator: 'equals', value: 'Oferta', nextScreenId: 'offer' }] };
  assert.deepEqual(quizVisitedScreenIds(steps, { answer: 'Oferta', unknown: 'offer' }), ['entry', 'offer']);
});

test('recusa alvo ausente, loop, operador incompatível, campo e valor desconhecidos', () => {
  const invalid = (branching, elements = [choice('k', 'single_choice', ['A'])]) => assert.throws(() => normalizeQuizNavigation([screen('q', elements), screen('next')].map((step, index) => index ? step : { ...step, branching })), /Navegação do quiz inválida/);
  invalid({ rules: [{ fieldId: 'k', operator: 'equals', value: 'A', nextScreenId: 'missing' }] });
  invalid({ rules: [{ fieldId: 'k', operator: 'equals', value: 'A', nextScreenId: 'q' }] });
  invalid({ rules: [{ fieldId: 'k', operator: 'includes', value: 'A', nextScreenId: 'next' }] });
  invalid({ rules: [{ fieldId: 'missing', operator: 'equals', value: 'A', nextScreenId: 'next' }] });
  invalid({ rules: [{ fieldId: 'k', operator: 'equals', value: 'Z', nextScreenId: 'next' }] });
});

test('recusa IDs numéricos, com espaço e reservados; currentId desconhecido lança', () => {
  for (const id of [123, 'with space', '$complete', '__proto__', 'constructor', 'prototype']) {
    assert.throws(() => normalizeQuizNavigation([screen(id), screen('next')]), /ID de etapa inválido/);
  }
  assert.throws(() => nextQuizScreenId(base(), 'missing'), /currentId desconhecido/);
});

test('não considera resposta herdada do prototype', () => {
  const steps = [screen('q', [choice('kind', 'single_choice', ['A'])]), screen('next'), screen('fallback')];
  steps[0].branching = { rules: [{ fieldId: 'kind', operator: 'equals', value: 'A', nextScreenId: 'next' }], defaultNextScreenId: 'fallback' };
  const answers = Object.create({ kind: 'A' });
  assert.equal(nextQuizScreenId(steps, 'q', answers), 'fallback');
});

test('limita regras e caminhos visitados com fail closed', () => {
  const tooMany = Array.from({ length: 21 }, () => ({ fieldId: 'k', operator: 'equals', value: 'A', nextScreenId: 'next' }));
  assert.throws(() => normalizeQuizNavigation([screen('q', [choice('k', 'single_choice', ['A'])]), screen('next')].map((step, index) => index ? step : { ...step, branching: { rules: tooMany } })), /20 regras/);
  const steps = Array.from({ length: 50 }, (_, index) => screen(`s${index}`));
  assert.equal(quizVisitedScreenIds(steps).length, 50);
});
