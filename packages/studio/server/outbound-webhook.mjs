import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function fail(message = 'Webhook não é seguro.', status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function ipv4Private(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0);
}

function ipv6Private(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return ipv4Private([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  return /^f[cd]/.test(normalized)
    || /^fe[89ab]/.test(normalized)
    || /^ff/.test(normalized)
    || /^2001:db8:/.test(normalized);
}

function unsafeAddress(address) {
  const family = isIP(address);
  if (family === 4) return ipv4Private(address);
  if (family === 6) return ipv6Private(address);
  return true;
}

function unsafeHost(host) {
  const normalized = String(host).toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === 'metadata'
    || normalized === 'metadata.google.internal'
    || normalized.endsWith('.metadata.google.internal');
}

export async function validateWebhookUrl(value, { lookup = systemLookup } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2000) throw fail('Informe um webhook HTTPS válido.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail('Informe um webhook HTTPS válido.');
  }
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || unsafeHost(host))
    throw fail('Webhook não é seguro.');
  if (isIP(host) && unsafeAddress(host)) throw fail('Webhook não é seguro.');
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw fail('Não foi possível validar o destino do webhook.');
  }
  const addresses = Array.isArray(records) ? records : [records];
  if (!addresses.length || addresses.some((record) => unsafeAddress(record?.address))) throw fail('Webhook não é seguro.');
  return url.toString();
}

export async function deliverWebhook(value, payload, { lookup = systemLookup, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const url = await validateWebhookUrl(value, { lookup });
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
}
