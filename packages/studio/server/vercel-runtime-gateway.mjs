import { createHmac } from 'node:crypto';
import { REGEX_COOKIE_FBP, FORMATO_FBP, PARAMETROS_DA_URL } from './runtime-gateway-security.mjs';

const ENVIRONMENTS = new Set(['preview', 'production']);
const PROVIDER_CSP = Object.freeze({
  meta: { scriptHosts: ['https://connect.facebook.net'], connectHosts: ['https://www.facebook.com'] },
  ga4: { scriptHosts: ['https://www.googletagmanager.com'], connectHosts: ['https://*.google-analytics.com', 'https://*.analytics.google.com'] },
  tiktok: { scriptHosts: ['https://analytics.tiktok.com'], connectHosts: ['https://analytics.tiktok.com'] },
  linkedin: { scriptHosts: ['https://snap.licdn.com'], connectHosts: ['https://px.ads.linkedin.com'] },
  taboola: { scriptHosts: ['https://cdn.taboola.com'], connectHosts: ['https://trc.taboola.com'] },
});

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function publicationScope({ publicationId, snapshotHash, environment } = {}) {
  if (typeof publicationId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(publicationId) || !/^[a-f0-9]{64}$/i.test(snapshotHash || '') || !ENVIRONMENTS.has(environment)) throw fail('Escopo de runtime inválido.');
  return { publicationId, snapshotHash: snapshotHash.toLowerCase(), environment };
}
function gatewayOrigin(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error(); return url.origin; } catch { throw fail('Origem interna inválida.', 500); }
}

// O visitante como a Vercel o entrega à função: o IP em `x-real-ip` — e, na falta dele,
// o primeiro valor de `x-forwarded-for`, que a Vercel reescreve e portanto não vem do
// navegador —, e o navegador em `user-agent`. A sonda de 27/09 na Vercel real confirmou
// os três cabeçalhos de IP coincidindo com o endereço de quem visitava.
//
// Aqui se valida só o formato. O que fazer com o endereço — descartar rede privada, por
// exemplo — é decisão do Studio. As regras de formato são exportadas porque o módulo
// publicado na Vercel as recebe por interpolação, e não por cópia digitada: foi uma
// segunda lista escrita à mão que deixou o `fbc` divergir.
export const FORMATO_IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const FORMATO_IPV6 = /^[0-9a-f:]{3,45}$/i;


export function derivePublicationRuntimeKey(secret, input) {
  if (typeof secret !== 'string' || secret.length < 16) throw fail('Segredo de runtime ausente.', 500);
  const scope = publicationScope(input);
  return createHmac('sha256', secret).update(JSON.stringify(scope)).digest('hex');
}

function gatewayModuleSource() {
  return String.raw`const crypto=require('node:crypto');
const allowed=(path)=>path==='/_alva'||path.startsWith('/_alva/')||path.startsWith('/api/public/pages/');
const read=async(req)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Object.assign(new Error('Corpo muito grande.'),{status:413});chunks.push(chunk)}return Buffer.concat(chunks)};
const canonical=(request)=>{const c=request.client||{},ip=c.ip||null,userAgent=c.userAgent||null;return JSON.stringify({method:String(request.method).toUpperCase(),path:request.path,publicationId:request.publicationId,environment:request.environment,timestamp:Number(request.timestamp),nonce:request.nonce,bodyHash:crypto.createHash('sha256').update(request.body).digest('hex'),...(ip||userAgent?{client:{ip,userAgent}}:{})})};
const handler=async(req,res)=>{try{const incoming=new URL(req.url,'https://runtime.invalid');const prefix='/api/_alva/';if(!incoming.pathname.startsWith(prefix))throw Object.assign(new Error('Rota não encontrada.'),{status:404});const rest=incoming.pathname.slice(prefix.length);const slash=rest.indexOf('/');const scope=slash<0?rest:rest.slice(0,slash), tail=slash<0?'':rest.slice(slash+1);const path=scope==='runtime'?'/'+['_alva',tail].filter(Boolean).join('/'):scope==='pages'?'/'+['api','public','pages',tail].filter(Boolean).join('/'):'';if(!allowed(path))throw Object.assign(new Error('Rota não encontrada.'),{status:404});const host=String(req.headers.host||'').toLowerCase();if(!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host))throw Object.assign(new Error('Host inválido.'),{status:400});const key=process.env.PUBLICATION_RUNTIME_DERIVED_KEY,publicationId=process.env.ALVA_RUNTIME_PUBLICATION_ID,environment=process.env.ALVA_RUNTIME_ENVIRONMENT,origin=process.env.ALVA_RUNTIME_GATEWAY_ORIGIN;if(!key||!publicationId||!['preview','production'].includes(environment)||!origin)throw Object.assign(new Error('Runtime indisponível.'),{status:500});const bruto=String(req.headers['x-real-ip']||String(req.headers['x-forwarded-for']||'').split(',')[0]||'').trim().replace(/^::ffff:/i,''),clientIp=/${FORMATO_IPV4.source}/.test(bruto)||(/${FORMATO_IPV6.source}/i.test(bruto)&&bruto.includes(':'))?bruto:null,clientUa=String(req.headers['user-agent']||'').replace(/[\r\n]+/g,' ').trim().slice(0,512)||null;const body=await read(req),timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(18).toString('base64url'),signature=crypto.createHmac('sha256',key).update(canonical({method:req.method,path,publicationId,environment,timestamp,nonce,body,client:{ip:clientIp,userAgent:clientUa}})).digest('hex'),headers={'x-alva-runtime-gateway':'1','x-alva-public-host':host,'x-alva-publication-id':publicationId,'x-alva-runtime-environment':environment,'x-alva-runtime-timestamp':String(timestamp),'x-alva-runtime-nonce':nonce,'x-alva-runtime-signature':signature,...(clientIp?{'x-alva-client-ip':clientIp}:{}),...(clientUa?{'x-alva-client-ua':clientUa}:{})};for(const name of ['content-type','cookie','origin','accept'])if(req.headers[name])headers[name]=req.headers[name];const response=await fetch(new URL(path+incoming.search,origin),{method:req.method,headers,body:body.length?body:undefined});res.statusCode=response.status;for(const [name,value] of response.headers)if(['content-type','cache-control','location','x-webhook-delivery'].includes(name))res.setHeader(name,value);const cookies=response.headers.getSetCookie?response.headers.getSetCookie():response.headers.get('set-cookie')?[response.headers.get('set-cookie')]:[];if(path==='/_alva/runtime.js'){try{const ref=new URL(String(req.headers.referer||req.headers.referrer||''));if(ref.origin==='https://'+host){const values={};for(const keyName of ${JSON.stringify(PARAMETROS_DA_URL)}){const value=ref.searchParams.get(keyName);if(value&&value.length<=512)values[keyName]=value}const fbpMatch=String(req.headers.cookie||'').match(/${REGEX_COOKIE_FBP.source}/);if(fbpMatch&&/${FORMATO_FBP.source}/.test(fbpMatch[1]))values.fbp=fbpMatch[1];const payload=Buffer.from(JSON.stringify(values)).toString('base64url');if(Object.keys(values).length)cookies.push('alva_runtime_attribution='+payload+'.'+crypto.createHmac('sha256',key).update('alva-runtime-attribution.'+payload).digest('hex')+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800')}}catch{}}if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.statusCode=error.status||502;res.setHeader('content-type','text/plain; charset=utf-8');res.end(error.status?error.message:'Gateway indisponível.')}};
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
  // O carrossel vai num <script> em linha sem atributos, montado pela própria publicação;
  // sem o nonce, a CSP abaixo o bloquearia na página publicada.
  const withNonce = html.replace(/<script>/gi, '<script nonce="__ALVA_RUNTIME_NONCE__">').replaceAll('__ALVA_RUNTIME_NONCE__', nonce);
  if (!/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(withNonce)) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    return withNonce.includes('<head>') ? withNonce.replace('<head>', `<head>${meta}`) : `${meta}${withNonce}`;
  }
  return withNonce
    .replace(/form-action\s+https?:\/\/[^;"']+/g, "form-action 'self'")
    .replace(/(script-src[^";]*)(?=;|\")/g, `$1 ${scriptHosts}`)
    .replace(/(connect-src[^";]*)(?=;|\")/g, `$1 ${connectHosts}`);
}

export function runtimeGatewayArtifacts(files, { publicationId, snapshotHash, environment, runtimeOrigin, runtimeHmacSecret, providers = [], runtimeBootstrap = true } = {}) {
  const scope = publicationScope({ publicationId, snapshotHash, environment });
  const runtimeEnv = {
    PUBLICATION_RUNTIME_DERIVED_KEY: derivePublicationRuntimeKey(runtimeHmacSecret, scope),
    ALVA_RUNTIME_PUBLICATION_ID: scope.publicationId,
    ALVA_RUNTIME_ENVIRONMENT: scope.environment,
    ALVA_RUNTIME_GATEWAY_ORIGIN: gatewayOrigin(runtimeOrigin),
  };
  const nonce = createHmac('sha256', runtimeEnv.PUBLICATION_RUNTIME_DERIVED_KEY).update(`csp:${scope.publicationId}:${scope.snapshotHash}`).digest('base64url');
  const escapedOrigin = gatewayOrigin(runtimeOrigin).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absolutePages = new RegExp(`${escapedOrigin}/api/public/pages/[^/?#"'<>]+/[^/?#"'<>]+`, 'g');
  const output = files.map((file) => file.file.endsWith('.html')
    ? { ...file, data: runtimeBootstrap ? extendRuntimeCsp(appendRuntimeBootstrap(file.data.replace(absolutePages, '/api/public/pages'), scope.publicationId), providers, gatewayOrigin(runtimeOrigin), nonce) : file.data.replace(absolutePages, '/api/public/pages') }
    : { ...file });
  const existing = output.find((file) => file.file === 'vercel.json');
  const base = existing ? JSON.parse(existing.data) : { version: 2 };
  const rewrites = [...(base.rewrites || []).filter((rewrite) => !['/_alva/:path*', '/api/public/pages/:path*'].includes(rewrite.source)), { source: '/_alva/:path*', destination: '/api/_alva/runtime/:path*' }, { source: '/api/public/pages/:path*', destination: '/api/_alva/pages/:path*' }];
  const config = { ...base, rewrites, functions: { ...(base.functions || {}), 'api/_alva/[...path].js': { runtime: 'nodejs22.x' } } };
  return {
    files: [...output.filter((file) => !['vercel.json', 'api/_alva/[...path].js', 'api/_alva/gateway.cjs'].includes(file.file)), { file: 'api/_alva/[...path].js', data: "module.exports=require('./gateway.cjs').handler;" }, { file: 'api/_alva/gateway.cjs', data: gatewayModuleSource() }, { file: 'vercel.json', data: JSON.stringify(config) }],
    runtimeEnv,
  };
}
