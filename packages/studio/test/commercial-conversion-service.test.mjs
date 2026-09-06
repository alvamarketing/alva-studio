import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommercialConversionService } from '../server/commercial-conversion-service.mjs';

const manifest = { companyId: 'company', projectId: 'project', publicationId: 'pub', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production' };
const browserEvent = { trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'lead', eventTime: 1_700_000_000, contentId: 'form-1', attribution: { fbc: 'fbc', fbp: 'fbp', gclid: 'gclid', ttclid: 'ttclid', li_fat_id: 'li', tblci: 'tb' }, consent: 'granted', user: { email_sha256: 'forged' } };
const answers = { email: 'Pessoa@Example.Test ', telefone: '+55 (11) 99999-9999' };

for (const state of ['pending', 'denied', 'granted']) {
  test(`fan-out persists and calls all five enabled adapters in ${state}`, async () => {
    const local = []; const nvs = []; const calls = [];
    const adapters = Object.fromEntries(['meta', 'google', 'tiktok', 'linkedin', 'taboola'].map((provider) => [provider, async (payload) => calls.push([provider, payload])]));
    const service = new CommercialConversionService({ persist: async (event) => local.push(event), enqueueNvs: async (event) => nvs.push(event), adapters, technicalEnabled: () => true });
    await service.deliver({ manifest, storedConsent: { scope: manifest, state }, browserEvent, serverAnswers: answers, enabledProviders: Object.keys(adapters) });
    assert.equal(local.length, 1); assert.equal(nvs.length, 1); assert.equal(calls.length, 5);
    assert.ok(calls.every(([, payload]) => payload.tracking_event_id === browserEvent.trackingEventId && payload.consent_state === state));
    assert.equal(JSON.stringify(calls).includes('forged'), false);
    assert.equal(JSON.stringify(calls).includes('Pessoa@Example'), false);
    if (state === 'granted') assert.ok(calls.every(([, payload]) => payload.user?.email_sha256));
    else assert.ok(calls.every(([, payload]) => !('user' in payload)));
  });
}

test('technical flag or disabled provider are the only egress gates and do not block persistence', async () => {
  const persisted = []; const nvs = []; const calls = [];
  const service = new CommercialConversionService({ persist: async (event) => persisted.push(event), enqueueNvs: async (event) => nvs.push(event), adapters: { meta: async () => calls.push('meta'), google: async () => calls.push('google') }, technicalEnabled: (provider) => provider !== 'google' });
  const result = await service.deliver({ manifest, storedConsent: { scope: manifest, state: 'denied' }, browserEvent, serverAnswers: answers, enabledProviders: ['meta'] });
  assert.equal(persisted.length, 1); assert.equal(nvs.length, 1); assert.deepEqual(calls, ['meta']);
  assert.deepEqual(result.blocked.sort(), ['google:technical_disabled', 'tiktok:provider_disabled', 'linkedin:provider_disabled', 'taboola:provider_disabled'].sort());
});
