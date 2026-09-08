import { parseFragment, serialize } from 'parse5';
import postcss from 'postcss';

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const INPUT_TYPES = new Map([
  ['text', 'short_text'], ['tel', 'phone'], ['email', 'email'], ['number', 'number'],
  ['date', 'date'], ['range', 'scale'], ['file', 'file'], ['radio', 'single_choice'], ['checkbox', 'multiple_choice'],
]);

function fail(message) { return Object.assign(new Error(message), { status: 400, statusCode: 400 }); }
function attributes(node) { return Object.fromEntries((node.attrs || []).map(({ name, prefix, value }) => [`${prefix ? `${prefix}:` : ''}${name}`.toLowerCase(), value])); }
function text(node) { return (node.childNodes || []).map((child) => child.nodeName === '#text' ? (child.value || '') : text(child)).join('').replace(/\s+/g, ' ').trim(); }
function unsafeUrl(value, attribute, tag) {
  const compact = String(value || '').replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/^(?:javascript|vbscript):/i.test(compact)) return true;
  if (!/^data:/i.test(compact)) return false;
  return !(attribute === 'src' && tag === 'img' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(compact));
}
function booleanAttribute(attrs, name, model = false) {
  if (!Object.hasOwn(attrs, name)) return false;
  return model ? attrs[name] !== false : true;
}
function required(attrs, model = false) { return booleanAttribute(attrs, 'required', model); }
function isDisabled(attrs, model = false) { return booleanAttribute(attrs, 'disabled', model); }
function fieldType(tag, attrs) {
  if (tag === 'textarea') return 'long_text';
  if (tag === 'select') return Object.hasOwn(attrs, 'multiple') ? 'multiple_choice' : 'single_choice';
  const type = String(attrs.type || 'text').toLowerCase();
  if (['submit', 'button', 'reset', 'hidden', 'image'].includes(type)) return null;
  if (!INPUT_TYPES.has(type)) throw fail(`Tipo de campo “${type}” não é suportado no canvas.`);
  return INPUT_TYPES.get(type);
}
function optionsFor(node, type, attrs) {
  if (node.tagName === 'select') return (node.childNodes || []).filter((child) => child.tagName === 'option').map((option) => {
    const optionAttrs = attributes(option);
    return String(optionAttrs.value || text(option)).trim();
  }).filter(Boolean);
  return ['single_choice', 'multiple_choice'].includes(type) ? [String(attrs.value || '').trim()].filter(Boolean) : [];
}
function addAnswerAttribute(node) {
  if (!(node.attrs || []).some((attr) => attr.name.toLowerCase() === 'data-answer')) node.attrs.push({ name: 'data-answer', value: '' });
}
function extractHtmlFields(html) {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const raw = [];
  const labels = new Map();
  const collectLabels = (node) => {
    const attrs = attributes(node);
    if (String(node.tagName || '').toLowerCase() === 'label' && attrs.for) labels.set(String(attrs.for), text(node));
    (node.childNodes || []).forEach(collectLabels);
  };
  fragment.childNodes.forEach(collectLabels);
  const visit = (node, context = {}) => {
    if (node.nodeName === '#comment') return;
    const tag = String(node.tagName || '').toLowerCase();
    const attrs = attributes(node);
    if (tag === 'script' || tag === 'form' || tag === 'object' || tag === 'embed') throw fail('Canvas da etapa contém conteúdo não permitido.');
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('on') || name === 'srcdoc') throw fail('Canvas da etapa contém conteúdo não permitido.');
      if (URL_ATTRIBUTES.has(name) && unsafeUrl(value, name, tag)) throw fail('Canvas da etapa contém conteúdo não permitido.');
    }
    const ownLabel = tag === 'label' ? text(node) : context.label;
    const wrapperHeading = (node.childNodes || []).find((child) => /^h[1-6]$/.test(String(child.tagName || '').toLowerCase()));
    const ownHeading = /^h[1-6]$/.test(tag) ? text(node) : context.heading || (wrapperHeading ? text(wrapperHeading) : '');
    const quizQuestion = String(attrs['data-quiz-question'] || context.quizQuestion || '').trim();
    const quizRequired = attrs['data-quiz-required'] === 'true' || context.quizRequired === true;
    const className = String(attrs.class || '').toLowerCase();
    const visual = context.visual || attrs['data-element-type'] === 'image_choice' || /image[-_ ]choice|choice-image/.test(className);
    if (['input', 'textarea', 'select'].includes(tag) && !isDisabled(attrs)) {
      const type = fieldType(tag, attrs);
      if (type) {
        const id = String(attrs.name || '').trim();
        if (!id) throw fail('Todo campo do canvas precisa de um nome estável.');
        if (RESERVED.has(id)) throw fail('Nome de campo inválido.');
        raw.push({ id, type: visual && type === 'single_choice' ? 'image_choice' : type, title: quizQuestion || ownHeading || ownLabel || labels.get(String(attrs.id || '')) || id, required: type === 'multiple_choice' ? quizRequired : required(attrs), options: optionsFor(node, type, attrs), range: type === 'scale' ? { min: Number(attrs.min ?? 1), max: Number(attrs.max ?? 10) } : undefined });
        addAnswerAttribute(node);
      }
    }
    (node.childNodes || []).forEach((child) => visit(child, { label: ownLabel, heading: ownHeading, visual, quizQuestion, quizRequired }));
  };
  fragment.childNodes.forEach((node) => visit(node));
  return { fields: groupFields(raw), html: serialize(fragment) };
}
function chartBindings(html) {
  const result = new Map(); const all = [];
  const visit = (node) => {
    const attrs = attributes(node); const raw = attrs['data-alva-chart-bindings'];
    if (raw !== undefined) {
      const id = String(attrs['data-element-id'] || '').trim(); let bindings;
      try { bindings = JSON.parse(raw); } catch { throw fail('Os vínculos do gráfico no canvas são inválidos.'); }
      if (!Array.isArray(bindings) || bindings.some((binding) => binding !== null && (typeof binding !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(binding)))) throw fail('Os vínculos do gráfico no canvas são inválidos.');
      all.push(bindings); if (id) result.set(id, bindings);
    }
    (node.childNodes || []).forEach(visit);
  };
  parseFragment(html).childNodes.forEach(visit);
  return { byElementId: result, all };
}
function roots(state) {
  if (Array.isArray(state?.pages)) return state.pages.flatMap((page) => (page.frames || []).map((frame) => frame.component).filter(Boolean));
  return Array.isArray(state?.components) ? state.components : [];
}
function modelText(node) { return typeof node?.content === 'string' ? node.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : (node?.components || []).map(modelText).join(' ').trim(); }
function extractModelFields(state) {
  const raw = [];
  const labels = new Map();
  const collectLabels = (node) => {
    if (!node || typeof node !== 'object') return;
    const attrs = node.attributes && typeof node.attributes === 'object' ? node.attributes : {};
    if (String(node.tagName || '').toLowerCase() === 'label' && attrs.for) labels.set(String(attrs.for), modelText(node));
    (node.components || []).forEach(collectLabels);
  };
  roots(state).forEach(collectLabels);
  const visit = (node, context = {}) => {
    if (!node || typeof node !== 'object') return;
    const tag = node.type === 'alva-field' ? 'input' : String(node.tagName || '').toLowerCase();
    const attrs = node.attributes && typeof node.attributes === 'object' ? node.attributes : {};
    const ownLabel = tag === 'label' ? modelText(node) : context.label;
    const wrapperHeading = (node.components || []).find((child) => /^h[1-6]$/.test(String(child?.tagName || '').toLowerCase()));
    const ownHeading = /^h[1-6]$/.test(tag) ? modelText(node) : context.heading || modelText(wrapperHeading);
    const quizQuestion = String(attrs['data-quiz-question'] || context.quizQuestion || '').trim();
    const quizRequired = attrs['data-quiz-required'] === 'true' || context.quizRequired === true;
    const className = [attrs.class, ...(Array.isArray(node.classes) ? node.classes : [])].filter(Boolean).join(' ').toLowerCase();
    const visual = context.visual || attrs['data-element-type'] === 'image_choice' || /image[-_ ]choice|choice-image/.test(className);
    if (['input', 'textarea', 'select'].includes(tag) && !isDisabled(attrs, true)) {
      const type = fieldType(tag, attrs);
      if (type) {
        const id = String(attrs.name || '').trim();
        if (!id) throw fail('Todo campo do canvas precisa de um nome estável.');
        if (RESERVED.has(id)) throw fail('Nome de campo inválido.');
        raw.push({ id, type: visual && type === 'single_choice' ? 'image_choice' : type, title: quizQuestion || ownHeading || ownLabel || labels.get(String(attrs.id || '')) || id, required: type === 'multiple_choice' ? quizRequired : required(attrs, true), options: optionsFor({ tagName: tag, childNodes: (node.components || []).map(modelToHtmlNode) }, type, attrs), range: type === 'scale' ? { min: Number(attrs.min ?? 1), max: Number(attrs.max ?? 10) } : undefined });
      }
    }
    (node.components || []).forEach((child) => visit(child, { label: ownLabel, heading: ownHeading, visual, quizQuestion, quizRequired }));
  };
  roots(state).forEach((node) => visit(node));
  return groupFields(raw);
}
function modelElementIds(state) {
  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const id = node.attributes?.['data-element-id'];
    if (typeof id === 'string' && id) ids.add(id);
    (node.components || []).forEach(visit);
  };
  roots(state).forEach(visit);
  return ids;
}
function modelToHtmlNode(node) {
  if (node?.type === 'textnode' || typeof node?.content === 'string' && !node?.tagName) return { nodeName: '#text', value: node.content || '' };
  return { tagName: node?.tagName, attrs: Object.entries(node?.attributes || {}).map(([name, value]) => ({ name, value: String(value) })), childNodes: (node?.components || []).map(modelToHtmlNode) };
}
function groupFields(raw) {
  const grouped = new Map();
  for (const field of raw) {
    const prior = grouped.get(field.id);
    if (!prior) { grouped.set(field.id, { ...field, options: [...field.options] }); continue; }
    if (prior.type !== field.type || !['single_choice', 'multiple_choice', 'image_choice'].includes(field.type)) throw fail(`O campo “${field.id}” está ambíguo.`);
    prior.required ||= field.required;
    prior.options.push(...field.options);
  }
  return [...grouped.values()].map((field) => {
    if (['single_choice', 'multiple_choice', 'image_choice'].includes(field.type)) {
      field.options = [...new Set(field.options)];
      if (field.options.length < 2) throw fail(`O campo “${field.id}” precisa de duas opções.`);
    } else delete field.options;
    if (field.type === 'scale' && (!Number.isFinite(field.range.min) || !Number.isFinite(field.range.max) || field.range.max <= field.range.min)) throw fail('A escala do canvas é inválida.');
    return field;
  });
}
function signature(fields) { return JSON.stringify(fields.map(({ id, type, required, options = [], range }) => ({ id, type, required, options, range })).sort((a, b) => a.id.localeCompare(b.id))); }
function validateModel(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw fail('Canvas da etapa inválido.');
  seen.add(value);
  const tag = value.type === 'alva-field' ? 'input' : String(value.tagName || '').toLowerCase();
  if (['script', 'form', 'object', 'embed', 'template'].includes(tag)) throw fail('Canvas da etapa contém conteúdo não permitido.');
  const attrs = value.attributes && typeof value.attributes === 'object' ? value.attributes : {};
  for (const [key, child] of Object.entries(attrs)) {
    const name = key.toLowerCase();
    if (name.startsWith('on') || name === 'srcdoc' || URL_ATTRIBUTES.has(name) && unsafeUrl(child, name, tag)) throw fail('Canvas da etapa contém conteúdo não permitido.');
  }
  for (const [key, child] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (name === 'script' || name === 'script-export' || name.startsWith('on')) throw fail('Canvas da etapa contém conteúdo não permitido.');
    if (typeof child === 'string' && (/<\s*\/?\s*script\b|\bon\w+\s*=|\b(?:javascript|vbscript)\s*:|data:image\/svg\+xml/i.test(child))) throw fail('Canvas da etapa contém conteúdo não permitido.');
    validateModel(child, seen);
  }
}

export function normalizeQuizCanvas(value, { header = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !value.editorState || typeof value.editorState !== 'object' || Array.isArray(value.editorState) || typeof value.html !== 'string' || typeof value.css !== 'string' || value.html.length > 500000 || value.css.length > 500000) throw fail('Canvas da etapa inválido.');
  if (/@import\b|\b(?:javascript|vbscript)\s*:|\bexpression\s*\(/i.test(value.css)) throw fail('Canvas da etapa contém conteúdo não permitido.');
  validateModel(value.editorState);
  const parsed = extractHtmlFields(value.html);
  const modelFields = extractModelFields(value.editorState);
  if (signature(parsed.fields) !== signature(modelFields)) throw fail('O canvas e seu modelo estão divergentes. Reabra a tela e salve novamente.');
  if (header && parsed.fields.length) throw fail('O topo compartilhado não pode conter campos de resposta.');
  return { canvas: { version: 1, editorState: structuredClone(value.editorState), html: parsed.html, css: value.css }, fields: parsed.fields, elementIds: modelElementIds(value.editorState), chartBindings: chartBindings(parsed.html) };
}

export function renderQuizCanvas(canvas, scope) {
  const parsed = extractHtmlFields(canvas.html);
  const id = String(scope).replace(/[^a-zA-Z0-9_-]/g, '');
  return `<div class="quiz-canvas" data-quiz-canvas="${id}"><style>${scopeCanvasCss(canvas.css, id)}</style>${parsed.html}</div>`;
}

export function scopeCanvasCss(css, id) {
  let root;
  try { root = postcss.parse(css); } catch { throw fail('CSS do canvas inválido.'); }
  const scope = `[data-quiz-canvas="${id}"]`;
  root.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
    }
    rule.selectors = rule.selectors.map((selector) => {
      const trimmed = selector.trim();
      let rest = trimmed;
      let stripped = false;
      while (/^(?::root|html|body)(?:\s*>\s*|\s+|$)/.test(rest)) {
        rest = rest.replace(/^(?::root|html|body)(?:\s*>\s*|\s+|$)/, '');
        stripped = true;
      }
      if (stripped) return rest ? `${scope} ${rest}` : scope;
      return `${scope} ${trimmed}`;
    });
  });
  return root.toString().replace(/</g, '\\3C ');
}
