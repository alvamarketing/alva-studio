import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { renderQuizFlowEditor, quizFlowDestinations, validateQuizFlow } from '../public/quiz-flow-editor.js';

const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const schema = () => ({
  elements: [
    { id: 'perfil', title: 'Perfil', type: 'single_choice', options: ['Agência', 'Consultoria'] },
    { id: 'nota', title: 'Nota', type: 'number' },
  ],
  steps: [{ id: 'inicio', title: 'Início', elements: [{ id: 'perfil', title: 'Perfil', type: 'single_choice', options: ['Agência', 'Consultoria'] }] }, { id: 'oferta', title: 'Oferta', elements: [{ id: 'nota', title: 'Nota', type: 'number' }] }, { id: 'fim', title: 'Fim', elements: [] }], calculations: [],
});
async function withDom(run) {
  const { JSDOM } = await import(jsdomPath); const dom = new JSDOM(indexHtml, { url: 'https://studio.test/' });
  const old = { document: globalThis.document }; globalThis.document = dom.window.document;
  try { await run(dom.window.document); } finally { globalThis.document = old.document; dom.window.close(); }
}
const byLabel = (document, label) => [...document.querySelectorAll('label')].find((node) => node.firstElementChild?.textContent === label)?.querySelector('input,select');
const change = (document, label, value, index = 0) => { const inputs = [...document.querySelectorAll('label')].filter((node) => node.firstElementChild?.textContent === label).map((node) => node.querySelector('input,select')); const input = inputs[index]; assert.ok(input, `${label} disponível`); input.value = value; input.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })); };

test('destinos só incluem telas posteriores e conclusão', () => {
  assert.deepEqual(quizFlowDestinations(schema(), 'inicio').map((item) => item.id), ['oferta', 'fim']);
  assert.deepEqual(quizFlowDestinations(schema(), 'fim'), []);
});

test('edita regra e cálculo pelo DOM, preservando contrato sem eval', async () => {
  await withDom((document) => {
    const changes = []; const host = document.createElement('div'); document.body.append(host);
    renderQuizFlowEditor({ container: host, schema: schema(), stepId: 'inicio', onChange: (next) => changes.push(next) });
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Adicionar regra').click();
    change(document, 'Pergunta', 'perfil'); change(document, 'Resposta', 'Agência'); change(document, 'Ir para', 'oferta');
    let current = changes.at(-1); assert.deepEqual(current.steps[0].branching.rules[0], { fieldId: 'perfil', operator: 'equals', value: 'Agência', nextScreenId: 'oferta' });
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Adicionar cálculo').click();
    change(document, 'Nome', 'Pontuação'); change(document, 'Fonte 1', 'field'); assert.deepEqual(changes.at(-1).calculations[0].operands[0], { fieldId: '' }); assert.match(host.textContent, /Resposta 1/); change(document, 'Resposta 1', 'nota'); change(document, 'Valor 2', '10');
    current = changes.at(-1); assert.deepEqual(current.calculations[0].operands, [{ fieldId: 'nota' }, { value: 10 }]);
    assert.equal(JSON.stringify(current).includes('eval'), false);
  });
});

test('mantém referências removidas visíveis e readonly não emite alterações', async () => {
  await withDom((document) => {
    const host = document.createElement('div'); document.body.append(host); const changes = [];
    const value = schema(); value.steps[0].branching = { rules: [{ fieldId: 'apagada', operator: 'equals', value: 'X', nextScreenId: 'sumida' }] };
    renderQuizFlowEditor({ container: host, schema: value, stepId: 'inicio', onChange: (next) => changes.push(next), readOnly: true });
    assert.match(host.textContent, /Pergunta removida \(apagada\)/);
    assert.match(host.textContent, /destino “sumida” não está mais disponível/i);
    assert.ok([...host.querySelectorAll('input,select,button')].every((node) => node.disabled));
    assert.equal(changes.length, 0);
  });
});

test('delegates fallback inválido aos normalizadores reais', () => {
  const value = schema();
  value.steps[0].branching = { rules: [], defaultNextScreenId: 'inicio' };
  assert.match(validateQuizFlow(value)[0], /Navegação do quiz inválida/);
});
