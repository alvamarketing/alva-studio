import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPageCaptureSchema, normalizePageCaptureIds, pageCaptureValidationSchema, validatePageCaptureAnswers } from '../server/page-capture-schema.mjs';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';

const form = () => ({ tagName: 'form', components: [
  { tagName: 'h3', components: [{ type: 'textnode', content: 'Vamos conversar?' }] },
  { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: true } }] },
  { tagName: 'label', components: [{ type: 'textnode', content: 'Curso' }, { tagName: 'input', attributes: { name: 'interesse', type: 'checkbox', value: 'Curso' } }] },
  { tagName: 'label', components: [{ type: 'textnode', content: 'Consultoria' }, { tagName: 'input', attributes: { name: 'interesse', type: 'checkbox', value: 'Consultoria' } }] },
] });

test('normaliza o formato Grapes pages/frames sem depender de ordem e adapta campos ao validador existente', () => {
  const state = { pages: [{ frames: [{ component: { components: [form(), form()] } }] }] };
  let next = 1;
  const normalized = normalizePageCaptureIds(state, () => `11111111-1111-4111-8111-${String(next++).padStart(12, '0')}`);
  const schema = extractPageCaptureSchema(normalized, { webhook: 'https://hooks.example.test/lead' });
  assert.equal(schema.forms.length, 2);
  assert.equal(schema.forms[0].name, 'Vamos conversar?');
  assert.deepEqual(schema.forms[0].fields.map(({ id, type }) => [id, type]), [['email', 'email'], ['interesse', 'multiple_choice']]);
  assert.deepEqual(validateFormAnswers(pageCaptureValidationSchema(schema.forms[0]), { answers: { email: 'lead@alva.test', interesse: ['Curso'] } }), { email: 'lead@alva.test', interesse: ['Curso'] });
});

test('não inventa rótulo e rejeita apenas campo sem nome estável', () => {
  const state = normalizePageCaptureIds({ components: [{ tagName: 'form', components: [{ tagName: 'input', attributes: { name: 'empresa', type: 'text' } }] }] });
  assert.equal(extractPageCaptureSchema(state).forms[0].fields[0].title, '');
  const invalid = normalizePageCaptureIds({ components: [{ tagName: 'form', components: [{ tagName: 'input', attributes: { type: 'text' } }] }] });
  assert.throws(() => extractPageCaptureSchema(invalid), /nome estável/);
});

test('rejeita campos desconhecidos e nomes perigosos', () => {
  const schema = extractPageCaptureSchema(normalizePageCaptureIds({ components: [form()] })).forms[0];
  assert.throws(() => validatePageCaptureAnswers(schema, { answers: { email: 'ok@alva.test', surpresa: 'x' } }), /Campo de resposta inválido/);
  const dangerous = normalizePageCaptureIds({ components: [{ tagName: 'form', components: [{ tagName: 'input', attributes: { name: 'constructor', type: 'text' } }] }] });
  assert.throws(() => extractPageCaptureSchema(dangerous), /Nome de campo inválido/);
});

test('mantém o primeiro ID de clone e regenera somente o duplicado', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const source = form(); source.attributes = { 'data-alva-capture-id': id };
  const clone = structuredClone(source);
  const normalized = normalizePageCaptureIds({ components: [source, clone] }, () => '22222222-2222-4222-8222-222222222222');
  assert.equal(normalized.components[0].attributes['data-alva-capture-id'], id);
  assert.equal(normalized.components[1].attributes['data-alva-capture-id'], '22222222-2222-4222-8222-222222222222');
});

test('extrai getProjectData real com alva-field e mantém IDs após reorder', async () => {
  const { default: grapesjs } = await import('grapesjs');
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.DomComponents.addType('alva-field', { isComponent: (element) => element?.tagName === 'INPUT', model: { defaults: { tagName: 'input', void: true, droppable: false } } });
    editor.getWrapper().append({ tagName: 'form', components: [{ tagName: 'h3', components: [{ type: 'textnode', content: 'Contato' }] }, { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { type: 'alva-field', attributes: { name: 'email', type: 'email', required: '' } }] }] });
    const first = normalizePageCaptureIds(editor.getProjectData());
    const captureId = extractPageCaptureSchema(first).forms[0].captureId;
    const page = first.pages[0];
    page.frames[0].component.components.reverse();
    const second = normalizePageCaptureIds(first);
    assert.equal(extractPageCaptureSchema(second).forms[0].captureId, captureId);
    assert.equal(extractPageCaptureSchema(second).forms[0].fields[0].required, true);
  } finally { editor.destroy(); }
});
