import { createHmac, randomBytes } from 'node:crypto';
import { signRuntimeRequest } from './publication-runtime.mjs';
import { signedRuntimeAttribution } from './runtime-gateway-security.mjs';

const ENVIRONMENTS = new Set(['preview', 'production']);
const PROVIDER_CSP = Object.freeze({
  meta: { scriptHosts: ['https://connect.facebook.net'], connectHosts: ['https://www.facebook.com'] },
  ga4: { scriptHosts: ['https://www.googletagmanager.com'], connectHosts: ['https://*.google-analytics.com', 'https://*.analytics.google.com'] },
  tiktok: { scriptHosts: ['https://analytics.tiktok.com'], connectHosts: ['https://analytics.tiktok.com'] },
  linkedin: { scriptHosts: ['https://snap.licdn.com'], connectHosts: ['https://px.ads.linkedin.com'] },
  taboola: { scriptHosts: ['https://cdn.taboola.com'], connectHosts: ['https://trc.taboola.com'] },
});
const FORWARDED_RESPONSE_HEADERS = new Set(['content-type', 'cache-control', 'location', 'set-cookie', 'x-webhook-delivery']);

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function publicationScope({ publicationId, snapshotHash, environment } = {}) {
  if (typeof publicationId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(publicationId) || !/^[a-f0-9]{64}$/i.test(snapshotHash || '') || !ENVIRONMENTS.has(environment)) throw fail('Escopo de runtime inválido.');
  return { publicationId, snapshotHash: snapshotHash.toLowerCase(), environment };
}
function allowedGatewayPath(path) {
  if (typeof path !== 'string' || !(path === '/_alva' || path.startsWith('/_alva/') || path.startsWith('/api/public/forms/'))) throw fail('Rota do gateway inválida.', 404);
  if (path.includes('\\') || path.includes('//') || /[\r\n]/.test(path)) throw fail('Rota do gateway inválida.', 404);
  return path;
}
function safeHost(host) {
  if (typeof host !== 'string' || !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host) || host.length > 253) throw fail('Host público inválido.', 400);
  return host.toLowerCase();
}
function gatewayOrigin(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error(); return url.origin; } catch { throw fail('Origem interna inválida.', 500); }
}
function responseHeaders(headers) {
  const output = {};
  for (const [key, value] of headers.entries()) if (FORWARDED_RESPONSE_HEADERS.has(key.toLowerCase())) output[key.toLowerCase()] = value;
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : headers.get('set-cookie') ? [headers.get('set-cookie')] : [];
  if (cookies.length) output['set-cookie'] = cookies;
  return output;
}

export function derivePublicationRuntimeKey(secret, input) {
  if (typeof secret !== 'string' || secret.length < 16) throw fail('Segredo de runtime ausente.', 500);
  const scope = publicationScope(input);
  return createHmac('sha256', secret).update(JSON.stringify(scope)).digest('hex');
}

export async function forwardRuntimeGatewayRequest({ method = 'GET', path, host, headers = {}, body = Buffer.alloc(0), publicationId, environment, derivedKey, gatewayOrigin: targetOrigin, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000), nonce = () => randomBytes(18).toString('base64url') } = {}) {
  const cleanPath = allowedGatewayPath(path);
  const cleanHost = safeHost(host);
  if (!ENVIRONMENTS.has(environment) || typeof publicationId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(publicationId) || typeof derivedKey !== 'string' || !/^[a-f0-9]{64}$/i.test(derivedKey)) throw fail('Escopo de runtime inválido.', 500);
  const source = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const request = { method: String(method).toUpperCase(), path: cleanPath, publicationId, environment, timestamp: Number(now()), nonce: nonce(), body: source };
  const signature = signRuntimeRequest(request, derivedKey);
  const target = new URL(cleanPath, gatewayOrigin(targetOrigin));
  const outbound = {
    'x-alva-runtime-gateway': '1',
    'x-alva-public-host': cleanHost,
    'x-alva-publication-id': publicationId,
    'x-alva-runtime-environment': environment,
    'x-alva-runtime-timestamp': String(request.timestamp),
    'x-alva-runtime-nonce': request.nonce,
    'x-alva-runtime-signature': signature,
  };
  for (const name of ['content-type', 'cookie', 'origin', 'accept']) if (typeof headers[name] === 'string' && headers[name]) outbound[name] = headers[name];
  const response = await fetchImpl(target.toString(), { method: request.method, headers: outbound, ...(source.length ? { body: source } : {}) });
  const responseHeader = responseHeaders(response.headers);
  if (cleanPath === '/_alva/runtime.js') {
    const attribution = signedRuntimeAttribution(headers.referer || headers.referrer, cleanHost, derivedKey);
    if (attribution) responseHeader['set-cookie'] = [...(responseHeader['set-cookie'] || []), `alva_runtime_attribution=${attribution}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`];
  }
  return { status: response.status, headers: responseHeader, body: Buffer.from(await response.arrayBuffer()) };
}

function gatewayModuleSource() {
  return String.raw`const crypto=require('node:crypto');
const allowed=(path)=>path==='/_alva'||path.startsWith('/_alva/')||path.startsWith('/api/public/forms/');
const read=async(req)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Object.assign(new Error('Corpo muito grande.'),{status:413});chunks.push(chunk)}return Buffer.concat(chunks)};
const canonical=(request)=>JSON.stringify({method:String(request.method).toUpperCase(),path:request.path,publicationId:request.publicationId,environment:request.environment,timestamp:Number(request.timestamp),nonce:request.nonce,bodyHash:crypto.createHash('sha256').update(request.body).digest('hex')});
const handler=async(req,res)=>{try{const incoming=new URL(req.url,'https://runtime.invalid');const prefix='/api/_alva/';if(!incoming.pathname.startsWith(prefix))throw Object.assign(new Error('Rota não encontrada.'),{status:404});const rest=incoming.pathname.slice(prefix.length);const slash=rest.indexOf('/');const scope=slash<0?rest:rest.slice(0,slash), tail=slash<0?'':rest.slice(slash+1);const path=scope==='runtime'?'/'+['_alva',tail].filter(Boolean).join('/'):scope==='forms'?'/'+['api','public','forms',tail].filter(Boolean).join('/'):'';if(!allowed(path))throw Object.assign(new Error('Rota não encontrada.'),{status:404});const host=String(req.headers.host||'').toLowerCase();if(!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host))throw Object.assign(new Error('Host inválido.'),{status:400});const key=process.env.PUBLICATION_RUNTIME_DERIVED_KEY,publicationId=process.env.ALVA_RUNTIME_PUBLICATION_ID,environment=process.env.ALVA_RUNTIME_ENVIRONMENT,origin=process.env.ALVA_RUNTIME_GATEWAY_ORIGIN;if(!key||!publicationId||!['preview','production'].includes(environment)||!origin)throw Object.assign(new Error('Runtime indisponível.'),{status:500});const body=await read(req),timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(18).toString('base64url'),signature=crypto.createHmac('sha256',key).update(canonical({method:req.method,path,publicationId,environment,timestamp,nonce,body})).digest('hex'),headers={'x-alva-runtime-gateway':'1','x-alva-public-host':host,'x-alva-publication-id':publicationId,'x-alva-runtime-environment':environment,'x-alva-runtime-timestamp':String(timestamp),'x-alva-runtime-nonce':nonce,'x-alva-runtime-signature':signature};for(const name of ['content-type','cookie','origin','accept'])if(req.headers[name])headers[name]=req.headers[name];const response=await fetch(new URL(path+incoming.search,origin),{method:req.method,headers,body:body.length?body:undefined});res.statusCode=response.status;for(const [name,value] of response.headers)if(['content-type','cache-control','location','x-webhook-delivery'].includes(name))res.setHeader(name,value);const cookies=response.headers.getSetCookie?response.headers.getSetCookie():response.headers.get('set-cookie')?[response.headers.get('set-cookie')]:[];if(path==='/_alva/runtime.js'){try{const ref=new URL(String(req.headers.referer||req.headers.referrer||''));if(ref.origin==='https://'+host){const values={};for(const keyName of ['fbc','fbp','gclid','gbraid','wbraid','ttclid','li_fat_id','tblci']){const value=ref.searchParams.get(keyName);if(value&&value.length<=512)values[keyName]=value}const payload=Buffer.from(JSON.stringify(values)).toString('base64url');if(Object.keys(values).length)cookies.push('alva_runtime_attribution='+payload+'.'+crypto.createHmac('sha256',key).update('alva-runtime-attribution.'+payload).digest('hex')+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800')}}catch{}}if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.statusCode=error.status||502;res.setHeader('content-type','text/plain; charset=utf-8');res.end(error.status?error.message:'Gateway indisponível.')}};
module.exports={handler};`;
}

function appendRuntimeBootstrap(html, publicationId) {
  const bootstrap = `<script src="/_alva/runtime.js?publicationId=${encodeURIComponent(publicationId)}" nonce="__ALVA_RUNTIME_NONCE__" defer></script>`;
  return html.includes('</body>') ? html.replace('</body>', `${bootstrap}</body>`) : `${html}${bootstrap}`;
}
function extendRuntimeCsp(html, providers, runtimeOrigin, nonce) {
  const configs = providers.map((provider) => PROVIDER_CSP[provider?.provider]).filter(Boolean);
  const scriptHosts = [...new Set([runtimeOrigin, ...configs.flatMap((item) => item.scriptHosts)])].join(' ');
  const connectHosts = [...new Set([runtimeOrigin, ...configs.flatMap((item) => item.connectHosts)])].join(' ');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' ${scriptHosts}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src https:; frame-src https:; connect-src 'self' ${connectHosts}; form-action 'self'; base-uri 'none'`;
  const withNonce = html.replaceAll('__ALVA_RUNTIME_NONCE__', nonce);
  if (!/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(withNonce)) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    return withNonce.includes('<head>') ? withNonce.replace('<head>', `<head>${meta}`) : `${meta}${withNonce}`;
  }
  return withNonce
    .replace(/form-action\s+https?:\/\/[^;"']+/g, "form-action 'self'")
    .replace(/(script-src[^";]*)(?=;|\")/g, `$1 ${scriptHosts}`)
    .replace(/(connect-src[^";]*)(?=;|\")/g, `$1 ${connectHosts}`);
}

export function runtimeGatewayArtifacts(files, { publicationId, snapshotHash, environment, runtimeOrigin, runtimeHmacSecret, providers = [] } = {}) {
  const scope = publicationScope({ publicationId, snapshotHash, environment });
  const runtimeEnv = {
    PUBLICATION_RUNTIME_DERIVED_KEY: derivePublicationRuntimeKey(runtimeHmacSecret, scope),
    ALVA_RUNTIME_PUBLICATION_ID: scope.publicationId,
    ALVA_RUNTIME_ENVIRONMENT: scope.environment,
    ALVA_RUNTIME_GATEWAY_ORIGIN: gatewayOrigin(runtimeOrigin),
  };
  const nonce = createHmac('sha256', runtimeEnv.PUBLICATION_RUNTIME_DERIVED_KEY).update(`csp:${scope.publicationId}:${scope.snapshotHash}`).digest('base64url');
  const escapedOrigin = gatewayOrigin(runtimeOrigin).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absoluteForms = new RegExp(`${escapedOrigin}/api/public/forms/`, 'g');
  const output = files.map((file) => file.file.endsWith('.html')
    ? { ...file, data: extendRuntimeCsp(appendRuntimeBootstrap(file.data.replace(absoluteForms, '/api/public/forms/'), scope.publicationId), providers, gatewayOrigin(runtimeOrigin), nonce) }
    : { ...file });
  const existing = output.find((file) => file.file === 'vercel.json');
  const base = existing ? JSON.parse(existing.data) : { version: 2 };
  const rewrites = [...(base.rewrites || []).filter((rewrite) => !['/_alva/:path*', '/api/public/forms/:path*'].includes(rewrite.source)), { source: '/_alva/:path*', destination: '/api/_alva/runtime/:path*' }, { source: '/api/public/forms/:path*', destination: '/api/_alva/forms/:path*' }];
  const config = { ...base, rewrites, functions: { ...(base.functions || {}), 'api/_alva/[...path].js': { runtime: 'nodejs22.x' } } };
  return {
    files: [...output.filter((file) => !['vercel.json', 'api/_alva/[...path].js', 'api/_alva/gateway.cjs'].includes(file.file)), { file: 'api/_alva/[...path].js', data: "module.exports=require('./gateway.cjs').handler;" }, { file: 'api/_alva/gateway.cjs', data: gatewayModuleSource() }, { file: 'vercel.json', data: JSON.stringify(config) }],
    runtimeEnv,
  };
}
