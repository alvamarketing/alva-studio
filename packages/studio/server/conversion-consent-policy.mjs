import { createHash } from 'node:crypto';

const STATES = new Set(['pending', 'denied', 'granted']);
const PROVIDERS = new Set(['meta', 'google', 'tiktok', 'linkedin', 'taboola']);
const EVENT_NAMES = new Set(['lead', 'initiate_checkout', 'purchase', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click']);
const ATTRIBUTION = Object.freeze({
  meta: Object.freeze({ fbc: 'fbc', fbp: 'fbp' }),
  google: Object.freeze({ gclid: 'gclid', gbraid: 'gbraid', wbraid: 'wbraid' }),
  tiktok: Object.freeze({ ttclid: 'ttclid' }),
  linkedin: Object.freeze({ li_fat_id: 'linkedin_tracking_uuid' }),
  taboola: Object.freeze({ tblci: 'taboola_click_id' }),
});
const ALL_ATTRIBUTION = new Set(Object.values(ATTRIBUTION).flatMap((value) => Object.keys(value)));
const IGNORED_BROWSER_FIELDS = new Set(['consent', 'consentState', 'user', 'hash', 'hashes', 'ip', 'userAgent']);
const BROWSER_FIELDS = new Set(['trackingEventId', 'eventName', 'eventTime', 'contentId', 'value', 'currency', 'attribution', ...IGNORED_BROWSER_FIELDS]);
const SCOPE_FIELDS = Object.freeze(['companyId', 'projectId', 'publicationId', 'snapshotHash', 'policyVersion', 'origin', 'domain', 'environment']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) { throw Object.assign(new Error(message), { status: 400, statusCode: 400 }); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function text(value, max = 255) { return typeof value === 'string' && value.length > 0 && value.length <= max; }

export function consentScope(manifest) {
  if (!manifest || SCOPE_FIELDS.some((field) => manifest[field] === undefined || manifest[field] === null)) fail('Manifesto de consentimento inválido.');
  return Object.fromEntries(SCOPE_FIELDS.map((field) => [field, manifest[field]]));
}

export function resolveConsentState({ manifest, storedConsent } = {}) {
  const current = consentScope(manifest);
  if (!storedConsent || !STATES.has(storedConsent.state) || !storedConsent.scope || SCOPE_FIELDS.some((field) => storedConsent.scope[field] !== current[field])) return 'pending';
  return storedConsent.state;
}

function normalizedContact(answers = {}) {
  const values = Object.entries(answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {});
  const email = values.find(([key, value]) => /e-?mail/i.test(key) && typeof value === 'string')?.[1]?.trim().toLowerCase() || '';
  const phone = values.find(([key, value]) => /(telefone|phone|celular|whatsapp)/i.test(key) && typeof value === 'string')?.[1]?.replace(/\D/g, '') || '';
  return Object.fromEntries([
    ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [['email_sha256', hash(email)]] : []),
    ...(phone.length >= 8 && phone.length <= 15 ? [['phone_sha256', hash(phone)]] : []),
  ]);
}

function browserEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !BROWSER_FIELDS.has(key))) fail('Campo de navegador inválido.');
  if (!UUID.test(value.trackingEventId || '') || !EVENT_NAMES.has(value.eventName) || !Number.isInteger(value.eventTime) || !text(value.contentId, 120) || (value.value !== undefined && (!Number.isFinite(value.value) || value.value < 0)) || (value.currency !== undefined && !/^[A-Z]{3}$/.test(value.currency))) fail('Evento comercial inválido.');
  const attribution = value.attribution === undefined ? {} : value.attribution;
  if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution) || Object.keys(attribution).some((key) => !ALL_ATTRIBUTION.has(key) || !text(attribution[key], 512))) fail('Identificadores de atribuição inválidos.');
  return {
    tracking_event_id: value.trackingEventId,
    event_name: value.eventName,
    event_time: value.eventTime,
    content_id: value.contentId,
    ...(value.value === undefined ? {} : { value: value.value }),
    ...(value.currency === undefined ? {} : { currency: value.currency }),
    attribution,
  };
}

function providerAttribution(provider, attribution) {
  return Object.fromEntries(Object.entries(ATTRIBUTION[provider]).flatMap(([source, destination]) => text(attribution[source], 512) ? [[destination, attribution[source]]] : []));
}

export function buildProviderConversion({ provider, manifest, consentState, browserEvent: rawEvent, serverAnswers = {} } = {}) {
  consentScope(manifest);
  if (!PROVIDERS.has(provider)) fail('Adaptador de conversão inválido.');
  if (!STATES.has(consentState)) fail('Estado de consentimento inválido.');
  const event = browserEvent(rawEvent);
  const payload = {
    tracking_event_id: event.tracking_event_id,
    event_name: event.event_name,
    event_time: event.event_time,
    content_id: event.content_id,
    ...(event.value === undefined ? {} : { value: event.value }),
    ...(event.currency === undefined ? {} : { currency: event.currency }),
    consent_state: consentState,
    attribution: providerAttribution(provider, event.attribution),
  };
  if (provider === 'google') payload.google_consent = Object.fromEntries(['ad_user_data', 'ad_personalization', 'ad_storage', 'analytics_storage'].map((signal) => [signal, consentState === 'granted' ? 'granted' : 'denied']));
  if (consentState === 'granted') {
    const user = normalizedContact(serverAnswers);
    if (Object.keys(user).length) payload.user = user;
  }
  return payload;
}

export function buildNvsConversion({ manifest, consentState, browserEvent: rawEvent, serverAnswers = {} } = {}) {
  consentScope(manifest);
  if (!STATES.has(consentState)) fail('Estado de consentimento inválido.');
  const event = browserEvent(rawEvent);
  const payload = {
    tracking_event_id: event.tracking_event_id,
    event_name: event.event_name,
    event_time: event.event_time,
    content_id: event.content_id,
    ...(event.value === undefined ? {} : { value: event.value }),
    ...(event.currency === undefined ? {} : { currency: event.currency }),
    consent_state: consentState,
    attribution: event.attribution,
  };
  if (consentState === 'granted') {
    const user = normalizedContact(serverAnswers);
    if (Object.keys(user).length) payload.user = user;
  }
  return payload;
}

export const CONSENT_STATES = Object.freeze([...STATES]);
export const PROVIDER_ATTRIBUTION_ALLOWLIST = ATTRIBUTION;
export const CONVERSION_PROVIDERS = Object.freeze([...PROVIDERS]);
