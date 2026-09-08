const OPERATORS = new Set(['equals', 'includes']);
const CHOICE_TYPES = new Set(['single_choice', 'image_choice', 'multiple_choice']);
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_STEPS = 50;
const MAX_RULES = 20;

const fail = (message) => { throw new Error(`Navegação do quiz inválida: ${message}`); };
const hasOwn = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
function validId(value) { return typeof value === 'string' && ID_RE.test(value) && !['__proto__', 'prototype', 'constructor', '$complete'].includes(value); }

function compileNavigation(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) fail('use de 1 a 50 etapas.');
  const ids = []; const indexById = new Map();
  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step) || !validId(step.id)) fail(`ID de etapa inválido na etapa ${index + 1}.`);
    if (indexById.has(step.id)) fail(`ID de etapa repetido na etapa ${index + 1}.`);
    ids.push(step.id); indexById.set(step.id, index);
  }
  const target = (value, sourceIndex, label) => {
    if (value === '$complete') return value;
    if (!validId(value) || !indexById.has(value)) fail(`${label} aponta para etapa inexistente.`);
    if (indexById.get(value) <= sourceIndex) fail(`${label} não pode apontar para a própria etapa ou para uma etapa anterior.`);
    return value;
  };
  const routes = steps.map((step, index) => {
    if (step.branching === undefined) return null;
    const branching = step.branching;
    if (!branching || typeof branching !== 'object' || Array.isArray(branching)) fail(`branching inválido na etapa ${index + 1}.`);
    const rawRules = branching.rules === undefined ? [] : branching.rules;
    if (!Array.isArray(rawRules) || rawRules.length > MAX_RULES) fail(`a etapa ${index + 1} pode ter no máximo 20 regras.`);
    const rules = rawRules.map((rule, ruleIndex) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.fieldId !== 'string' || !validId(rule.fieldId) || !OPERATORS.has(rule.operator) || typeof rule.value !== 'string') fail(`regra ${ruleIndex + 1} inválida na etapa ${index + 1}.`);
      const field = (Array.isArray(step.elements) ? step.elements : []).find((element) => element?.id === rule.fieldId);
      if (!field || !CHOICE_TYPES.has(field.type)) fail(`fieldId não é uma escolha da etapa ${index + 1}.`);
      if ((rule.operator === 'equals' && !['single_choice', 'image_choice'].includes(field.type)) || (rule.operator === 'includes' && field.type !== 'multiple_choice')) fail(`operador ${rule.operator} incompatível com ${field.type}.`);
      const options = Array.isArray(field.options) ? field.options.map((option) => typeof option === 'string' ? option : option?.label) : [];
      if (!options.includes(rule.value)) fail(`valor da regra ${ruleIndex + 1} não existe nas opções de ${rule.fieldId}.`);
      return { fieldId: rule.fieldId, operator: rule.operator, value: rule.value, nextScreenId: target(rule.nextScreenId, index, `regra ${ruleIndex + 1}`) };
    });
    return { rules, ...(branching.defaultNextScreenId === undefined ? {} : { defaultNextScreenId: target(branching.defaultNextScreenId, index, 'defaultNextScreenId') }) };
  });
  return { ids, indexById, routes };
}

export function normalizeQuizNavigation(steps) {
  const compiled = compileNavigation(steps);
  const normalized = structuredClone(steps);
  normalized.forEach((step, index) => { if (compiled.routes[index]) step.branching = compiled.routes[index]; });
  return normalized;
}

function nextFromCompiled(compiled, steps, currentId, answers = {}) {
  if (!compiled.indexById.has(currentId)) fail('currentId desconhecido.');
  const index = compiled.indexById.get(currentId); const route = compiled.routes[index];
  if (route) {
    for (const rule of route.rules) {
      const answer = hasOwn(answers, rule.fieldId) ? answers[rule.fieldId] : undefined;
      const matches = rule.operator === 'equals' ? answer === rule.value : Array.isArray(answer) && answer.includes(rule.value);
      if (matches) return rule.nextScreenId;
    }
    if (route.defaultNextScreenId !== undefined) return route.defaultNextScreenId;
  }
  return steps[index + 1]?.id || '$complete';
}

export function nextQuizScreenId(steps, currentId, answers = {}) { return nextFromCompiled(compileNavigation(steps), steps, currentId, answers); }

export function quizVisitedScreenIds(steps, answers = {}) {
  const compiled = compileNavigation(steps); const visited = []; const seen = new Set(); let current = compiled.ids[0];
  while (current !== '$complete') {
    if (seen.has(current)) fail('a rota contém um ciclo.');
    if (visited.length >= MAX_STEPS) fail('a rota excede o limite de 50 etapas.');
    seen.add(current); visited.push(current); current = nextFromCompiled(compiled, steps, current, answers);
  }
  return visited;
}
