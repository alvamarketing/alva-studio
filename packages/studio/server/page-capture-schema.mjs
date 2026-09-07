import { randomUUID } from 'node:crypto';
import { validateFormAnswers } from './form-answer-validation.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_TYPES = new Set(['text', 'email', 'tel', 'number', 'radio', 'checkbox']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function required(attrs) { return Object.hasOwn(attrs, 'required') && attrs.required !== false && attrs.required !== 'false'; }

function fail(message, status = 409) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function attributes(node) { return node && typeof node.attributes === 'object' && !Array.isArray(node.attributes) ? node.attributes : {}; }
function children(node) { return Array.isArray(node?.components) ? node.components : []; }
function tag(node) {
  if (node?.type === 'alva-field') return 'input';
  return String(node?.tagName || '').toLowerCase();
}
function text(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.content === 'string') return node.content.replace(/<[^>]*>/g, ' ');
  return children(node).map(text).join(' ');
}
function labelText(node) {
  return children(node).filter((child) => !['input', 'textarea', 'select'].includes(tag(child))).map(text).join(' ').replace(/\s+/g, ' ').trim();
}
function optionValues(node) {
  return children(node).filter((child) => tag(child) === 'option').map((option) => {
    const attrs = attributes(option);
    return String(attrs.value || text(option)).trim();
  }).filter(Boolean);
}
function fieldType(node) {
  const nodeTag = tag(node);
  if (nodeTag === 'textarea') return 'long_text';
  if (nodeTag === 'select') return Object.hasOwn(attributes(node), 'multiple') ? 'multiple_choice' : 'single_choice';
  if (nodeTag !== 'input') throw fail('Campo de captura não suportado.');
  const type = String(attributes(node).type || 'text').toLowerCase();
  if (!INPUT_TYPES.has(type)) throw fail(`Tipo de campo “${type}” não é suportado na captura.`);
  if (type === 'radio') return 'single_choice';
  if (type === 'checkbox') return 'multiple_choice';
  return type === 'tel' ? 'short_text' : type;
}
function visibleForms(value, result = []) {
  if (Array.isArray(value)) value.forEach((item) => visibleForms(item, result));
  else if (value && typeof value === 'object') {
    if (tag(value) === 'form') { result.push(value); return result; }
    for (const child of Object.values(value)) visibleForms(child, result);
  }
  return result;
}
function fieldsForForm(form) {
  const raw = [];
  const visit = (node, label = '') => {
    const currentLabel = tag(node) === 'label' ? labelText(node) : label;
    const nodeTag = tag(node);
    if (['input', 'textarea', 'select'].includes(nodeTag)) raw.push({ node, label: currentLabel });
    children(node).forEach((child) => visit(child, currentLabel));
  };
  children(form).forEach((child) => visit(child));
  const grouped = new Map();
  for (const { node, label } of raw) {
    const attrs = attributes(node);
    if (Object.hasOwn(attrs, 'disabled') && attrs.disabled !== false && attrs.disabled !== 'false') continue;
    const name = String(attrs.name || '').trim();
    if (!name) throw fail('Todo campo da captura precisa de um nome estável.');
    if (UNSAFE_KEYS.has(name)) throw fail('Nome de campo inválido.');
    const type = fieldType(node);
    const key = name;
    const previous = grouped.get(key);
    if (previous && previous.type !== type) throw fail(`O campo “${name}” está ambíguo.`);
    const options = nodeTagOptions(node, type);
    if (previous) {
      if (!['single_choice', 'multiple_choice'].includes(type)) throw fail(`O campo “${name}” está duplicado.`);
      previous.options.push(...options);
      previous.required ||= required(attrs);
    } else grouped.set(key, { id: name, type, title: label, required: required(attrs), ...(options.length ? { options } : {}) });
  }
  for (const field of grouped.values()) {
    if (['single_choice', 'multiple_choice'].includes(field.type)) {
      field.options = [...new Set(field.options || [])];
      if (!field.options.length) throw fail(`O campo “${field.id}” precisa de opções.`);
    }
  }
  return [...grouped.values()];
}
function nodeTagOptions(node, type) {
  if (tag(node) === 'select') return optionValues(node);
  if (!['single_choice', 'multiple_choice'].includes(type)) return [];
  const value = String(attributes(node).value || '').trim();
  if (!value) throw fail(`O campo “${String(attributes(node).name || '').trim()}” precisa de um valor.`);
  return [value];
}

export function normalizePageCaptureIds(editorState, uuid = randomUUID) {
  const state = clone(editorState || {});
  const seen = new Set();
  for (const form of visibleForms(state)) {
    const attrs = attributes(form);
    const current = String(attrs['data-alva-capture-id'] || '').trim();
    const captureId = UUID.test(current) && !seen.has(current) ? current : uuid();
    form.attributes = { ...attrs, 'data-alva-capture-id': captureId };
    seen.add(captureId);
  }
  return state;
}

export function extractPageCaptureSchema(editorState, { webhook = '' } = {}) {
  const forms = visibleForms(editorState);
  const captures = forms.map((form) => {
    const attrs = attributes(form);
    const captureId = String(attrs['data-alva-capture-id'] || '').trim();
    if (!UUID.test(captureId)) throw fail('A captura da página precisa de um identificador estável.');
    const name = String(attrs['data-alva-capture-name'] || attrs['aria-label'] || text(children(form).find((node) => /^h[1-6]$/.test(tag(node))) || '')).replace(/\s+/g, ' ').trim();
    return { captureId, name, fields: fieldsForForm(form), webhook, completion: {} };
  });
  return { forms: captures };
}

export function pageCaptureValidationSchema(capture) {
  return { steps: [{ id: capture.captureId, elements: capture.fields }] };
}

export function validatePageCaptureAnswers(capture, input) {
  const answers = input?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.getPrototypeOf(answers) !== Object.prototype)
    throw fail('Respostas inválidas.');
  const allowed = new Set(capture.fields.map((field) => field.id));
  for (const [key, value] of Object.entries(answers)) {
    if (UNSAFE_KEYS.has(key) || !allowed.has(key)) throw fail('Campo de resposta inválido.');
    if (Array.isArray(value)) {
      if (value.some((item) => typeof item !== 'string')) throw fail('Campo de resposta inválido.');
    } else if (typeof value !== 'string' && value !== undefined) throw fail('Campo de resposta inválido.');
  }
  return validateFormAnswers(pageCaptureValidationSchema(capture), input);
}
