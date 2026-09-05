import { lookup } from 'node:dns/promises';

function fail(message = 'Informe um webhook HTTPS válido.', status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

export function validateWebhookUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2000) throw fail();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail();
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail();
  return url.toString();
}

function ipv4Number(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => (value << 8) + Number(part), 0);
}

function forbiddenIpv4(address) {
  const value = ipv4Number(address);
  if (value === null) return true;
  return forbiddenIpv4Number(value);
}

function forbiddenIpv4Number(value) {
  return (value >>> 24) === 0
    || (value >>> 24) === 127
    || (value >>> 24) === 10
    || ((value >>> 20) === 0xac1)
    || ((value >>> 16) === 0xa9fe)
    || ((value >>> 16) === 0xc0a8)
    || (value >>> 28) === 0xe;
}

function ipv6Number(address) {
  let value = String(address).toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (value.includes('%')) return null;
  if (value.includes('.')) {
    const cut = value.lastIndexOf(':');
    const ipv4 = ipv4Number(value.slice(cut + 1));
    if (ipv4 === null) return null;
    value = `${value.slice(0, cut)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parse = (side) => side ? side.split(':') : [];
  const left = parse(halves[0]);
  const right = parse(halves[1]);
  if (left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || right.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (parts.length !== 8) return null;
  return parts.reduce((result, part) => (result << 16n) + BigInt(`0x${part}`), 0n);
}

function forbiddenIpv6(address) {
  const value = ipv6Number(address);
  if (value === null) return true;
  if (value === 0n || value === 1n || (value >> 120n) === 0xffn) return true;
  if ((value >> 121n) === 0x7en || (value >> 118n) === 0x3fan) return true;
  if (value <= 0xffffffffn || (value >> 32n) === 0xffffn) return forbiddenIpv4Number(Number(value & 0xffffffffn));
  return false;
}

function forbiddenAddress(address) {
  const value = String(address).replace(/^\[/, '').replace(/\]$/, '');
  return value.includes(':') ? forbiddenIpv6(value) : forbiddenIpv4(value);
}

function destinationHost(url) {
  return url.hostname.replace(/^\[/, '').replace(/\]$/, '');
}

export async function deliverWebhook({
  url: rawUrl,
  event,
  fetchImpl = globalThis.fetch,
  dnsLookup = lookup,
  timeoutMs = 3000,
}) {
  try {
    const url = new URL(validateWebhookUrl(rawUrl));
    const addresses = await dnsLookup(destinationHost(url), { all: true, verbatim: true });
    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    if (!resolved.length || resolved.some(({ address }) => forbiddenAddress(address))) return { status: 'failed' };
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response?.ok ? 'delivered' : 'failed' };
  } catch {
    return { status: 'failed' };
  }
}
