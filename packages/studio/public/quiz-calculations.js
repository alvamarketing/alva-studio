const OPERATIONS = new Set(['add', 'subtract', 'multiply', 'divide']);
const FIELD_TYPES = new Set(['number', 'scale']);
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor', '$complete']);
const MAX_CALCULATIONS = 20;

const fail = (message) => { throw new Error(`Cálculo do quiz inválido: ${message}`); };
const hasOwn = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
const validId = (value) => typeof value === 'string' && ID_RE.test(value) && !RESERVED_IDS.has(value);
const exactKeys = (value, keys, label) => {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(`${label} contém campo desconhecido.`);
};

function fieldTypes(schema) {
  const fields = new Map();
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail('schema inválido.');
  if (!Array.isArray(schema.steps)) fail('steps inválido.');
  for (const step of schema.steps) {
    for (const field of Array.isArray(step?.elements) ? step.elements : []) {
      if (validId(field?.id)) fields.set(field.id, field.type);
    }
  }
  return fields;
}

function compile(schema) {
  const raw = schema?.calculations;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CALCULATIONS) fail('use de 0 a 20 cálculos.');
  const fields = fieldTypes(schema);
  const ids = new Set();
  return raw.map((calculation, index) => {
    if (!calculation || typeof calculation !== 'object' || Array.isArray(calculation)) fail(`cálculo ${index + 1} inválido.`);
    exactKeys(calculation, ['id', 'label', 'operation', 'operands'], `cálculo ${index + 1}`);
    if (!validId(calculation.id) || ids.has(calculation.id)) fail(`ID inválido ou repetido no cálculo ${index + 1}.`);
    if (typeof calculation.label !== 'string' || !calculation.label.trim()) fail(`label inválido no cálculo ${index + 1}.`);
    if (!OPERATIONS.has(calculation.operation)) fail(`operação inválida no cálculo ${index + 1}.`);
    if (!Array.isArray(calculation.operands) || calculation.operands.length !== 2) fail(`cálculo ${index + 1} precisa de exatamente 2 operandos.`);
    ids.add(calculation.id);
    const operands = calculation.operands.map((operand, operandIndex) => {
      if (!operand || typeof operand !== 'object' || Array.isArray(operand)) fail(`operando ${operandIndex + 1} inválido no cálculo ${index + 1}.`);
      exactKeys(operand, ['fieldId', 'value'], `operando ${operandIndex + 1} do cálculo ${index + 1}`);
      const hasField = hasOwn(operand, 'fieldId'); const hasValue = hasOwn(operand, 'value');
      if (hasField === hasValue) fail(`operando ${operandIndex + 1} deve ter fieldId ou value.`);
      if (hasField) {
        if (!validId(operand.fieldId) || !FIELD_TYPES.has(fields.get(operand.fieldId))) fail(`campo referenciado inválido no cálculo ${index + 1}.`);
        return { fieldId: operand.fieldId };
      }
      if (typeof operand.value !== 'number' || !Number.isFinite(operand.value)) fail(`constante inválida no cálculo ${index + 1}.`);
      return { value: operand.value };
    });
    return { id: calculation.id, label: calculation.label, operation: calculation.operation, operands };
  });
}

export function normalizeQuizCalculations(schema) { return compile(schema); }

function answerNumber(answers, fieldId) {
  if (!hasOwn(answers, fieldId)) return null;
  const answer = answers[fieldId];
  if (typeof answer === 'number') return Number.isFinite(answer) ? answer : null;
  if (typeof answer === 'string' && answer.trim()) {
    const value = Number(answer);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function evaluateQuizCalculations(schema, answers = {}) {
  return Object.fromEntries(normalizeQuizCalculations(schema).map((calculation) => {
    const values = calculation.operands.map((operand) => operand.fieldId === undefined ? operand.value : answerNumber(answers, operand.fieldId));
    let result = values.some((value) => value === null) ? null : values[0];
    if (result !== null) {
      const right = values[1];
      if (calculation.operation === 'add') result += right;
      else if (calculation.operation === 'subtract') result -= right;
      else if (calculation.operation === 'multiply') result *= right;
      else if (right === 0) result = null;
      else result /= right;
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    return [calculation.id, result];
  }));
}
