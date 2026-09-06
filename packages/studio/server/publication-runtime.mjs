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

export function createRuntimeLoader({ publicationId, snapshotHash, policyVersion, origin: publicOrigin, domain, environment, providers = [] }) {
  const configs = providers.map(providerConfig).map(({ provider, id }) => ({ provider, id, src: PROVIDER_SCRIPTS[provider] }));
  const scope = { publicationId, snapshotHash, policyVersion, origin: publicOrigin, domain, environment };
  const key = `alva-runtime-consent:${createHash('sha256').update(JSON.stringify(scope)).digest('hex')}`;
  const config = JSON.stringify({ providers: configs, key, publicationId });
  return `(() => { const cfg=${config}; const endpoint='/_alva/consent?publicationId='+encodeURIComponent(cfg.publicationId); const init=(item)=>{if(item.provider==='meta'){window.fbq=window.fbq||function(){(window.fbq.queue=window.fbq.queue||[]).push(arguments)};window.fbq('init',item.id);window.fbq('track','PageView')}if(item.provider==='ga4'){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',item.id)}if(item.provider==='tiktok'){const q=window.ttq=window.ttq||[];q._i=q._i||{};q._t=q._t||{};q._o=q._o||{};q._i[item.id]=q._i[item.id]||[];q._t[item.id]=q._t[item.id]||+new Date;q._o[item.id]=q._o[item.id]||{};q.load=q.load||function(id){q.push(['load',id])};q.page=q.page||function(){q.push(['page'])};q.load(item.id);q.page()}if(item.provider==='linkedin'){window._linkedin_partner_id=item.id;window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(item.id)}if(item.provider==='taboola'){window._tfa=window._tfa||[];window._tfa.push({notify:'page_view',id:item.id})}}; const load=()=>{ if(document.documentElement.getAttribute('data-alva-runtime-loaded')==='true') return; document.documentElement.setAttribute('data-alva-runtime-loaded','true'); cfg.providers.forEach(item=>{init(item);const script=document.createElement('script');script.src=item.provider==='ga4'?item.src+'?id='+encodeURIComponent(item.id):item.provider==='tiktok'?item.src+'?sdkid='+encodeURIComponent(item.id)+'&lib=ttq':item.src;script.async=true;script.dataset.alvaRuntimeProvider=item.provider;script.dataset.alvaRuntimeId=item.id;document.head.appendChild(script);});}; const action=(label,actionName)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label);button.addEventListener('click',()=>fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:actionName})}).then(()=>refresh()).catch(()=>{}));return button;}; const banner=(state)=>{const box=document.createElement('div');box.className='alva-runtime-consent';box.setAttribute('role','group');box.setAttribute('aria-label','Preferências de medição');const note=document.createElement('p');note.textContent='Usamos identificadores pseudônimos de atribuição e processamento limitado sem autorização de PII direta.';box.append(note);if(state==='granted') box.append(action('Revogar medição','revoke'));else box.append(action('Aceitar medição','grant'),action('Recusar medição','deny'));return box;}; const refresh=()=>fetch(endpoint,{credentials:'same-origin'}).then(response=>response.ok?response.json():{state:'pending'}).then(result=>{document.querySelectorAll('.alva-runtime-consent').forEach(node=>node.remove());const state=result&&result.state;if(state==='granted') load();document.body.appendChild(banner(state));}).catch(()=>document.body.appendChild(banner('pending'))); refresh(); })();`;
}
