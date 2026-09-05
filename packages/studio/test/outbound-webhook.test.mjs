import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deliverWebhook, pinnedLookup, pinnedFetch } from '../server/outbound-webhook.mjs';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const event = {
  eventId: '00000000-0000-4000-8000-000000000001',
  event: 'form.submitted',
  companyId: '00000000-0000-4000-8000-000000000002',
  projectId: '00000000-0000-4000-8000-000000000003',
  formId: '00000000-0000-4000-8000-000000000004',
  submittedAt: '2026-09-05T12:00:00.000Z',
  answers: { email: 'lead@alva.test' },
};

test('entrega um POST JSON sem repassar credenciais ou cabeçalhos da requisição original', async () => {
  const calls = [];
  const result = await deliverWebhook({
    url: 'https://hooks.example.test/lead',
    event,
    dnsLookup: publicDns,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, body: 'resposta privada que nunca deve ser exposta' };
    },
  });

  assert.deepEqual(result, { status: 'delivered' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.example.test/lead');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), event);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('falha sem egress para URL com credenciais, IPs internos e DNS privado', async () => {
  for (const [url, dnsLookup] of [
    ['https://user:secret@hooks.example.test/lead', publicDns],
    ['https://hooks.example.test/lead', async () => [{ address: '127.0.0.1', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.1', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '10.1.2.3', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '169.254.1.1', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '224.0.0.1', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '0.0.0.0', family: 4 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '::1', family: 6 }]],
    ['https://hooks.example.test/lead', async () => [{ address: 'fc00::1', family: 6 }]],
    ['https://hooks.example.test/lead', async () => [{ address: 'fe80::1', family: 6 }]],
    ['https://hooks.example.test/lead', async () => [{ address: 'ff02::1', family: 6 }]],
    ['https://hooks.example.test/lead', async () => [{ address: '::', family: 6 }]],
  ]) {
    let fetchCalled = false;
    const result = await deliverWebhook({
      url,
      event,
      dnsLookup,
      fetchImpl: async () => { fetchCalled = true; return { ok: true }; },
    });
    assert.deepEqual(result, { status: 'failed' }, url);
    assert.equal(fetchCalled, false, url);
  }
});

test('falha em timeout, resposta não-2xx e redirecionamento remoto', async () => {
  const timeout = await deliverWebhook({
    url: 'https://hooks.example.test/lead', event, dnsLookup: publicDns, timeoutMs: 1,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  assert.deepEqual(timeout, { status: 'failed' });

  const non2xx = await deliverWebhook({
    url: 'https://hooks.example.test/lead', event, dnsLookup: publicDns,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(non2xx, { status: 'failed' });

  const redirect = await deliverWebhook({
    url: 'https://hooks.example.test/lead', event, dnsLookup: publicDns,
    fetchImpl: async () => ({ ok: false, status: 302, redirected: true }),
  });
  assert.deepEqual(redirect, { status: 'failed' });
});

test('pinnedLookup sempre resolve para o endereço já validado, ignorando o hostname pedido', async () => {
  const lookup = pinnedLookup('93.184.216.34');
  const result = await new Promise((resolve, reject) => {
    lookup('qualquer-outro-host.invalid', {}, (error, address, family) => (error ? reject(error) : resolve({ address, family })));
  });
  assert.deepEqual(result, { address: '93.184.216.34', family: 4 });

  const ipv6Lookup = pinnedLookup('2001:db8::1');
  const ipv6Result = await new Promise((resolve, reject) => {
    ipv6Lookup('outro-host.invalid', {}, (error, address, family) => (error ? reject(error) : resolve({ address, family })));
  });
  assert.deepEqual(ipv6Result, { address: '2001:db8::1', family: 6 });
});

test('pinnedFetch conecta sempre no endereço fixado, mesmo quando o hostname da URL não resolveria para lá', async (t) => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ receivedPath: req.url, receivedBody: body }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const response = await pinnedFetch(
    `http://este-host-nao-existe-de-verdade.invalid:${port}/lead`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) },
    '127.0.0.1',
  );
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
});

test('deliverWebhook repassa ao transporte o endereço já revalidado nesta tentativa', async () => {
  const calls = [];
  const result = await deliverWebhook({
    url: 'https://hooks.example.test/lead',
    event,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url, options, pinnedAddress) => {
      calls.push(pinnedAddress);
      return { ok: true };
    },
  });
  assert.deepEqual(result, { status: 'delivered' });
  assert.deepEqual(calls, ['93.184.216.34']);
});
