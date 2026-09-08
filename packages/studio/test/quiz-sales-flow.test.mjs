import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFormInput } from '../server/form-store.mjs';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';
import { renderDynamicForm } from '../server/dynamic-form.mjs';
import { evaluateQuizCalculations } from '../public/quiz-calculations.js';

const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);

const salesQuiz = () => ({
  headerElements: [],
  completion: { title: 'Fim', message: 'Obrigado' },
  webhook: '',
  calculations: [{
    id: 'dobro', label: 'Dobro da nota', operation: 'multiply',
    operands: [{ fieldId: 'nota' }, { value: 2 }],
  }],
  steps: [
    {
      id: 'perfil', title: 'Perfil', elements: [{
        id: 'perfil', type: 'single_choice', title: 'Perfil', required: true,
        options: ['A', 'B'],
      }],
      branching: { rules: [{ fieldId: 'perfil', operator: 'equals', value: 'A', nextScreenId: 'nota' }, { fieldId: 'perfil', operator: 'equals', value: 'B', nextScreenId: 'oferta' }] },
    },
    {
      id: 'nota', title: 'Nota', autoAdvance: true, timer: 1,
      elements: [{ id: 'nota', type: 'number', title: 'Nota', required: true }],
    },
    {
      id: 'oferta', title: 'Oferta',
      elements: [{
        id: 'grafico', type: 'chart', title: 'Resultado',
        chart: { type: 'bar', labels: ['Nota', 'Dobro'], values: [0, 0], calculationIds: [null, 'dobro'] },
      }],
    },
  ],
});

const normalizedQuiz = () => normalizeFormInput(salesQuiz());

test('fluxo comercial normaliza três telas, rota e gráfico calculado', () => {
  const form = normalizedQuiz();
  assert.deepEqual(form.steps.map((step) => step.id), ['perfil', 'nota', 'oferta']);
  assert.equal(form.steps[0].branching.rules[0].nextScreenId, 'nota');
  assert.equal(form.steps[0].branching.rules[1].nextScreenId, 'oferta');
  assert.deepEqual(form.steps[2].elements[0].chart.calculationIds, [null, 'dobro']);
  assert.equal(evaluateQuizCalculations(form, { nota: '5' }).dobro, 10);
  assert.equal(evaluateQuizCalculations(form, {}).dobro, null);
});

test('servidor valida somente a rota percorrida e não aceita resposta de tela pulada', () => {
  const form = normalizedQuiz();
  assert.throws(() => validateFormAnswers(form, { answers: { perfil: 'A' } }), /Nota/);
  assert.deepEqual(validateFormAnswers(form, { answers: { perfil: 'A', nota: '5' } }), { perfil: 'A', nota: '5', grafico: '' });
  assert.deepEqual(validateFormAnswers(form, { answers: { perfil: 'B' } }), { perfil: 'B', grafico: '' });
  assert.throws(() => validateFormAnswers(form, { answers: { perfil: 'B', nota: '5' } }), /não visitada/);
  assert.throws(() => validateFormAnswers(form, { answers: { perfil: 'C' } }), /Escolha uma resposta válida/);
});

async function withDom(html, { fetchImpl } = {}, run) {
  const { JSDOM } = await import(jsdomPath);
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'https://studio.test/preview', runScripts: 'dangerously',
    beforeParse(window) {
      window.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`) };
      window.fetch = async (...args) => {
        calls.push(args);
        if (fetchImpl) return fetchImpl(...args);
        return { ok: true, text: async () => '<!doctype html><p>enviado</p>' };
      };
    },
  });
  try { await run(dom, calls); } finally { dom.window.close(); }
}

const activeStep = (document) => document.querySelector('.screen.step:not([hidden])');
const clickChoice = (document, value) => {
  const input = [...document.querySelectorAll('[data-answer]')].find((node) => node.value === value);
  assert.ok(input, `opção ${value} disponível`); input.checked = true; input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
};
const click = (document, selector) => {
  const node = ['.next', '.back'].includes(selector) ? activeStep(document).querySelector(selector) : document.querySelector(selector);
  assert.ok(node, `${selector} disponível`); node.click();
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runtime troca A por B sem carregar nota pulada no envio', async () => {
  const html = renderDynamicForm({ ...normalizedQuiz(), id: 'sales-flow' }, '/submit');
  await withDom(html, {}, async (dom, calls) => {
    const { document } = dom.window;
    clickChoice(document, 'A'); click(document, '.next');
    assert.equal(activeStep(document).dataset.step, '1');
    const nota = document.querySelector('[name="nota"]'); nota.value = '7';
    click(document, '.back'); assert.equal(activeStep(document).dataset.step, '0');
    clickChoice(document, 'B'); click(document, '.next');
    assert.equal(activeStep(document).dataset.step, '2');
    click(document, '.next'); await wait(20);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0][1].body);
    assert.deepEqual(body.answers, { perfil: 'B' });
  });
});

test('preview não faz fetch, preserva voltar e não autoavança tela obrigatória vazia', async () => {
  const html = renderDynamicForm(normalizedQuiz(), '/preview', { preview: true });
  await withDom(html, {}, async (dom, calls) => {
    const { document } = dom.window;
    clickChoice(document, 'A'); click(document, '.next');
    assert.equal(activeStep(document).dataset.step, '1');
    await wait(1100);
    assert.equal(activeStep(document).dataset.step, '1');
    const nota = document.querySelector('[name="nota"]'); nota.value = '4';
    click(document, '.back'); assert.equal(activeStep(document).dataset.step, '0');
    click(document, '.next'); assert.equal(activeStep(document).dataset.step, '1');
    click(document, '.next'); await wait(20);
    assert.equal(calls.length, 0);
    assert.match(document.body.textContent, /Obrigado/);
  });
});

test('preview não conclui com submissão nativa antes da última tela percorrida', async () => {
  const html = renderDynamicForm(normalizedQuiz(), '/preview', { preview: true });
  await withDom(html, {}, async (dom, calls) => {
    const { document } = dom.window;
    clickChoice(document, 'A');
    document.querySelector('form').requestSubmit();
    await wait(20);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(document.body.textContent, /Obrigado/);
    assert.ok(activeStep(document), 'a tela inicial continua visível');
    assert.equal(activeStep(document).dataset.step, '0');
  });
});
