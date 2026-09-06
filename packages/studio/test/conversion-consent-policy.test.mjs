import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildProviderConversion, resolveConsentState } from '../server/conversion-consent-policy.mjs';

const manifest = Object.freeze({
  companyId: 'company-a', projectId: 'project-a', publicationId: 'publication-a',
  snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test',
  domain: 'lp.example.test', environment: 'production',
});
const event = Object.freeze({
  trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'lead',
  eventTime: 1_700_000_000, contentId: 'form-1', value: 19.9, currency: 'BRL',
  attribution: { fbc: 'fb.1.1700000000.click', fbp: 'fb.1.1700000000.browser', gclid: 'google-click', gbraid: 'gbraid-click', wbraid: 'wbraid-click', ttclid: 'tt-click', li_fat_id: 'li-click', tblci: 'tb-click' },
  consent: 'granted', user: { email_sha256: 'forged' }, ip: '203.0.113.1', userAgent: 'forged-agent',
});
const directPii = { email: 'Pessoa@Example.Test ', telefone: '+55 (11) 99999-9999', nested: { email: 'hidden@example.test' }, aliases: ['hidden@example.test'] };
const expectedClickId = { meta: ['fbc', 'fbp'], google: ['gclid', 'gbraid', 'wbraid'], tiktok: ['ttclid'], linkedin: ['linkedin_tracking_uuid'], taboola: ['taboola_click_id'] };

for (const provider of Object.keys(expectedClickId)) {
  for (const consentState of ['pending', 'denied', 'granted']) {
    test(`${provider}/${consentState} preserves tracking id and emits only its allowlist`, () => {
      const payload = buildProviderConversion({ provider, manifest, consentState, browserEvent: event, serverAnswers: directPii });
      assert.equal(payload.tracking_event_id, event.trackingEventId);
      assert.equal(payload.consent_state, consentState);
      assert.equal(JSON.stringify(payload).includes('203.0.113.1'), false);
      assert.equal(JSON.stringify(payload).includes('forged-agent'), false);
      assert.equal(JSON.stringify(payload).includes('forged'), false);
      assert.deepEqual(Object.keys(payload.attribution || {}).sort(), expectedClickId[provider].sort());
      if (consentState === 'granted') {
        assert.deepEqual(payload.user, {
          email_sha256: createHash('sha256').update('pessoa@example.test').digest('hex'),
          phone_sha256: createHash('sha256').update('5511999999999').digest('hex'),
        });
      } else {
        assert.equal('user' in payload, false);
        assert.equal(JSON.stringify(payload).includes('hidden@example.test'), false);
      }
      if (provider === 'google') {
        assert.deepEqual(payload.google_consent, Object.fromEntries(['ad_user_data', 'ad_personalization', 'ad_storage', 'analytics_storage'].map((key) => [key, consentState === 'granted' ? 'granted' : 'denied'])));
        assert.equal('ads_data_redaction' in payload, false);
      }
    });
  }
}

test('browser cannot forge granted consent, hashes, PII, nested values, arrays, or unknown attribution fields', () => {
  assert.equal(resolveConsentState({ manifest, browserEvent: event, storedConsent: { scope: { ...manifest }, state: 'denied' } }), 'denied');
  assert.throws(() => buildProviderConversion({ provider: 'meta', manifest, consentState: 'pending', browserEvent: { ...event, attribution: { fbc: 'ok', unknown: 'nope' } }, serverAnswers: directPii }), /atribuição inválidos/i);
  assert.throws(() => buildProviderConversion({ provider: 'meta', manifest, consentState: 'denied', browserEvent: { ...event, metadata: { email: 'hidden@example.test' } }, serverAnswers: directPii }), /campo.*navegador/i);
  assert.throws(() => buildProviderConversion({ provider: 'meta', manifest, consentState: 'pending', browserEvent: { ...event, attribution: { fbc: ['nope'] } }, serverAnswers: directPii }), /atribuição inválidos/i);
});

test('manifest scope mismatch and future revocation fall back to pending without changing historical payloads', () => {
  const accepted = { scope: { ...manifest }, state: 'granted' };
  assert.equal(resolveConsentState({ manifest, browserEvent: event, storedConsent: accepted }), 'granted');
  assert.equal(resolveConsentState({ manifest: { ...manifest, policyVersion: 2 }, browserEvent: event, storedConsent: accepted }), 'pending');
  const historical = buildProviderConversion({ provider: 'meta', manifest, consentState: 'granted', browserEvent: event, serverAnswers: directPii });
  assert.equal(resolveConsentState({ manifest, browserEvent: event, storedConsent: { ...accepted, state: 'denied' } }), 'denied');
  assert.ok(historical.user.email_sha256);
});

test('aviso de privacidade explica identificadores pseudônimos e processamento limitado sem PII direta', async () => {
  const templates = await readFile(new URL('../public/templates.js', import.meta.url), 'utf8');
  assert.match(templates, /identificadores pseudônimos de atribuição/i);
  assert.match(templates, /processamento limitado/i);
  assert.match(templates, /sem autorização de PII direta/i);
});
