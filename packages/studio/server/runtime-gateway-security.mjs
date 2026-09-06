import { verifyRuntimeRequest } from './publication-runtime.mjs';
import { derivePublicationRuntimeKey } from './vercel-runtime-gateway.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ATTRIBUTION = new Set(['fbc', 'fbp', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'tblci']);

function fail(message, status = 403) { return Object.assign(new Error(message), { status, statusCode: status }); }
function header(headers, name) { return headers?.[name] || headers?.[name.toLowerCase()] || headers?.[name.toUpperCase()] || ''; }
function publicHost(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(value) || value.length > 253) throw fail('Host público inválido.');
  return value.toLowerCase();
}
export function runtimeManifest(row) {
  if (!row) return null;
  return {
    companyId: row.companyId ?? row.company_id,
    projectId: row.projectId ?? row.project_id,
    publicationId: row.publicationId ?? row.publication_id,
    snapshotHash: row.snapshotHash ?? row.snapshot_hash,
    version: row.version,
    policyVersion: row.policyVersion ?? row.policy_version,
    origin: row.origin,
    domain: row.domain,
    environment: row.environment,
    consent: row.consent ?? row.policy ?? {},
    providers: row.providers ?? [],
    revokedAt: row.revokedAt ?? row.revoked_at ?? null,
  };
}
export function signedRuntimeAttribution(referer, host, derivedKey) {
  let url;
  try { url = new URL(referer); if (url.origin !== `https://${publicHost(host)}`) return null; } catch { return null; }
  const values = Object.fromEntries([...ATTRIBUTION].flatMap((key) => {
    const value = url.searchParams.get(key);
    return typeof value === 'string' && value.length > 0 && value.length <= 512 ? [[key, value]] : [];
  }));
  if (!Object.keys(values).length) return null;
  const payload = Buffer.from(JSON.stringify(values)).toString('base64url');
  return `${payload}.${createHmac('sha256', derivedKey).update(`alva-runtime-attribution.${payload}`).digest('hex')}`;
}
export function verifiedRuntimeAttribution(cookie, manifest, rootSecret) {
  if (typeof cookie !== 'string' || !cookie.includes('.')) return {};
  const [payload, signature, ...extra] = cookie.split('.');
  if (!payload || !signature || extra.length) return {};
  const key = derivePublicationRuntimeKey(rootSecret, manifest);
  const expected = createHmac('sha256', key).update(`alva-runtime-attribution.${payload}`).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return {};
  try {
    const values = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return Object.fromEntries(Object.entries(values).flatMap(([name, value]) => ATTRIBUTION.has(name) && typeof value === 'string' && value.length > 0 && value.length <= 512 ? [[name, value]] : []));
  } catch { return {}; }
}

export async function verifyRuntimeGatewayEnvelope({ repository, rootSecret, method, path, headers, body = Buffer.alloc(0), now = Math.floor(Date.now() / 1000) } = {}) {
  if (!repository || typeof repository.currentForOrigin !== 'function' || typeof repository.claimNonce !== 'function') throw new Error('Repositório de runtime obrigatório.');
  if (header(headers, 'x-alva-runtime-gateway') !== '1') throw fail('Gateway de runtime obrigatório.');
  const publicationId = header(headers, 'x-alva-publication-id');
  const environment = header(headers, 'x-alva-runtime-environment');
  const host = publicHost(header(headers, 'x-alva-public-host'));
  const manifest = runtimeManifest(await repository.currentForOrigin({ publicationId, origin: `https://${host}` }));
  if (!manifest || manifest.publicationId !== publicationId || manifest.environment !== environment || manifest.origin !== `https://${host}` || manifest.revokedAt) throw fail('Manifesto de runtime inválido.');
  const request = {
    method,
    path,
    publicationId,
    environment,
    timestamp: Number(header(headers, 'x-alva-runtime-timestamp')),
    nonce: header(headers, 'x-alva-runtime-nonce'),
    body: Buffer.isBuffer(body) ? body : Buffer.from(body || ''),
  };
  const key = derivePublicationRuntimeKey(rootSecret, manifest);
  const verified = await verifyRuntimeRequest(request, header(headers, 'x-alva-runtime-signature'), key, { now, replay: { claim: (id, nonce, expiresAt) => repository.claimNonce({ publicationId: id, nonce, expiresAt: new Date(expiresAt * 1000) }) } });
  if (!verified) throw fail('Assinatura de runtime inválida ou replay detectado.');
  return { manifest, host, origin: manifest.origin, publicationId, derivedKey: key };
}
