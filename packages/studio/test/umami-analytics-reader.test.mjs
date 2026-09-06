import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UmamiAnalyticsReader } from '../server/umami-analytics-reader.mjs';

const base = { totalEvents: 1, pageviews: 1, custom: 0, visitors: 1, sources: [], utms: [], topRoutes: [], conversions: [], vslFunnel: [], dailyVisits: [{ date: '2026-09-01', visits: 1 }], funnel: [] };

test('compõe legado antes do corte e Umami depois sem sobreposição', async () => {
  const calls = [];
  const reader = new UmamiAnalyticsReader({
    database: { query: async () => ({ rows: [{ cutover_at: '2026-09-02T00:00:00Z' }] }) },
    tracking: { remoteWebsiteFor: async (input) => { calls.push({ kind: 'remote', input }); return '00000000-0000-4000-8000-000000000001'; } },
    client: { read: async () => ({ pageviews: 2, visitors: 2, visits: 2, events: [], dailyVisits: [{ date: '2026-09-02', visits: 2 }] }) },
    legacy: { summary: async (input) => { calls.push({ kind: 'legacy', ...input }); return { ...base }; } },
  });
  const result = await reader.summary({ companyId: 'company-a', projectId: 'project-a', actorId: 'user-a', from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-03T00:00:00Z') });
  assert.equal(result.pageviews, 3);
  assert.equal(result.visitors, 3);
  assert.equal(calls.filter((item) => item.kind === 'legacy').length, 1);
  assert.equal(calls.find((item) => item.kind === 'legacy')?.to.toISOString(), '2026-09-02T00:00:00.000Z');
});

test('falha sem binding Umami e nunca devolve website remoto', async () => {
  const reader = new UmamiAnalyticsReader({
    database: { query: async () => ({ rows: [{ cutover_at: '2026-09-01T00:00:00Z' }] }) },
    tracking: { remoteWebsiteFor: async () => null }, client: {}, legacy: { summary: async () => ({}) },
  });
  await assert.rejects(() => reader.summary({ companyId: 'a', projectId: 'b', from: new Date('2026-09-02'), to: new Date('2026-09-03') }), (error) => error.status === 503);
});
