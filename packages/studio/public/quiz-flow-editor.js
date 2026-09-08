import { normalizeQuizNavigation } from './quiz-navigation.js';
import { normalizeQuizCalculations } from './quiz-calculations.js';
const clone = (value) => structuredClone(value || {});
const labelOf = (field) => String(field?.title || field?.label || field?.id || 'Pergunta sem nome');
const optionLabel = (option) => typeof option === 'string' ? option : String(option?.label || option?.value || 'Opção');
const idOf = (prefix) => globalThis.crypto?.randomUUID?.() || `${prefix}_${Math.random().toString(16).slice(2, 10)}`;

export function normalizeQuizFlowSchema(schema = {}) {
  const next = clone(schema);
  next.steps = Array.isArray(next.steps) ? next.steps : [];
  next.elements = Array.isArray(next.elements) ? next.elements : [];
  next.calculations = Array.isArray(next.calculations) ? next.calculations : [];
  return next;
}


export function validateQuizFlow(schema = {}) {
  const current = normalizeQuizFlowSchema(schema);
  try {
    const steps = normalizeQuizNavigation(current.steps);
    normalizeQuizCalculations({ steps, calculations: current.calculations });
    return [];
  } catch (error) {
    return [String(error?.message || 'Corrija as regras e cálculos antes de salvar.')];
  }
}

export function quizFlowDestinations(schema, stepId) {
  const steps = Array.isArray(schema?.steps) ? schema.steps : [];
  const index = steps.findIndex((step) => step?.id === stepId);
  return (index < 0 ? [] : steps.slice(index + 1)).filter((step) => step?.id).map((step) => ({ id: step.id, label: step.title || `Tela ${steps.indexOf(step) + 1}` }));
}

export function renderQuizFlowEditor({ container, schema, stepId, onChange = () => {}, readOnly = false } = {}) {
  if (!container) throw new Error('Informe o container do editor de fluxo.');
  let current = normalizeQuizFlowSchema(schema);
  const emit = (next) => {
    current = normalizeQuizFlowSchema(next);
    onChange(clone(current));
    render();
  };
  const element = (tag, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  const section = (title) => {
    const node = element('section', 'fe-control-section');
    const heading = element('h3');
    heading.textContent = title;
    node.append(heading);
    container.append(node);
    return node;
  };
  const help = (parent, message) => {
    const node = element('p', 'fe-help');
    node.textContent = message;
    parent.append(node);
  };
  const field = (parent, label, value, change, { choices, type = 'text', placeholder } = {}) => {
    const row = element('label', 'fe-field');
    const caption = element('span');
    caption.textContent = label;
    const input = element(choices ? 'select' : 'input');
    if (choices) choices.forEach(([key, text]) => {
      const option = element('option'); option.value = key; option.textContent = text; input.append(option);
    });
    else input.type = type;
    input.value = value ?? '';
    if (type === 'checkbox') input.checked = Boolean(value);
    if (placeholder) input.placeholder = placeholder;
    input.disabled = readOnly;
    input.onchange = () => change(type === 'checkbox' ? input.checked : input.value);
    row.append(caption, input); parent.append(row);
    return input;
  };
  const button = (parent, label, action, danger = false, disabled = false) => {
    const node = element('button', danger ? 'fe-danger' : '');
    node.type = 'button'; node.textContent = label; node.disabled = readOnly || disabled; node.onclick = action; parent.append(node);
    return node;
  };
  const fields = () => current.elements.filter((item) => item?.id);
  const stepFields = () => (current.steps.find((item) => item?.id === stepId)?.elements || []).filter((item) => item?.id && ['single_choice', 'multiple_choice', 'image_choice'].includes(item.type));
  const fieldChoices = (value = '') => {
    const listed = stepFields().map((item) => [item.id, labelOf(item)]);
    return listed.some(([id]) => id === value) || !value ? [['', 'Selecione uma pergunta'], ...listed] : [[value, `Pergunta removida (${value})`], ['', 'Selecione uma pergunta'], ...listed];
  };
  const responses = (fieldId, value = '') => {
    const selected = stepFields().find((item) => item.id === fieldId);
    const listed = Array.isArray(selected?.options) ? selected.options.map((option) => [String(optionLabel(option)), optionLabel(option)]) : [];
    if (!selected) return value ? [[value, `Resposta removida (${value})`]] : [['', 'Selecione uma resposta']];
    return listed.some(([id]) => id === value) || !value ? [['', 'Selecione uma resposta'], ...listed] : [[value, `Resposta removida (${value})`], ['', 'Selecione uma resposta'], ...listed];
  };
  const numericChoices = (value = '') => {
    const listed = fields().filter((item) => ['number', 'scale', 'range'].includes(String(item.type))).map((item) => [item.id, labelOf(item)]);
    return listed.some(([id]) => id === value) || !value ? [['', 'Selecione uma resposta numérica'], ...listed] : [[value, `Resposta removida (${value})`], ['', 'Selecione uma resposta numérica'], ...listed];
  };
  const destinations = () => quizFlowDestinations(current, stepId);
  const destinationChoices = (value = '', { rule = false } = {}) => {
    const listed = destinations().map((step) => [step.id, step.label]);
    const defaults = rule ? [['$complete', 'Concluir formulário']] : [['', 'Próxima tela'], ['$complete', 'Concluir formulário']];
    if (rule && !value) return [['', 'Selecione destino'], ...defaults, ...listed];
    return listed.some(([id]) => id === value) || defaults.some(([id]) => id === value) ? [...defaults, ...listed] : [[value, `Tela removida (${value})`], ...defaults, ...listed];
  };
  const nextRuleDestination = () => destinations()[0]?.id || '$complete';
  const operatorFor = (fieldId) => stepFields().find((item) => item.id === fieldId)?.type === 'multiple_choice' ? 'includes' : 'equals';
  const initialRule = () => {
    const first = stepFields()[0];
    const value = Array.isArray(first?.options) ? optionLabel(first.options[0]) : '';
    return { fieldId: first?.id || '', operator: operatorFor(first?.id), value, nextScreenId: nextRuleDestination() };
  };
  const updateStep = (mutate) => {
    const next = clone(current); const step = next.steps.find((item) => item.id === stepId);
    if (!step) return;
    if (!step.branching) step.branching = { rules: [] };
    if (!Array.isArray(step.branching.rules)) step.branching.rules = [];
    mutate(step); emit(next);
  };
  const updateCalculation = (index, mutate) => {
    const next = clone(current); if (!next.calculations[index]) return; mutate(next.calculations[index]); emit(next);
  };
  const renderBranching = () => {
    const sectionNode = section('Regras por resposta');
    const step = current.steps.find((item) => item.id === stepId);
    if (!step) { help(sectionNode, 'Esta tela não existe mais.'); return; }
    const rules = step.branching?.rules || [];
    if (!stepFields().length) help(sectionNode, 'Adicione uma escolha nesta tela antes de criar uma regra.');
    rules.forEach((rule, index) => {
      const row = element('div', 'fe-field');
      field(row, 'Pergunta', rule.fieldId || '', (value) => updateStep((target) => { target.branching.rules[index].fieldId = value; target.branching.rules[index].operator = operatorFor(value); target.branching.rules[index].value = ''; }), { choices: fieldChoices(rule.fieldId) });
      const operator = operatorFor(rule.fieldId);
      help(row, operator === 'includes' ? 'Inclui qualquer uma das respostas marcadas.' : 'Segue quando a resposta for igual à opção escolhida.');
      field(row, 'Resposta', rule.value || '', (value) => updateStep((target) => { target.branching.rules[index].value = value; target.branching.rules[index].operator = operatorFor(target.branching.rules[index].fieldId); }), { choices: responses(rule.fieldId, rule.value) });
      field(row, 'Ir para', rule.nextScreenId || '', (value) => updateStep((target) => { target.branching.rules[index].nextScreenId = value || nextRuleDestination(); }), { choices: destinationChoices(rule.nextScreenId || '', { rule: true }) });
      button(row, 'Remover regra', () => updateStep((target) => target.branching.rules.splice(index, 1)), true);
      sectionNode.append(row);
      if (rule.fieldId && !stepFields().some((item) => item.id === rule.fieldId)) help(sectionNode, `A escolha “${rule.fieldId}” foi removida desta tela; selecione outra para corrigir a regra.`);
      if (rule.nextScreenId && rule.nextScreenId !== '$complete' && !destinations().some((item) => item.id === rule.nextScreenId)) help(sectionNode, `O destino “${rule.nextScreenId}” não está mais disponível depois desta tela.`);
    });
    field(sectionNode, 'Quando nenhuma regra combinar', step.branching?.defaultNextScreenId || '', (value) => updateStep((target) => { if (value) target.branching.defaultNextScreenId = value; else delete target.branching.defaultNextScreenId; }), { choices: destinationChoices(step.branching?.defaultNextScreenId || '') });
    help(sectionNode, 'Sem regra ou fallback, o formulário segue para a próxima tela.');
    button(sectionNode, 'Adicionar regra', () => updateStep((target) => target.branching.rules.push(initialRule())), false, !stepFields().length || rules.length >= 20);
    if (rules.length >= 20) help(sectionNode, 'Esta tela já tem o limite de 20 regras.');
  };
  const sourceValue = (operand) => Object.hasOwn(operand || {}, 'fieldId') ? { kind: 'field', value: operand.fieldId } : { kind: 'value', value: operand?.value ?? '' };
  const renderCalculations = () => {
    const sectionNode = section('Cálculos');
    current.calculations.forEach((calculation, index) => {
      const row = element('div', 'fe-field');
      field(row, 'Nome', calculation.label || '', (value) => updateCalculation(index, (item) => { item.label = value; }));
      field(row, 'Operação', calculation.operation || 'add', (value) => updateCalculation(index, (item) => { item.operation = value; }), { choices: [['add', 'Somar'], ['subtract', 'Subtrair'], ['multiply', 'Multiplicar'], ['divide', 'Dividir']] });
      const operands = Array.isArray(calculation.operands) ? calculation.operands : [];
      [0, 1].forEach((operandIndex) => {
        const source = sourceValue(operands[operandIndex]);
        field(row, `Fonte ${operandIndex + 1}`, source.kind, (kind) => updateCalculation(index, (item) => { item.operands ||= []; item.operands[operandIndex] = kind === 'field' ? { fieldId: '' } : { value: 0 }; }), { choices: [['field', 'Resposta numérica'], ['value', 'Valor fixo']] });
        if (source.kind === 'field') field(row, `Resposta ${operandIndex + 1}`, source.value, (value) => updateCalculation(index, (item) => { item.operands[operandIndex] = { fieldId: value }; }), { choices: numericChoices(source.value) });
        else field(row, `Valor ${operandIndex + 1}`, source.value, (value) => updateCalculation(index, (item) => { item.operands[operandIndex] = { value: Number(value) }; }), { type: 'number' });
      });
      button(row, 'Remover cálculo', () => { const next = clone(current); next.calculations.splice(index, 1); emit(next); }, true);
      sectionNode.append(row);
      operands.forEach((operand) => { if (operand?.fieldId && !fields().some((item) => item.id === operand.fieldId)) help(sectionNode, `A resposta numérica “${operand.fieldId}” foi removida; escolha outra fonte.`); });
    });
    button(sectionNode, 'Adicionar cálculo', () => { const next = clone(current); next.calculations.push({ id: idOf('calculo'), label: 'Novo cálculo', operation: 'add', operands: [{ value: 0 }, { value: 0 }] }); emit(next); }, false, current.calculations.length >= 20);
    if (current.calculations.length >= 20) help(sectionNode, 'O formulário já tem o limite de 20 cálculos.');
  };
  const render = () => { container.replaceChildren(); renderBranching(); renderCalculations(); };
  const refresh = (schema) => {
    const active = document.activeElement;
    const label = active?.closest?.('label')?.firstElementChild?.textContent || '';
    const matches = label ? [...container.querySelectorAll('label')].filter((row) => row.firstElementChild?.textContent === label) : [];
    const index = active ? matches.indexOf(active.closest('label')) : -1;
    current = normalizeQuizFlowSchema(schema);
    render();
    if (label) [...container.querySelectorAll('label')].filter((row) => row.firstElementChild?.textContent === label)[index]?.querySelector('input,select')?.focus();
  };
  render();
  return { destroy: () => container.replaceChildren(), getSchema: () => clone(current), render, refresh };
}
