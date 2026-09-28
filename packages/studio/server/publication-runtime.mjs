import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NOMES_PADRAO } from './nomes-de-evento.mjs';

const PROVIDERS = new Set(['meta', 'ga4', 'tiktok', 'linkedin', 'taboola']);
const MAX_SKEW_SECONDS = 300;
const PROVIDER_SCRIPTS = {
  meta: 'https://connect.facebook.net/en_US/fbevents.js',
  ga4: 'https://www.googletagmanager.com/gtag/js',
  tiktok: 'https://analytics.tiktok.com/i18n/pixel/events.js',
  linkedin: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
  // O script da Taboola leva o ID da conta no caminho: .../unip/<account_id>/tfa.js.
  // https://developers.taboola.com/pixel/docs/add-the-base-pixel-manually
  taboola: 'https://cdn.taboola.com/libtrc/unip/',
};
const ENVIRONMENTS = new Set(['preview', 'production']);

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function origin(value) {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error(); return url.origin; } catch { throw fail('Origem da publicação inválida.', 400); }
}
// O visitante — IP e navegador de quem está na página publicada — entra no que é
// assinado. Só assim o Studio pode confiar nele: o gateway o lê da requisição que a
// Vercel entrega, e um cabeçalho solto com esses dados qualquer um forjaria.
//
// Sem visitante, o canônico é exatamente o de sempre, e gateways já publicados continuam
// valendo. Nas duas direções adulterar quebra a assinatura: arrancar o visitante de uma
// requisição assinada com ele, ou acrescentá-lo a uma assinada sem ele.
export function visitanteCanonico(client) {
  const ip = typeof client?.ip === 'string' && client.ip ? client.ip : null;
  const userAgent = typeof client?.userAgent === 'string' && client.userAgent ? client.userAgent : null;
  return ip || userAgent ? { ip, userAgent } : null;
}

function canonical(value) {
  if (!value || !ENVIRONMENTS.has(value.environment) || typeof value.path !== 'string' || !value.path.startsWith('/') || typeof value.nonce !== 'string' || !/^[A-Za-z0-9._~-]{16,160}$/.test(value.nonce)) throw fail('Envelope de runtime inválido.');
  const body = typeof value.body === 'string' ? Buffer.from(value.body, 'utf8') : Buffer.from(value.body || '');
  const visitante = visitanteCanonico(value.client);
  return JSON.stringify({ method: String(value.method).toUpperCase(), path: value.path, publicationId: value.publicationId, environment: value.environment, timestamp: Number(value.timestamp), nonce: value.nonce, bodyHash: createHash('sha256').update(body).digest('hex'), ...(visitante ? { client: visitante } : {}) });
}
function hmac(value, secret) { return createHmac('sha256', secret).update(canonical(value)).digest('hex'); }

function providerConfig(provider) {
  if (!provider || typeof provider !== 'object' || !PROVIDERS.has(provider.provider) || typeof provider.id !== 'string') throw fail('Configuração pública de provider inválida.');
  const rules = { meta: /^\d{1,20}$/, ga4: /^G-[A-Z0-9]{4,20}$/, tiktok: /^[A-Za-z0-9_-]{2,255}$/, linkedin: /^\d{1,30}$/, taboola: /^\d{1,20}$/ };
  if (!rules[provider.provider].test(provider.id)) throw fail('Identificador público de provider inválido.');
  return { provider: provider.provider, id: provider.id };
}

function runtimeContents(contents = []) {
  if (!Array.isArray(contents)) throw fail('Conteúdo do manifesto inválido.');
  return contents.map((content) => {
    if (!content || typeof content !== 'object' || Array.isArray(content) || typeof content.path !== 'string' || !content.path.startsWith('/') || !['page', 'form'].includes(content.type) || typeof content.contentId !== 'string' || !content.contentId || typeof content.versionId !== 'string' || !content.versionId)
      throw fail('Conteúdo do manifesto inválido.');
    const captureIds = content.captureIds === undefined ? [] : content.captureIds;
    if (!Array.isArray(captureIds) || captureIds.some((captureId) => typeof captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)) || new Set(captureIds).size !== captureIds.length)
      throw fail('Conteúdo do manifesto inválido.');
    return { path: content.path, type: content.type, contentId: content.contentId, versionId: content.versionId, captureIds: [...captureIds] };
  });
}

export function buildRuntimeManifest({ publicationId, snapshotHash, version = 0, policyVersion = 1, origin: publicOrigin, domain, environment, providers = [], contents = [] }) {
  if (!publicationId || !/^[A-Za-z0-9._:-]{1,120}$/.test(publicationId)) throw fail('Identificador de publicação inválido.');
  if (!/^[a-f0-9]{64}$/i.test(snapshotHash || '')) throw fail('Snapshot da publicação inválido.');
  if (!ENVIRONMENTS.has(environment)) throw fail('Ambiente de runtime inválido.', 409);
  const cleanOrigin = origin(publicOrigin);
  if (typeof domain !== 'string' || domain !== new URL(cleanOrigin).hostname) throw fail('Domínio da publicação inválido.');
  if (!Number.isInteger(policyVersion) || policyVersion < 1) throw fail('Versão da policy inválida.');
  const cleanProviders = providers.map(providerConfig).sort((a, b) => a.provider.localeCompare(b.provider));
  const cleanContents = runtimeContents(contents);
  if (environment === 'preview' && (!cleanContents.some((content) => content.type === 'page' && content.captureIds.length) || cleanProviders.length))
    throw fail('Prévia de runtime exige captura publicada e não aceita providers.', 409);
  const consent = environment === 'production' ? { required: true, scope: 'publication' } : { required: false, scope: 'none' };
  return Object.freeze({ publicationId, snapshotHash: snapshotHash.toLowerCase(), version, policyVersion, origin: cleanOrigin, domain, environment, consent, providers: cleanProviders, contents: cleanContents });
}

export function consentKey(manifest) {
  return `alva-runtime-consent:${createHash('sha256').update(JSON.stringify({ publicationId: manifest.publicationId, snapshotHash: manifest.snapshotHash, policyVersion: manifest.policyVersion, origin: origin(manifest.origin), domain: manifest.domain, environment: manifest.environment })).digest('hex')}`;
}

export function signRuntimeRequest(request, secret) {
  if (!secret) throw fail('Segredo de runtime ausente.', 500);
  return hmac(request, secret);
}

export async function verifyRuntimeRequest(request, signature, secret, { now = Math.floor(Date.now() / 1000), replay = new ReplayStore() } = {}) {
  if (!secret || !signature || !request?.publicationId || !request?.nonce || !Number.isInteger(Number(request.timestamp))) return false;
  if (Math.abs(Number(now) - Number(request.timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = signRuntimeRequest(request, secret);
  if (String(signature).length !== expected.length || !timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected))) return false;
  return replay.claim(request.publicationId, request.nonce, Number(request.timestamp) + MAX_SKEW_SECONDS);
}

export class ReplayStore {
  #used = new Map();
  constructor({ now = () => Math.floor(Date.now() / 1000) } = {}) { this.now = now; }
  claim(publicationId, nonce, expiresAt) {
    const now = this.now();
    for (const [key, expiry] of this.#used) if (expiry <= now) this.#used.delete(key);
    const key = `${publicationId}:${nonce}`;
    if (this.#used.has(key)) return false;
    this.#used.set(key, expiresAt);
    return true;
  }
}

// Só o lead dispara pelo navegador. Compra e início de checkout saem pelo servidor, que é
// quem sabe que aconteceram; um script qualquer da página não pode inventá-los.
const CONVERSAO_NO_NAVEGADOR = Object.freeze(Object.fromEntries(
  Object.entries(NOMES_PADRAO).map(([plataforma, nomes]) => [plataforma, { lead: nomes.lead }]),
));

// O código base de cada pixel é o oficial, copiado da documentação — só as partes que
// criam a fila e carregam o script; o disparo é do carregador, depois do consentimento.
// - https://developers.facebook.com/docs/meta-pixel/get-started
// - https://business-api.tiktok.com/portal/docs/install-pixel-using-code/v1.3
const BASE_META = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');`;
const BASE_TIKTOK = `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};}(window,document,'ttq');`;

export function createRuntimeLoader({ publicationId, snapshotHash, policyVersion, origin: publicOrigin, domain, environment, providers = [] }) {
  const configs = providers.map(providerConfig).map(({ provider, id }) => ({ provider, id, src: PROVIDER_SCRIPTS[provider] }));
  const scope = { publicationId, snapshotHash, policyVersion, origin: publicOrigin, domain, environment };
  const key = `alva-runtime-consent:${createHash('sha256').update(JSON.stringify(scope)).digest('hex')}`;
  const config = JSON.stringify({ providers: configs, key, publicationId });
  return `(() => {
const cfg = ${config};
const nomes = ${JSON.stringify(CONVERSAO_NO_NAVEGADOR)};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const avisada = () => {
  const meta = document.querySelector('meta[name="alva-conversion"]');
  if (!meta) return null;
  const partes = String(meta.getAttribute('content') || '').split(':');
  return partes.length === 2 ? partes : null;
};
// Mesma janela, documento novo (o formulário de várias etapas usa document.write): o
// pixel já está carregado. Só se refaz o banner e se avisa a conversão.
if (window.alvaRuntime && window.alvaRuntime.publicationId === cfg.publicationId) {
  window.alvaRuntime.refresh();
  const aviso = avisada();
  if (aviso) window.alvaRuntime.conversao(aviso[0], aviso[1]);
  return;
}
let carregado = false;
// O consentimento vale a cada momento, não só na carga: quem revoga não é mais medido.
let permitido = false;
const fila = [];
const feitas = new Set();
const disparar = (nome, id) => cfg.providers.forEach((item) => {
  const padrao = nomes[item.provider] && nomes[item.provider][nome];
  if (!padrao) return;
  if (item.provider === 'meta') window.fbq('track', padrao, {}, { eventID: id });
  if (item.provider === 'tiktok') window.ttq.track(padrao, {}, { event_id: id });
});
const conhecida = (nome) => Object.keys(nomes).some((plataforma) => Object.prototype.hasOwnProperty.call(nomes[plataforma], String(nome)));
const conversao = (nome, id) => {
  if (!conhecida(nome) || !UUID.test(String(id))) return;
  const chave = nome + ':' + id;
  if (feitas.has(chave)) return;
  feitas.add(chave);
  if (carregado && permitido) disparar(nome, id); else fila.push([nome, id]);
};
const endpoint = '/_alva/consent?publicationId=' + encodeURIComponent(cfg.publicationId);
const anexar = (item, src) => {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.dataset.alvaRuntimeProvider = item.provider;
  script.dataset.alvaRuntimeId = item.id;
  document.head.appendChild(script);
};
const iniciar = (item) => {
  if (item.provider === 'meta') {
    ${configs.some((item) => item.provider === 'meta') ? BASE_META : ''}
    window.fbq('init', item.id);
    window.fbq('track', 'PageView');
  }
  if (item.provider === 'tiktok') {
    ${configs.some((item) => item.provider === 'tiktok') ? BASE_TIKTOK : ''}
    window.ttq.load(item.id);
    window.ttq.page();
  }
  if (item.provider === 'ga4') {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', item.id);
    anexar(item, item.src + '?id=' + encodeURIComponent(item.id));
  }
  if (item.provider === 'linkedin') {
    window._linkedin_partner_id = item.id;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(item.id);
    anexar(item, item.src);
  }
  if (item.provider === 'taboola') {
    window._tfa = window._tfa || [];
    window._tfa.push({ notify: 'event', name: 'page_view', id: Number(item.id) });
    anexar(item, item.src + encodeURIComponent(item.id) + '/tfa.js');
  }
};
const load = () => {
  if (carregado) return;
  carregado = true;
  document.documentElement.setAttribute('data-alva-runtime-loaded', 'true');
  cfg.providers.forEach(iniciar);
};
const esvaziar = () => { if (carregado && permitido) fila.splice(0).forEach(([nome, id]) => disparar(nome, id)); };
const action = (label, actionName) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', () => fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionName }) }).then(() => refresh()).catch(() => {}));
  return button;
};
const banner = (state) => {
  const box = document.createElement('div');
  box.className = 'alva-runtime-consent';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Preferências de medição');
  const note = document.createElement('p');
  note.textContent = 'Usamos identificadores pseudônimos de atribuição e processamento limitado sem autorização de PII direta.';
  box.append(note);
  if (state === 'granted') box.append(action('Revogar medição', 'revoke'));
  else box.append(action('Aceitar medição', 'grant'), action('Recusar medição', 'deny'));
  return box;
};
const refresh = () => fetch(endpoint, { credentials: 'same-origin' })
  .then((response) => (response.ok ? response.json() : { state: 'pending' }))
  .then((result) => {
    document.querySelectorAll('.alva-runtime-consent').forEach((node) => node.remove());
    const state = result && result.state;
    permitido = state === 'granted';
    if (permitido) { load(); esvaziar(); }
    document.body.appendChild(banner(state));
  })
  .catch(() => document.body.appendChild(banner('pending')));
window.alvaRuntime = { publicationId: cfg.publicationId, conversao, refresh };
const aviso = avisada();
if (aviso) conversao(aviso[0], aviso[1]);
refresh();
})();`;
}
