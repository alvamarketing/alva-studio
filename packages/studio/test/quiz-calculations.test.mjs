import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQuizCalculations, normalizeQuizCalculations } from '../public/quiz-calculations.js';

const schema = (calculations = []) => ({ steps: [{ id: 'q', elements: [{ id: 'n', type: 'number' }, { id: 's', type: 'scale' }, { id: 'text', type: 'short_text' }] }], calculations });
const calc = (id, operation, operands, label = id) => ({ id, label, operation, operands });

test('normaliza legado sem cálculos e preserva inputs', () => {
  const value = schema(); const before = structuredClone(value);
  assert.deepEqual(normalizeQuizCalculations(value), []);
  assert.deepEqual(value, before);
});

test('avalia as quatro operações', () => {
  const value = schema([
    calc('sum', 'add', [{ fieldId: 'n' }, { value: 2 }]), calc('diff', 'subtract', [{ fieldId: 'n' }, { value: 2 }]),
    calc('product', 'multiply', [{ fieldId: 'n' }, { fieldId: 's' }]), calc('quotient', 'divide', [{ fieldId: 'n' }, { fieldId: 's' }]),
  ]);
  assert.deepEqual(evaluateQuizCalculations(value, { n: 8, s: 2 }), { sum: 10, diff: 6, product: 16, quotient: 4 });
});

test('aceita constantes, number e scale; ausente dá null', () => {
  const value = schema([calc('score', 'add', [{ value: 1.5 }, { fieldId: 's' }])]);
  assert.deepEqual(evaluateQuizCalculations(value, { s: '2.5' }), { score: 4 });
  assert.deepEqual(evaluateQuizCalculations(value, {}), { score: null });
});

test('retorna null para zero, overflow e dados inválidos', () => {
  const value = schema([calc('divide', 'divide', [{ fieldId: 'n' }, { value: 0 }]), calc('overflow', 'multiply', [{ fieldId: 'n' }, { value: Number.MAX_VALUE }])]);
  assert.deepEqual(evaluateQuizCalculations(value, { n: 2 }), { divide: null, overflow: null });
  assert.deepEqual(evaluateQuizCalculations(schema([calc('x', 'add', [{ fieldId: 'n' }, { value: 1 }])]), { n: true }), { x: null });
  assert.deepEqual(evaluateQuizCalculations(schema([calc('x', 'add', [{ fieldId: 'n' }, { value: 1 }])]), { n: ['2'] }), { x: null });
});

test('recusa unknown keys, IDs reservados, referências inválidas e encadeamento', () => {
  const expectInvalid = (calculation, input = schema([calculation])) => assert.throws(() => normalizeQuizCalculations(input), /Cálculo do quiz inválido/);
  expectInvalid({ ...calc('x', 'add', [{ fieldId: 'n' }, { value: 1 }]), extra: true });
  for (const id of [123, 'with space', '__proto__', 'constructor', '$complete']) expectInvalid(calc(id, 'add', [{ value: 1 }, { value: 2 }]));
  expectInvalid(calc('x', 'add', [{ fieldId: 'text' }, { value: 1 }]));
  expectInvalid(calc('x', 'add', [{ fieldId: 'missing' }, { value: 1 }]));
  expectInvalid(calc('x', 'add', [{ fieldId: 'n', value: 1 }, { value: 1 }]));
  expectInvalid(calc('x', 'add', [{ value: 1 }, { value: Infinity }]));
  expectInvalid(calc('x', 'add', [{ fieldId: 'n' }, { value: 1 }]), { ...schema(), calculations: [calc('x', 'add', [{ value: 1 }, { value: 2 }]), calc('x', 'add', [{ fieldId: 'x' }, { value: 1 }])] });
});

test('respostas herdadas, NaN e Infinity não são convertidas', () => {
  const value = schema([calc('x', 'add', [{ fieldId: 'n' }, { value: 1 }])]);
  const inherited = Object.create({ n: '3' });
  assert.deepEqual(evaluateQuizCalculations(value, inherited), { x: null });
  assert.deepEqual(evaluateQuizCalculations(value, { n: NaN }), { x: null });
  assert.deepEqual(evaluateQuizCalculations(value, { n: Infinity }), { x: null });
});
