import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeConsentGateway } from '../server/runtime-consent-gateway.mjs';

const manifest = { companyId: 'company', projectId: 'project', publicationId: 'pub', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production' };

test('gateway resolves only the server manifest and accepts named actions instead of browser state/hash', async () => {
  const calls = [];
  const records = new Map();
  const repository = {
    async currentForOrigin({ publicationId, origin }) { return publicationId === 'pub' && origin === manifest.origin ? manifest : null; },
    async currentConsent({ manifest: current, subjectId }) { return records.get(`${current.publicationId}:${subjectId}`) || null; },
    async recordConsent({ manifest: current, subjectId, state }) { calls.push({ current, subjectId, state }); const result = { state }; records.set(`${current.publicationId}:${subjectId}`, result); return result; },
  };
  const gateway = new RuntimeConsentGateway({ repository });
  assert.deepEqual(await gateway.handle({ method: 'GET', publicationId: 'pub', origin: manifest.origin, subjectId: 'visitor-opaque-1' }), { state: 'pending' });
  assert.deepEqual(await gateway.handle({ method: 'POST', publicationId: 'pub', origin: manifest.origin, subjectId: 'visitor-opaque-1', body: { action: 'grant', state: 'granted', hash: 'forged' } }), { state: 'granted' });
  assert.deepEqual(calls[0], { current: manifest, subjectId: 'visitor-opaque-1', state: 'granted' });
  assert.deepEqual(await gateway.handle({ method: 'POST', publicationId: 'pub', origin: manifest.origin, subjectId: 'visitor-opaque-1', body: { action: 'revoke' } }), { state: 'denied' });
  assert.deepEqual(await gateway.handle({ method: 'GET', publicationId: 'pub', origin: 'https://other.example.test', subjectId: 'visitor-opaque-1' }), { state: 'pending' });
  await assert.rejects(() => gateway.handle({ method: 'POST', publicationId: 'pub', origin: manifest.origin, subjectId: 'visitor-opaque-1', body: { state: 'granted' } }), /ação/i);
});
