import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFormInput } from '../server/form-store.mjs';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';

const quiz = () => ({
  headerElements: [], completion: { title: 'Fim', message: 'Ok' }, webhook: '',
  calculations: [{ id: 'dobro', label: 'Dobro', operation: 'multiply', operands: [{ fieldId: 'nota' }, { value: 2 }] }],
  steps: [
    { id: 'entrada', title: 'Entrada', elements: [{ id: 'perfil', type: 'single_choice', title: 'Perfil', required: true, options: ['Oferta', 'Outro'] }], branching: { rules: [{ fieldId: 'perfil', operator: 'equals', value: 'Oferta', nextScreenId: 'oferta' }] } },
    { id: 'desvio', title: 'Desvio', elements: [{ id: 'nota', type: 'number', title: 'Nota', required: true }] },
    { id: 'oferta', title: 'Oferta', elements: [{ id: 'grafico', type: 'chart', title: 'Resultado', chart: { type: 'bar', labels: ['Manual', 'Dobro'], values: [5, 0], calculationIds: [null, 'dobro'] } }] },
  ],
});

test('normaliza navegação, cálculos e vínculo por item sem alterar legado', () => {
  const normalized = normalizeFormInput(quiz());
  assert.equal(normalized.steps[0].branching.rules[0].nextScreenId, 'oferta');
  assert.deepEqual(normalized.calculations.map((item) => item.id), ['dobro']);
  assert.deepEqual(normalized.steps[2].elements[0].chart.calculationIds, [null, 'dobro']);
  assert.throws(() => normalizeFormInput({ ...quiz(), steps: [...quiz().steps.slice(0, 2), { ...quiz().steps[2], elements: [{ ...quiz().steps[2].elements[0], chart: { ...quiz().steps[2].elements[0].chart, calculationIds: [null, 'ausente'] } }] }] }), /cálculo inexistente/);
});

test('valida somente rota recalculada e rejeita resposta forjada de tela pulada', () => {
  const normalized = normalizeFormInput(quiz());
  assert.deepEqual(validateFormAnswers(normalized, { answers: { perfil: 'Oferta' } }), { perfil: 'Oferta', grafico: '' });
  assert.throws(() => validateFormAnswers(normalized, { answers: { perfil: 'Oferta', nota: '10' } }), /não visitada/);
  assert.throws(() => validateFormAnswers(normalized, { answers: { perfil: 'Falso' } }), /Escolha uma resposta válida/);
});

test('runner público e prévia seguem salto, voltar e poda de rota', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const source = { ...normalizeFormInput(quiz()), id: 'runtime', name: 'Runtime' };
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  for (const preview of [false, true]) {
    const sent = [];
    const dom = new JSDOM(renderDynamicForm(source, '/submit', { preview }), { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) {
      window.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
      window.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, text: async () => '<html></html>' }; };
    } });
    const { document } = dom.window;
    const radio = document.querySelector('input[value="Oferta"]'); radio.checked = true; radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    document.querySelector('.next').click();
    assert.equal(document.querySelector('[data-screen-id="oferta"]').hidden, false, 'salta a etapa intermediária');
    assert.equal(document.querySelectorAll('[data-screen-id="oferta"] .bar-row strong')[1].textContent, '—', 'cálculo de campo pulado fica indisponível, não zero');
    document.querySelector('.back').click();
    assert.equal(document.querySelector('[data-screen-id="entrada"]').hidden, false, 'volta pelo histórico');
    const other = document.querySelector('input[value="Outro"]'); other.checked = true; other.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    document.querySelector('.next').click();
    assert.equal(document.querySelector('[data-screen-id="desvio"]').hidden, false, 'resposta alterada usa rota sequencial');
    if (preview) assert.deepEqual(sent, []);
    dom.window.close();
  }
});


test('rota $complete envia sem expor telas posteriores e timer não ignora obrigatório', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  const source = normalizeFormInput({ ...quiz(), steps: [
    { ...quiz().steps[0], timer: 1, branching: { rules: [], defaultNextScreenId: '$complete' } },
    ...quiz().steps.slice(1),
  ] });
  const requests = [];
  let requested = 0;
  const dom = new JSDOM(renderDynamicForm({ ...source, id: 'complete', name: 'Fim' }, '/submit'), { runScripts: 'dangerously', url: 'https://studio.test/', beforeParse(window) {
    window.CSS = { escape: (value) => String(value) };
    window.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, text: async () => '<!doctype html><html></html>' }; };
  } });
  dom.window.document.querySelector('form').requestSubmit = () => { requested++; };
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.deepEqual(requests, [], 'timer não avança campo obrigatório vazio');
  const option = dom.window.document.querySelector('input[value="Outro"]'); option.checked = true; option.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('.next').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requested, 1);
  assert.deepEqual(requests, []);
  dom.window.close();
});


test('binding de gráfico novo no canvas é validado sem metadata legada', () => {
  const canvas = (binding) => ({ version: 1, css: '', html: `<div data-alva-chart-bindings='${JSON.stringify(binding)}'></div>`, editorState: { components: [{ tagName: 'div', attributes: { 'data-alva-chart-bindings': JSON.stringify(binding) } }] } });
  const base = { headerElements: [], completion: { title: 'Fim', message: 'Ok' }, webhook: '', calculations: [{ id: 'dobro', label: 'Dobro', operation: 'multiply', operands: [{ fieldId: 'nota' }, { value: 2 }] }], steps: [
    { id: 'nota', title: 'Nota', elements: [{ id: 'nota', type: 'number', title: 'Nota' }] },
    { id: 'grafico', title: 'Gráfico', elements: [], canvas: canvas([null, 'dobro']) },
  ] };
  assert.doesNotThrow(() => normalizeFormInput(base));
  assert.throws(() => normalizeFormInput({ ...base, steps: [base.steps[0], { ...base.steps[1], canvas: canvas(['inexistente']) }] }), /cálculo inexistente/);
});

test('runtime atualiza gráficos canônicos de canvas sem quebrar classe ou valores manuais', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  const binding = '[null,"dobro"]';
  const html = `<div class="alva-chart alva-chart-bars" data-alva-chart-bindings='${binding}'><div><i style="--value:5%"></i><small>Manual</small></div><div><i style="--value:0%"></i><small>Calculado</small></div></div><div class="alva-chart" data-alva-chart-bindings='${binding}'><div class="alva-donut" data-alva-chart-data="[[&quot;Manual&quot;,5],[&quot;Calculado&quot;,0]]"><strong>Resultados</strong></div></div>`;
  const state = { components: [{ tagName: 'div', attributes: { class: 'alva-chart alva-chart-bars', 'data-alva-chart-bindings': binding }, components: [{ tagName: 'div', components: [{ tagName: 'i', attributes: { style: '--value:5%' } }, { tagName: 'small', components: [{ type: 'textnode', content: 'Manual' }] }] }, { tagName: 'div', components: [{ tagName: 'i', attributes: { style: '--value:0%' } }, { tagName: 'small', components: [{ type: 'textnode', content: 'Calculado' }] }] }] }, { tagName: 'div', attributes: { class: 'alva-chart', 'data-alva-chart-bindings': binding }, components: [{ tagName: 'div', attributes: { class: 'alva-donut', 'data-alva-chart-data': '[["Manual",5],["Calculado",0]]' }, components: [{ tagName: 'strong', components: [{ type: 'textnode', content: 'Resultados' }] }] }] }] };
  const source = normalizeFormInput({ headerElements: [], completion: { title: 'Fim', message: 'Ok' }, webhook: '', calculations: [{ id: 'dobro', label: 'Dobro', operation: 'multiply', operands: [{ fieldId: 'nota' }, { value: 2 }] }], steps: [{ id: 'nota', title: 'Nota', elements: [{ id: 'nota', type: 'number', title: 'Nota' }] }, { id: 'charts', title: 'Charts', elements: [], canvas: { version: 1, html, css: '', editorState: state } }] });
  const dom = new JSDOM(renderDynamicForm({ ...source, id: 'chart', name: 'Chart' }, '/submit'), { runScripts: 'dangerously', url: 'https://studio.test/', beforeParse(window) { window.CSS = { escape: (value) => String(value) }; } });
  const input = dom.window.document.querySelector('input[name="nota"]'); input.value = '10'; dom.window.document.querySelector('.next').click();
  const bars = dom.window.document.querySelector('.alva-chart-bars');
  assert.match(bars.className, /alva-chart-bars/);
  assert.equal(bars.querySelectorAll('i')[1].style.getPropertyValue('--value'), '20%');
  assert.equal(bars.querySelectorAll('small')[0].textContent, 'Manual');
  const donut = dom.window.document.querySelector('.alva-donut');
  assert.equal(donut.querySelector('strong').textContent, '25');
  dom.window.close();
});

test('clique final envia rota com campo required pulado sem validação nativa global', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  const sent = [];
  const dom = new JSDOM(renderDynamicForm({ ...normalizeFormInput(quiz()), id: 'send', name: 'Send' }, '/submit'), { runScripts: 'dangerously', url: 'https://studio.test/', beforeParse(window) {
    window.CSS = { escape: (value) => String(value) };
    window.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, text: async () => '<!doctype html><html><body>Fim</body></html>' }; };
  } });
  const radio = dom.window.document.querySelector('input[value="Oferta"]'); radio.checked = true; radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('.next').click();
  assert.equal(dom.window.document.querySelector('form').noValidate, true);
  dom.window.document.querySelector('.next').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [{ answers: { perfil: 'Oferta' } }]);
  dom.window.close();
});

test('autoavanço atrasado não avança novamente após Continuar manual', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  const source = normalizeFormInput({ ...quiz(), steps: [{ ...quiz().steps[0], autoAdvance: true }, ...quiz().steps.slice(1)] });
  const sent = [];
  const dom = new JSDOM(renderDynamicForm({ ...source, id: 'race', name: 'Race' }, '/submit'), { runScripts: 'dangerously', url: 'https://studio.test/', beforeParse(window) { window.CSS = { escape: (value) => String(value) }; window.fetch = async (_url, options) => { sent.push(options); return { ok: true, text: async () => '' }; }; } });
  const radio = dom.window.document.querySelector('input[value="Oferta"]'); radio.checked = true; radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('.next').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(dom.window.document.querySelector('[data-screen-id="oferta"]').hidden, false);
  assert.deepEqual(sent, []);
  dom.window.close();
});


test('requestSubmit segue rota antes da conclusão na prévia', async () => {
  const { JSDOM } = await import('../../core/node_modules/jsdom/lib/api.js');
  const { renderDynamicForm } = await import('../server/dynamic-form.mjs');
  const dom = new JSDOM(renderDynamicForm({ ...normalizeFormInput(quiz()), id: 'preview-submit', name: 'Prévia' }, '/submit', { preview: true }), { runScripts: 'dangerously', url: 'https://studio.test/', beforeParse(window) { window.CSS = { escape: (value) => String(value) }; } });
  const radio = dom.window.document.querySelector('input[value="Outro"]'); radio.checked = true;
  dom.window.document.querySelector('form').requestSubmit();
  assert.equal(dom.window.document.querySelector('[data-screen-id="desvio"]').hidden, false);
  assert.match(dom.window.document.body.textContent, /Nota/);
  dom.window.close();
});
