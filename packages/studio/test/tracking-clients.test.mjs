import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UmamiClient } from '../server/tracking-clients.mjs';

test('gateway Umami usa user-agent genérico e falha quando o upstream classifica o evento como bot', async () => {
  const requests = [];
  const client = new UmamiClient({
    baseUrl: 'http://umami.test',
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return new Response(JSON.stringify({ cache: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await client.sendPublicEvent({ type: 'event', payload: {} });
  assert.equal(requests[0].headers['User-Agent'], 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  const rejected = new UmamiClient({
    baseUrl: 'http://umami.test',
    fetchImpl: async () => new Response(JSON.stringify({ beep: 'boop' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(() => rejected.sendPublicEvent({ type: 'event', payload: {} }), /indisponível/);
});
