const EVENT_NAMES = new Set([
  'form_start', 'form_step', 'form_submit_attempt',
  'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click', 'vsl_error',
]);
const PAYLOAD_FIELDS = new Set(['website', 'hostname', 'url', 'referrer', 'screen', 'language', 'title', 'tag', 'id', 'name', 'data']);
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_PATTERN = /[+(]?\d[\d\s().-]{7,}\d/g;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function containsPii(value) {
  let text = String(value ?? '');
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch { break; }
  }
  if (EMAIL_PATTERN.test(text)) return true;
  return (text.match(PHONE_PATTERN) || []).some((candidate) => (candidate.match(/\d/g) || []).length >= 10);
}

function string(value, field, { optional = false, max = 2048 } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value || value.length > max || containsPii(value)) throw fail(`${field} inválido.`);
  return value;
}

function eventData(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('data inválido.');
  const keys = Object.keys(value);
  if (keys.length > 4 || keys.some((key) => !['formId', 'screenId', 'stepIndex', 'publicId', 'versionNumber', 'value'].includes(key))) throw fail('data inválido.');
  const opaque = (item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(item) && !containsPii(item);
  if (value.formId !== undefined && !opaque(value.formId)) throw fail('data inválido.');
  if (value.screenId !== undefined && !opaque(value.screenId)) throw fail('data inválido.');
  if (value.publicId !== undefined && !opaque(value.publicId)) throw fail('data inválido.');
  for (const key of ['stepIndex', 'versionNumber', 'value']) if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 1000000)) throw fail('data inválido.');
  return Object.fromEntries(Object.entries(value));
}

// O tracker oficial do Umami recebe um token público local como website. Este adaptador
// valida a telemetria permitida e substitui o token somente dentro da rede privada.
export function normalizeUmamiGatewayPayload(input, { publicToken, remoteWebsiteId } = {}) {
  if (!input || input.type !== 'event' || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw fail('Evento Umami inválido.');
  const payload = input.payload;
  if (payload.website !== publicToken) throw fail('Evento Umami inválido.');
  if (typeof remoteWebsiteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(remoteWebsiteId)) throw fail('Rastreamento indisponível.', 503);

  const output = { website: remoteWebsiteId };
  for (const key of PAYLOAD_FIELDS) {
    if (key === 'website' || payload[key] === undefined) continue;
    if (key === 'data') { output.data = eventData(payload.data); continue; }
    if (key === 'name') {
      if (!EVENT_NAMES.has(payload.name)) throw fail('Evento Umami inválido.');
      output.name = payload.name;
      continue;
    }
    if (key === 'url' || key === 'referrer') {
      if (key === 'referrer' && payload.referrer === '') { output.referrer = ''; continue; }
      const value = string(payload[key], key, { optional: key === 'referrer' });
      if (value === undefined) continue;
      let url;
      try { url = new URL(value); } catch { throw fail(`${key} inválido.`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail(`${key} inválido.`);
      output[key] = value;
      continue;
    }
    output[key] = string(payload[key], key, { optional: true, max: 200 });
  }
  if (!output.hostname || !output.url) throw fail('Evento Umami inválido.');
  return { type: 'event', payload: output };
}
