const INFORMATIONAL = new Set(['image', 'video', 'cta', 'statement', 'chart', 'loader', 'logo', 'progress', 'countdown', 'timer']);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function text(value, max, label, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw fail(`${label} inválido.`);
  return value.trim();
}

export function validateFormAnswers(schema, input) {
  const answers = {};
  const provided = input?.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : {};
  const fields = Array.isArray(schema?.steps)
    ? schema.steps.flatMap((step) => Array.isArray(step?.elements) ? step.elements : [step])
    : [];
  if (!fields.length) throw fail('Formulário publicado inválido.', 409);
  for (const step of fields) {
    if (!step || typeof step !== 'object' || typeof step.id !== 'string') throw fail('Formulário publicado inválido.', 409);
    if (INFORMATIONAL.has(step.type)) { answers[step.id] = ''; continue; }
    if (step.type === 'multiple_choice') {
      const values = Array.isArray(provided[step.id]) ? provided[step.id] : provided[step.id] ? [provided[step.id]] : [];
      const clean = [...new Set(values.map((value) => text(value, 120, 'Resposta', true)))];
      if (step.required && !clean.length) throw fail(`Responda “${step.title}”.`);
      if (clean.some((value) => !(step.options ?? []).includes(value))) throw fail('Escolha respostas válidas.');
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
      if (typeof file !== 'object' || Array.isArray(file)) throw fail('Arquivo inválido.');
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
    const allowedOptions = (step.options ?? []).map((option) => typeof option === 'string' ? option : option.label);
    if (['single_choice', 'image_choice'].includes(step.type) && value && !allowedOptions.includes(value)) throw fail('Escolha uma resposta válida.');
    if (step.type === 'number' && value && !Number.isFinite(Number(value))) throw fail('Informe um número válido.');
    if (step.type === 'scale' && value) {
      const scale = Number(value);
      const minimum = Number(step.range?.min);
      const maximum = Number(step.range?.max);
      if (!Number.isFinite(scale) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || scale < minimum || scale > maximum)
        throw fail('Escolha um valor válido na escala.');
    }
    answers[step.id] = value;
  }
  return answers;
}
