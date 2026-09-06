import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UmamiAnalyticsClient } from '../server/umami-analytics.mjs';

test('lê agregados reais do Umami sem retornar o website remoto', async () => {
  const calls = [];
  const client = new UmamiAnalyticsClient({ baseUrl: 'http://umami.test', username: 'user', password: 'pass', fetchImpl: async (url) => {
    calls.push(url);
    if (url.endsWith('/api/auth/login')) return new Response(JSON.stringify({ token: 'secret' }), { status: 200 });
    if (url.includes('/events/stats?')) return new Response(JSON.stringify({ data: [{ eventName: 'form_start', count: 2 }] }), { status: 200 });
    if (url.includes('type=utmSource')) return new Response(JSON.stringify([{ x: 'meta', y: 4 }, { x: 'google', y: 2 }]), { status: 200 });
    if (url.includes('type=utmMedium')) return new Response(JSON.stringify([{ x: 'paid', y: 4 }, { x: 'organic', y: 2 }]), { status: 200 });
    if (url.includes('type=utmCampaign')) return new Response(JSON.stringify([{ x: 'launch', y: 2 }, { x: 'brand', y: 4 }]), { status: 200 });
    if (url.includes('type=utmTerm')) return new Response(JSON.stringify([{ x: 'demo', y: 4 }, { x: 'marca', y: 2 }]), { status: 200 });
    if (url.includes('type=utmContent')) return new Response(JSON.stringify([{ x: 'hero', y: 4 }, { x: 'footer', y: 2 }]), { status: 200 });
    if (url.includes('/metrics?')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes('/stats?')) return new Response(JSON.stringify({ pageviews: 7, visitors: 3, visits: 4, bounces: 1, totaltime: 12 }), { status: 200 });
    if (url.includes('/pageviews?')) return new Response(JSON.stringify([{ x: '2026-09-01', y: 7 }]), { status: 200 });
    return new Response(JSON.stringify({ data: [{ id: 'session-private', createdAt: 'x' }] }), { status: 200 });
  } });
  const result = await client.read({ remoteWebsiteId: '00000000-0000-4000-8000-000000000001', from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z') });
  assert.deepEqual(result, { pageviews: 7, visitors: 3, visits: 4, bounces: 1, totalTime: 12, dailyVisits: [{ date: '2026-09-01', visits: 7 }], events: [{ name: 'form_start', total: 2 }], sessions: 1, topRoutes: [], sources: [], utms: [], utmDimensions: { source: [{ value: 'meta', total: 4 }, { value: 'google', total: 2 }], medium: [{ value: 'paid', total: 4 }, { value: 'organic', total: 2 }], campaign: [{ value: 'launch', total: 2 }, { value: 'brand', total: 4 }], term: [{ value: 'demo', total: 4 }, { value: 'marca', total: 2 }], content: [{ value: 'hero', total: 4 }, { value: 'footer', total: 2 }] } });
  assert.equal(JSON.stringify(result).includes('00000000'), false);
  assert.equal(calls.some((url) => url.includes('/stats?')), true);
});
