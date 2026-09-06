import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const PROVIDERS = new Set(['meta', 'ga4', 'tiktok', 'linkedin', 'taboola']);
const MAX_SKEW_SECONDS = 300;
const PROVIDER_SCRIPTS = {
  meta: 'https://connect.facebook.net/en_US/fbevents.js',
  ga4: 'https://www.googletagmanager.com/gtag/js',
  tiktok: 'https://analytics.tiktok.com/i18n/pixel/events.js',
  linkedin: 'https://snap.licdn.com/li.lms-analytics/insight.min.js',
  taboola: 'https://cdn.taboola.com/libtrc/unip/loader.js',
};
const ENVIRONMENTS = new Set(['preview', 'production']);

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function origin(value) {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error(); return url.origin; } catch { throw fail('Origem da publicação inválida.', 400); }
}
function canonical(value) {
  if (!value || !ENVIRONMENTS.has(value.environment) || typeof value.path !== 'string' || !value.path.startsWith('/') || typeof value.nonce !== 'string' || !/^[A-Za-z0-9._~-]{16,160}$/.test(value.nonce)) throw fail('Envelope de runtime inválido.');
  const body = typeof value.body === 'string' ? Buffer.from(value.body, 'utf8') : Buffer.from(value.body || '');
  return JSON.stringify({ method: String(value.method).toUpperCase(), path: value.path, publicationId: value.publicationId, environment: value.environment, timestamp: Number(value.timestamp), nonce: value.nonce, bodyHash: createHash('sha256').update(body).digest('hex') });
}
function hmac(value, secret) { return createHmac('sha256', secret).update(canonical(value)).digest('hex'); }

function providerConfig(provider) {
  if (!provider || typeof provider !== 'object' || !PROVIDERS.has(provider.provider) || typeof provider.id !== 'string') throw fail('Configuração pública de provider inválida.');
  const rules = { meta: /^\d{1,20}$/, ga4: /^G-[A-Z0-9]{4,20}$/, tiktok: /^[A-Za-z0-9_-]{2,255}$/, linkedin: /^\d{1,30}$/, taboola: /^[A-Za-z0-9_-]{2,255}$/ };
  if (!rules[provider.provider].test(provider.id)) throw fail('Identificador público de provider inválido.');
  return { provider: provider.provider, id: provider.id };
}

export function buildRuntimeManifest({ publicationId, snapshotHash, version = 0, policyVersion = 1, origin: publicOrigin, domain, environment, providers = [] }) {
  if (!publicationId || !/^[A-Za-z0-9._:-]{1,120}$/.test(publicationId)) throw fail('Identificador de publicação inválido.');
  if (!/^[a-f0-9]{64}$/i.test(snapshotHash || '')) throw fail('Snapshot da publicação inválido.');
  if (environment !== 'production') throw fail('Consentimento de runtime só existe em produção.', 409);
  const cleanOrigin = origin(publicOrigin);
  if (typeof domain !== 'string' || domain !== new URL(cleanOrigin).hostname) throw fail('Domínio da publicação inválido.');
  if (!Number.isInteger(policyVersion) || policyVersion < 1) throw fail('Versão da policy inválida.');
  const cleanProviders = providers.map(providerConfig).sort((a, b) => a.provider.localeCompare(b.provider));
  return Object.freeze({ publicationId, snapshotHash: snapshotHash.toLowerCase(), version, policyVersion, origin: cleanOrigin, domain, environment, consent: { required: true, scope: 'publication' }, providers: cleanProviders });
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

export function createRuntimeLoader({ publicationId, snapshotHash, providers = [] }) {
  const configs = providers.map(providerConfig).map(({ provider, id }) => ({ provider, id, src: PROVIDER_SCRIPTS[provider] }));
  const config = JSON.stringify({ publicationId, snapshotHash, providers: configs });
  return `(() => { const cfg=${config}; const key='alva-runtime-consent:'+cfg.publicationId+':'+cfg.snapshotHash; const load=()=>{ if(localStorage.getItem(key)!=='accepted'||document.documentElement.getAttribute('data-alva-runtime-loaded')==='true') return; document.documentElement.setAttribute('data-alva-runtime-loaded','true'); cfg.providers.forEach(item=>{const script=document.createElement('script');script.src=item.src;script.async=true;script.dataset.alvaRuntimeProvider=item.provider;script.dataset.alvaRuntimeId=item.id;document.head.appendChild(script);}); }; const set=(value)=>{if(value==='revoked') localStorage.removeItem(key); else localStorage.setItem(key,value); document.querySelectorAll('.alva-runtime-consent').forEach(node=>node.remove()); if(value!=='accepted') document.body.appendChild(actions()); else {load(); document.body.appendChild(actions(true));}}; const action=(label,value)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label);button.addEventListener('click',()=>set(value));return button;}; const actions=(accepted=false)=>{const box=document.createElement('div');box.className='alva-runtime-consent';box.setAttribute('role','group');box.setAttribute('aria-label','Preferências de medição'); if(accepted) box.append(action('Revogar medição','revoked')); else {box.append(action('Aceitar medição','accepted'),action('Recusar medição','rejected'));} return box;}; if(localStorage.getItem(key)==='accepted') load(); document.body.appendChild(actions(localStorage.getItem(key)==='accepted')); })();`;
}
