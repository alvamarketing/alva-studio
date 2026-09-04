import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const TYPES = new Set([
  'short_text', 'long_text', 'email', 'phone', 'single_choice', 'multiple_choice',
  'image', 'video', 'date', 'number', 'scale', 'address', 'file', 'cta', 'statement', 'chart',
]);
const MOTIONS = new Set(['none', 'fade-up', 'slide-left', 'zoom-in', 'float']);
const INFORMATIONAL = new Set(['image', 'video', 'cta', 'statement', 'chart']);
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

export function normalizeSteps(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw fail('Adicione de 1 a 50 etapas.');
  const ids = new Set();
  return value.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Etapa inválida.');
    const id = text(input.id || randomUUID(), 80, 'Identificador da etapa', true);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id))
      throw fail('Identificador de etapa inválido ou repetido.');
    ids.add(id);
    const type = TYPES.has(input.type) ? input.type : 'short_text';
    const step = {
      id,
      type,
      title: text(input.title, 180, 'Pergunta', true),
      description: text(input.description, 500, 'Descrição'),
      required: INFORMATIONAL.has(type) ? false : Boolean(input.required),
      placeholder: text(input.placeholder, 160, 'Texto de exemplo'),
      icon: icon(input.icon),
      motion: MOTIONS.has(input.motion) ? input.motion : 'fade-up',
    };
    if (type === 'single_choice' || type === 'multiple_choice') {
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 20)
        throw fail('A escolha precisa de 2 a 20 opções.');
      step.options = input.options.map((option) => text(option, 120, 'Opção', true));
      if (new Set(step.options).size !== step.options.length) throw fail('As opções não podem se repetir.');
    } else step.options = [];
    step.mediaUrl = ['image', 'video'].includes(type) ? safeUrl(input.mediaUrl, 'Endereço da mídia') : '';
    step.buttonLabel = type === 'cta' ? text(input.buttonLabel || 'Continuar', 80, 'Texto do botão', true) : '';
    step.buttonUrl = type === 'cta' ? safeUrl(input.buttonUrl, 'Endereço do botão') : '';
    step.range = type === 'scale'
      ? { min: boundedNumber(input.range?.min ?? input.min, 1, 0, 100), max: boundedNumber(input.range?.max ?? input.max, 10, 1, 100) }
      : { min: 1, max: 10 };
    if (step.range.max <= step.range.min) throw fail('O final da escala precisa ser maior que o início.');
    if (type === 'chart') {
      const chart = input.chart && typeof input.chart === 'object' ? input.chart : {};
      const labels = Array.isArray(chart.labels) ? chart.labels.slice(0, 8).map((item) => text(item, 40, 'Rótulo do gráfico', true)) : [];
      const values = Array.isArray(chart.values) ? chart.values.slice(0, 8).map((item) => boundedNumber(item, 0, 0, 100)) : [];
      if (labels.length < 2 || labels.length !== values.length) throw fail('O gráfico precisa de 2 a 8 rótulos e valores.');
      step.chart = { type: chart.type === 'donut' ? 'donut' : 'bar', labels, values };
    } else step.chart = { type: 'bar', labels: [], values: [] };
    return step;
  });
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
        ...form,
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
      return structuredClone(form);
    });
  }
  async getBySlug(slug) {
    if (!/^[a-z0-9-]{3,90}$/.test(slug)) throw fail('Formulário não encontrado.', 404);
    return this.run(async () => {
      const form = (await this.read(this.formsFile)).find((row) => row.slug === slug);
      if (!form) throw fail('Formulário não encontrado.', 404);
      return structuredClone(form);
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
        steps: normalizeSteps([
          {
            id: 'nome',
            type: 'short_text',
            title: 'Como podemos chamar você?',
            required: true,
            placeholder: 'Digite seu nome',
          },
        ]),
        completion: normalizeCompletion(),
        webhook: '',
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
      if (patch.steps !== undefined) form.steps = normalizeSteps(patch.steps);
      if (patch.completion !== undefined) form.completion = normalizeCompletion(patch.completion);
      if (patch.webhook !== undefined) {
        form.webhook = text(patch.webhook, 2000, 'Webhook');
        if (form.webhook) {
          let url;
          try {
            url = new URL(form.webhook);
          } catch {
            throw fail('Informe um webhook HTTPS válido.');
          }
          if (url.protocol !== 'https:' || url.username || url.password) throw fail('Informe um webhook HTTPS válido.');
        }
      }
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
        ...structuredClone(source),
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
      const answers = {};
      const provided = input?.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : {};
      for (const step of form.steps) {
        if (INFORMATIONAL.has(step.type)) { answers[step.id] = ''; continue; }
        if (step.type === 'multiple_choice') {
          const values = Array.isArray(provided[step.id]) ? provided[step.id] : provided[step.id] ? [provided[step.id]] : [];
          const clean = [...new Set(values.map((value) => text(value, 120, 'Resposta', true)))];
          if (step.required && !clean.length) throw fail(`Responda “${step.title}”.`);
          if (clean.some((value) => !step.options.includes(value))) throw fail('Escolha respostas válidas.');
          answers[step.id] = clean;
          continue;
        }
        if (step.type === 'file') {
          const file = provided[step.id];
          if (!file) {
            if (step.required) throw fail(`Responda “${step.title}”.`);
            answers[step.id] = '';
            continue;
          }
          if (!file || typeof file !== 'object' || Array.isArray(file)) throw fail('Arquivo inválido.');
          const name = text(file.name, 180, 'Nome do arquivo', true).replace(/[\\/]/g, '-');
          const type = text(file.type, 100, 'Tipo do arquivo', true);
          const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
          if (!allowed.has(type)) throw fail('Use uma imagem, PDF ou documento válido.');
          const data = text(file.data, 4_300_000, 'Conteúdo do arquivo', true);
          if (!data.startsWith(`data:${type};base64,`) || !/^data:[^;,]+;base64,[a-z0-9+/=]+$/i.test(data)) throw fail('Arquivo inválido.');
          answers[step.id] = { name, type, data };
          continue;
        }
        const value = text(provided[step.id], step.type === 'long_text' || step.type === 'address' ? 3000 : 1000, 'Resposta');
        if (step.required && !value) throw fail(`Responda “${step.title}”.`);
        if (step.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw fail('Informe um e-mail válido.');
        if (step.type === 'single_choice' && value && !step.options.includes(value)) throw fail('Escolha uma resposta válida.');
        if (step.type === 'number' && value && !Number.isFinite(Number(value))) throw fail('Informe um número válido.');
        if (step.type === 'scale' && value && (Number(value) < step.range.min || Number(value) > step.range.max)) throw fail('Escolha um valor válido na escala.');
        answers[step.id] = value;
      }
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
