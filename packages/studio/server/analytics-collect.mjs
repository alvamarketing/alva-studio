const MAX_BODY_BYTES = 64 * 1024;
const WINDOW_MS = 60_000;

const EVENT_NAMES = new Set([
  'pageview',
  'form_start',
  'form_step',
  'form_submit_attempt',
  'vsl_start',
  'vsl_progress',
  'vsl_complete',
  'vsl_cta_click',
  'vsl_error',
]);

const ALLOWED_KEYS = new Set(['trackerPublicId', 'event_name', 'url_path', 'url_query', 'referrer']);

// As 5 UTMs mais os click ids capturáveis a partir da URL (spec seção C); fbp/fbc/ttp são
// derivados de cookie, não de URL, e não entram aqui.
const ALLOWED_QUERY_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id',
]);

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Uma sequência de dígitos (com separadores comuns de telefone) de 10 dígitos ou mais.
// Curta o bastante para não pegar IDs de rota de poucos dígitos, longa o bastante para pegar
// telefones em qualquer formatação (BR/E.164/parênteses).
const PHONE_CANDIDATE_PATTERN = /[+(]?\d[\d\s().-]{7,}\d/g;

function containsPii(value) {
  const text = String(value ?? '');
  if (EMAIL_PATTERN.test(text)) return true;
  const candidates = text.match(PHONE_CANDIDATE_PATTERN) || [];
  return candidates.some((candidate) => (candidate.match(/\d/g) || []).length >= 10);
}

// Checa PII no valor decodificado de cada chave, antes do URLSearchParams re-serializar e
// percent-encode caracteres como '@', '+' e espaço — checar a string final re-codificada deixaria
// e-mail e telefone passarem disfarçados de %40 e %2B.
function filterQueryParams(rawQuery) {
  const value = String(rawQuery ?? '').replace(/^\?/, '');
  if (!value) return '';
  const filtered = new URLSearchParams();
  for (const [key, val] of new URLSearchParams(value)) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) continue;
    if (containsPii(val)) throw fail('url_query não pode conter dado pessoal.', 400);
    filtered.append(key, val);
  }
  return filtered.toString();
}

function fail(message, status) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function acceptedContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' || type === 'text/plain';
}

// raw pode ser Buffer (corpo já lido pelo servidor) ou string (uso direto em teste);
// o teto de 64 KB é sempre medido em bytes, nunca em caracteres.
export function parseCollectPayload(raw, contentType) {
  if (!acceptedContentType(contentType)) throw fail('Envie application/json ou text/plain.', 415);

  const bytes = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(String(raw ?? ''), 'utf8');
  if (bytes > MAX_BODY_BYTES) throw fail('Corpo muito grande.', 413);

  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
  let payload;
  try {
    payload = JSON.parse(text || '{}');
  } catch {
    throw fail('JSON inválido.', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Corpo inválido.', 400);

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) throw fail(`Campo não permitido: ${key}.`, 400);
  }

  const { trackerPublicId, event_name: eventName, url_path: urlPath, url_query: urlQuery, referrer } = payload;
  if (typeof trackerPublicId !== 'string' || !trackerPublicId.trim()) throw fail('Informe o identificador do tracker.', 400);
  if (typeof eventName !== 'string' || !EVENT_NAMES.has(eventName)) throw fail('event_name inválido.', 400);

  const event = { event_name: eventName };
  if (urlPath !== undefined) {
    if (typeof urlPath !== 'string') throw fail('url_path inválido.', 400);
    if (containsPii(urlPath)) throw fail('url_path não pode conter dado pessoal.', 400);
    event.url_path = urlPath;
  }
  if (urlQuery !== undefined) {
    if (typeof urlQuery !== 'string') throw fail('url_query inválido.', 400);
    // Filtra às chaves permitidas antes de checar PII: isso já derruba `?email=...`, `?telefone=...`
    // etc. de propósito; o regex cobre o caso restante de PII embutida dentro de um valor permitido.
    const filtered = filterQueryParams(urlQuery);
    if (containsPii(filtered)) throw fail('url_query não pode conter dado pessoal.', 400);
    event.url_query = filtered;
  }
  if (referrer !== undefined) {
    if (typeof referrer !== 'string') throw fail('referrer inválido.', 400);
    if (containsPii(referrer)) throw fail('referrer não pode conter dado pessoal.', 400);
    event.referrer = referrer;
  }
  return { trackerPublicId, event };
}

// Duas dimensões independentes, nenhuma delas o limitador de login de auth.mjs (que é só por IP
// e tem teto global de 1024 entradas, insuficiente para tráfego público de coletor):
// - por tracker_public_id: teto de eventos por tracker, para não deixar um site autêntico
//   inundar sua própria fila.
// - por IP: teto de chamadas totais e de trackers *distintos* vistos a partir do mesmo IP, para
//   barrar quem não conhece nenhum tracker_public_id real e tenta descobrir um por força bruta —
//   essa checagem deve ser chamada pelo index.mjs com só {ip}, antes de ler/parsear o corpo.
// Nenhum dos dois Maps cresce sem limite: ao passar do teto de chaves, descarta a mais antiga.
export function createCollectLimiter({
  now = () => Date.now(),
  maxPerMinute = 60,
  maxTrackers = 10_000,
  maxPerMinutePerIp = 120,
  maxIps = 20_000,
  maxTrackersPerIp = 20,
} = {}) {
  const trackerBuckets = new Map();
  const ipBuckets = new Map();
  return {
    allow({ ip, trackerPublicId } = {}) {
      const time = now();
      if (ip !== undefined) {
        let ipBucket = ipBuckets.get(ip);
        if (ipBucket) ipBuckets.delete(ip);
        if (!ipBucket || time - ipBucket.windowStart >= WINDOW_MS) ipBucket = { count: 0, windowStart: time, trackers: new Set() };
        ipBucket.count += 1;
        if (trackerPublicId !== undefined) ipBucket.trackers.add(trackerPublicId);
        ipBuckets.set(ip, ipBucket);
        while (ipBuckets.size > maxIps) ipBuckets.delete(ipBuckets.keys().next().value);
        if (ipBucket.count > maxPerMinutePerIp) return false;
        if (ipBucket.trackers.size > maxTrackersPerIp) return false;
      }
      if (trackerPublicId !== undefined) {
        let bucket = trackerBuckets.get(trackerPublicId);
        if (bucket) trackerBuckets.delete(trackerPublicId);
        if (!bucket || time - bucket.windowStart >= WINDOW_MS) bucket = { count: 0, windowStart: time };
        bucket.count += 1;
        trackerBuckets.set(trackerPublicId, bucket);
        while (trackerBuckets.size > maxTrackers) trackerBuckets.delete(trackerBuckets.keys().next().value);
        if (bucket.count > maxPerMinute) return false;
      }
      return true;
    },
    size() {
      return trackerBuckets.size;
    },
    ipSize() {
      return ipBuckets.size;
    },
  };
}
