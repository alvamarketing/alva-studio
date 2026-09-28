const ALLOWED_QUERY_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id',
]);

function filteredQueryString(search) {
  const params = new URLSearchParams(search || '');
  const query = new URLSearchParams();
  for (const key of ALLOWED_QUERY_KEYS) {
    const found = params.get(key);
    if (found) query.set(key, found);
  }
  return query.toString();
}

function referrerOrigin(referrer) {
  if (!referrer) return '';
  try { return new URL(referrer).origin; } catch { return ''; }
}

// Formato plano exigido por parseCollectPayload (server/analytics-collect.mjs): allowlist fechada
// de chaves no nível raiz, sem aninhamento — trackerPublicId, event_name, url_path, url_query, referrer.
function buildPayload({ trackerPublicId, location, document: doc, eventName, eventData }) {
  const payload = { trackerPublicId, event_name: eventName, url_path: location?.pathname || '/' };
  const query = filteredQueryString(location?.search);
  if (query) payload.url_query = query;
  const referrer = referrerOrigin(doc?.referrer);
  if (referrer) payload.referrer = referrer;
  if (eventData !== undefined) payload.event_data = eventData;
  return payload;
}

export function createTracker({
  trackerPublicId,
  endpoint = '/api/public/collect',
  send = typeof fetch === 'function' ? fetch : undefined,
  location = typeof globalThis !== 'undefined' ? globalThis.location : undefined,
  navigator = typeof globalThis !== 'undefined' ? globalThis.navigator : undefined,
  document: doc = typeof globalThis !== 'undefined' ? globalThis.document : undefined,
} = {}) {
  const deliver = (payload) => {
    const body = JSON.stringify(payload);
    try {
      const beaconSent = typeof navigator?.sendBeacon === 'function' && navigator.sendBeacon(endpoint, body);
      if (beaconSent) return Promise.resolve();
    } catch { /* cai para o fallback abaixo */ }
    try {
      const result = send?.(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
      });
      return Promise.resolve(result).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };
  return {
    pageview() {
      return deliver(buildPayload({ trackerPublicId, location, document: doc, eventName: 'pageview' }));
    },
    track(name, data) {
      return deliver(buildPayload({ trackerPublicId, location, document: doc, eventName: name, eventData: data }));
    },
  };
}

export function bootTracker({ doc = typeof document !== 'undefined' ? document : undefined, ...trackerOptions } = {}) {
  const trackerPublicId = doc?.currentScript?.dataset?.alvaTracker;
  if (!trackerPublicId) return null;
  // Numa página publicada (domínio do cliente, na Vercel) o coletor não existe: ele mora no
  // Studio que serviu este script, e é para lá que os eventos vão.
  const host = doc?.currentScript?.dataset?.hostUrl;
  const endpoint = /^https?:\/\/[^/\s]+$/.test(String(host || '')) ? `${host}/api/public/collect` : undefined;
  const tracker = createTracker({ trackerPublicId, document: doc, ...(endpoint ? { endpoint } : {}), ...trackerOptions });
  tracker.pageview();
  // O player de VSL (public/vsl-player.js) não conhece o tracker: ele só despacha
  // CustomEvent('alva:track', {detail:{name,data}}), que borbulha até aqui. Isso mantém o
  // player utilizável fora de uma página com tracker (ex.: prévia no editor) sem enviar nada.
  doc?.addEventListener?.('alva:track', (event) => {
    const detail = event?.detail;
    if (detail?.name) tracker.track(detail.name, detail.data);
  });
  return tracker;
}

if (typeof document !== 'undefined') bootTracker();
