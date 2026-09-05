import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateFormAnswers } from './form-answer-validation.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const TYPES = new Set([
  'short_text', 'long_text', 'email', 'phone', 'single_choice', 'multiple_choice',
  'image_choice', 'image', 'video', 'date', 'number', 'scale', 'address', 'file', 'cta', 'statement', 'chart', 'loader',
  'logo', 'progress', 'countdown', 'timer',
]);
const MOTIONS = new Set(['none', 'fade-up', 'slide-left', 'zoom-in', 'float']);
const INFORMATIONAL = new Set(['image', 'video', 'cta', 'statement', 'chart', 'loader', 'logo', 'progress', 'countdown', 'timer']);
const HEADER_TYPES = new Set(['logo', 'progress', 'countdown', 'timer', 'statement', 'image', 'video', 'chart', 'cta', 'loader']);
const icon = (value) => (/^[a-z_]{2,40}$/.test(String(value || ''))) ? String(value) : 'arrow_forward';
const boundedNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
};
const safeUrl = (value, label = 'Endereço') => {
  const result = text(value, 2000, label);
  if (!result) return '';
  let url;
  try { url = new URL(result); } catch { throw fail(`${label} inválido.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail(`${label} inválido.`);
  return result;
};
const text = (value, max, label, required = false) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw fail(label + ' inválido.');
  return value.trim();
};
const slugify = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'formulario';

function normalizeCompletion(value = {}) {
  return {
    title: text(value.title ?? 'Obrigado!', 120, 'Título de conclusão', true),
    message: text(value.message ?? 'Recebemos suas respostas.', 500, 'Mensagem de conclusão', true),
  };
}

function normalizeWebhook(value) {
  const result = text(value, 2000, 'Webhook');
  if (!result) return '';
  let url;
  try {
    url = new URL(result);
  } catch {
    throw fail('Informe um webhook HTTPS válido.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('Informe um webhook HTTPS válido.');
  return result;
}

function normalizeElement(input, ids) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Elemento inválido.');
  const id = text(input.id || randomUUID(), 80, 'Identificador do elemento', true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id))
    throw fail('Identificador de elemento inválido ou repetido.');
  ids.add(id);
  const type = TYPES.has(input.type) ? input.type : 'short_text';
  const element = {
    id,
    type,
    title: text(input.title || (INFORMATIONAL.has(type) ? 'Novo conteúdo' : 'Nova pergunta'), 180, 'Título', true),
    description: text(input.description, 1200, 'Descrição'),
    required: INFORMATIONAL.has(type) ? false : Boolean(input.required),
    placeholder: text(input.placeholder, 160, 'Texto de exemplo'),
    icon: icon(input.icon),
  };
  if (['single_choice', 'multiple_choice', 'image_choice'].includes(type)) {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 20)
      throw fail('A escolha precisa de 2 a 20 opções.');
    element.options = input.options.map((option) => {
      if (type !== 'image_choice' || typeof option === 'string') return type === 'image_choice'
        ? { label: text(option, 120, 'Opção', true), imageUrl: '', icon: 'radio_button_checked' }
        : text(option, 120, 'Opção', true);
      return {
        label: text(option.label, 120, 'Opção', true),
        imageUrl: safeUrl(option.imageUrl, 'Endereço da imagem'),
        icon: icon(option.icon || 'radio_button_checked'),
      };
    });
    const labels = element.options.map((option) => typeof option === 'string' ? option : option.label);
    if (new Set(labels).size !== labels.length) throw fail('As opções não podem se repetir.');
  } else element.options = [];
  element.mediaUrl = ['image', 'video', 'logo'].includes(type) ? safeUrl(input.mediaUrl, 'Endereço da mídia') : '';
  element.altText = type === 'logo' ? text(input.altText || input.title || 'Logo', 160, 'Texto alternativo', true) : '';
  element.width = type === 'logo' ? boundedNumber(input.width, 120, 24, 600) : 0;
  element.showValue = type === 'progress' ? Boolean(input.showValue) : false;
  if (type === 'countdown') {
    const target = text(input.targetAt, 80, 'Data final');
    if (target && !Number.isFinite(Date.parse(target))) throw fail('Data final do countdown inválida.');
    const duration = input.duration === undefined ? 300 : Number(input.duration);
    if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration < 1 || duration > 31_536_000)
      throw fail('Informe uma duração de countdown entre 1 segundo e 1 ano.');
    element.targetAt = target ? new Date(target).toISOString() : '';
    element.duration = duration;
    element.completionLabel = text(input.completionLabel || 'Tempo encerrado', 120, 'Mensagem ao encerrar', true);
  } else {
    element.targetAt = '';
    element.duration = 0;
    element.completionLabel = '';
  }
  if (type === 'timer') {
    const duration = input.durationSeconds === undefined ? 60 : Number(input.durationSeconds);
    if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration < 1 || duration > 86_400)
      throw fail('Informe uma duração entre 1 e 86400 segundos.');
    element.durationSeconds = duration;
    element.timerDirection = input.timerDirection === 'up' ? 'up' : 'down';
    element.autoStart = input.autoStart === undefined ? true : Boolean(input.autoStart);
  } else {
    element.durationSeconds = 0;
    element.timerDirection = 'down';
    element.autoStart = false;
  }
  element.buttonLabel = type === 'cta' ? text(input.buttonLabel || 'Continuar', 80, 'Texto do botão', true) : '';
  element.buttonUrl = type === 'cta' ? safeUrl(input.buttonUrl, 'Endereço do botão') : '';
  element.range = type === 'scale'
    ? { min: boundedNumber(input.range?.min ?? input.min, 1, 0, 100), max: boundedNumber(input.range?.max ?? input.max, 10, 1, 100) }
    : { min: 1, max: 10 };
  if (element.range.max <= element.range.min) throw fail('O final da escala precisa ser maior que o início.');
  if (type === 'chart') {
    const chart = input.chart && typeof input.chart === 'object' ? input.chart : {};
    const labels = Array.isArray(chart.labels) ? chart.labels.slice(0, 8).map((item) => text(item, 40, 'Rótulo do gráfico', true)) : [];
    const values = Array.isArray(chart.values) ? chart.values.slice(0, 8).map((item) => boundedNumber(item, 0, 0, 100)) : [];
    if (labels.length < 2 || labels.length !== values.length) throw fail('O gráfico precisa de 2 a 8 rótulos e valores.');
    element.chart = { type: chart.type === 'donut' ? 'donut' : 'bar', labels, values };
  } else element.chart = { type: 'bar', labels: [], values: [] };
  return element;
}

const DEFAULT_HEADER_ELEMENTS = Object.freeze([
  Object.freeze({ id: 'logo', type: 'logo', title: 'Sua marca', mediaUrl: '', altText: 'Logo', width: 120 }),
  Object.freeze({ id: 'progresso', type: 'progress', title: 'Progresso', showValue: false }),
]);

export function normalizeHeaderElements(value) {
  const source = value === undefined ? DEFAULT_HEADER_ELEMENTS : value;
  if (!Array.isArray(source) || source.length > 12) throw fail('A camada fixa aceita até 12 elementos.');
  const ids = new Set();
  return source.map((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !HEADER_TYPES.has(input.type))
      throw fail('Tipo de elemento inválido para a camada fixa.');
    return normalizeElement(input, ids);
  });
}

function withCompatibleHeader(form) {
  return { ...form, headerElements: normalizeHeaderElements(form.headerElements) };
}

export function normalizeSteps(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw fail('Adicione de 1 a 50 etapas.');
  const ids = new Set();
  return value.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Etapa inválida.');
    if (Array.isArray(input.elements)) {
      const id = text(input.id || randomUUID(), 80, 'Identificador da tela', true);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(`screen:${id}`))
        throw fail('Identificador de tela inválido ou repetido.');
      ids.add(`screen:${id}`);
      if (!input.elements.length || input.elements.length > 30) throw fail('Adicione de 1 a 30 elementos por tela.');
      return {
        id,
        title: text(input.title || `Tela ${index + 1}`, 100, 'Nome da tela', true),
        motion: MOTIONS.has(input.motion) ? input.motion : 'fade-up',
        autoAdvance: Boolean(input.autoAdvance),
        timer: boundedNumber(input.timer, 0, 0, 15),
        elements: input.elements.map((element) => normalizeElement(element, ids)),
      };
    }
    return { ...normalizeElement(input, ids), motion: MOTIONS.has(input.motion) ? input.motion : 'fade-up' };
  });
}

export function normalizeFormInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Formulário inválido.');
  return {
    headerElements: normalizeHeaderElements(value.headerElements),
    steps: normalizeSteps(value.steps),
    completion: normalizeCompletion(value.completion),
    webhook: normalizeWebhook(value.webhook),
  };
}

export class FormStore {
  constructor(dir) {
    this.dir = dir;
    this.formsFile = join(dir, 'forms.json');
    this.submissionsFile = join(dir, 'form-submissions.json');
    this.queue = Promise.resolve();
  }
  validId(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('Formulário inválido.');
  }
  async read(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  run(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async write(file, rows) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = join(this.dir, randomUUID() + '.tmp');
    await writeFile(temp, JSON.stringify(rows), { mode: 0o600 });
    await rename(temp, file);
  }
  async list() {
    return this.run(async () => {
      const [forms, submissions] = await Promise.all([this.read(this.formsFile), this.read(this.submissionsFile)]);
      return forms.map(({ steps, ...form }) => ({
        ...withCompatibleHeader(form),
        stepCount: steps.length,
        submissionCount: submissions.filter((row) => row.formId === form.id).length,
      }));
    });
  }
  async get(id) {
    this.validId(id);
    return this.run(async () => {
      const form = (await this.read(this.formsFile)).find((row) => row.id === id);
      if (!form) throw fail('Formulário não encontrado.', 404);
      return structuredClone(withCompatibleHeader(form));
    });
  }
  async getBySlug(slug) {
    if (!/^[a-z0-9-]{3,90}$/.test(slug)) throw fail('Formulário não encontrado.', 404);
    return this.run(async () => {
      const form = (await this.read(this.formsFile)).find((row) => row.slug === slug);
      if (!form) throw fail('Formulário não encontrado.', 404);
      return structuredClone(withCompatibleHeader(form));
    });
  }
  async create({ name }) {
    const cleanName = text(name, 100, 'Nome', true);
    return this.run(async () => {
      const rows = await this.read(this.formsFile);
      const id = randomUUID();
      const now = new Date().toISOString();
      const form = {
        id,
        name: cleanName,
        slug: `${slugify(cleanName)}-${id.slice(0, 8)}`,
        ...normalizeFormInput({ steps: [{ id: 'inicio', title: 'Boas-vindas', motion: 'fade-up', elements: [
          { id: 'apresentacao', type: 'statement', title: 'Vamos conhecer você?', description: 'Responda os campos abaixo para começar.', icon: 'waving_hand' },
          { id: 'nome', type: 'short_text', title: 'Seu nome', required: true, placeholder: 'Como podemos chamar você?' },
          { id: 'telefone', type: 'phone', title: 'WhatsApp', required: true, placeholder: 'DDD + número' },
          { id: 'canal', type: 'image_choice', title: 'Como prefere conversar?', required: true, options: [
            { label: 'WhatsApp', icon: 'chat', imageUrl: '' }, { label: 'Ligação', icon: 'call', imageUrl: '' },
          ] },
        ] }] }),
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(form);
      await this.write(this.formsFile, rows);
      return structuredClone(form);
    });
  }
  async update(id, patch) {
    this.validId(id);
    return this.run(async () => {
      const rows = await this.read(this.formsFile);
      const form = rows.find((row) => row.id === id);
      if (!form) throw fail('Formulário não encontrado.', 404);
      if (patch.revision !== form.revision) throw fail('O formulário mudou em outra aba. Reabra antes de salvar.', 409);
      if (patch.name !== undefined) form.name = text(patch.name, 100, 'Nome', true);
      Object.assign(form, normalizeFormInput({
        headerElements: patch.headerElements === undefined ? form.headerElements : patch.headerElements,
        steps: patch.steps === undefined ? form.steps : patch.steps,
        completion: patch.completion === undefined ? form.completion : patch.completion,
        webhook: patch.webhook === undefined ? form.webhook : patch.webhook,
      }));
      form.revision++;
      form.updatedAt = new Date().toISOString();
      await this.write(this.formsFile, rows);
      return structuredClone(form);
    });
  }
  async duplicate(id) {
    this.validId(id);
    return this.run(async () => {
      const rows = await this.read(this.formsFile);
      const source = rows.find((row) => row.id === id);
      if (!source) throw fail('Formulário não encontrado.', 404);
      const copyId = randomUUID();
      const now = new Date().toISOString();
      const copy = {
        ...structuredClone(withCompatibleHeader(source)),
        id: copyId,
        name: (source.name + ' — cópia').slice(0, 100),
        slug: `${slugify(source.name)}-copia-${copyId.slice(0, 8)}`,
        webhook: '',
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(copy);
      await this.write(this.formsFile, rows);
      return structuredClone(copy);
    });
  }
  async remove(id) {
    this.validId(id);
    return this.run(async () => {
      const rows = await this.read(this.formsFile);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw fail('Formulário não encontrado.', 404);
      const [removed] = rows.splice(index, 1);
      const submissions = (await this.read(this.submissionsFile)).filter((row) => row.formId !== id);
      await Promise.all([this.write(this.formsFile, rows), this.write(this.submissionsFile, submissions)]);
      return structuredClone(removed);
    });
  }
  async submit(id, input) {
    this.validId(id);
    return this.run(async () => {
      const form = (await this.read(this.formsFile)).find((row) => row.id === id);
      if (!form) throw fail('Formulário não encontrado.', 404);
      const answers = validateFormAnswers(form, input);
      const submission = { id: randomUUID(), formId: id, answers, submittedAt: new Date().toISOString() };
      const rows = await this.read(this.submissionsFile);
      rows.push(submission);
      await this.write(this.submissionsFile, rows);
      return structuredClone(submission);
    });
  }
  async submissions(id) {
    this.validId(id);
    return this.run(async () => {
      const form = (await this.read(this.formsFile)).find((row) => row.id === id);
      if (!form) throw fail('Formulário não encontrado.', 404);
      return (await this.read(this.submissionsFile))
        .filter((row) => row.formId === id)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    });
  }
}
