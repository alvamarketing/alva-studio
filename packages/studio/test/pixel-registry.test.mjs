import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIXEL_PROVIDERS, providerOrigins, validatePixelConfiguration } from '../server/pixel-registry.mjs';

test('registro fecha os cinco provedores, suas fontes oficiais e as origens de CSP verificadas', () => {
  assert.deepEqual(Object.keys(PIXEL_PROVIDERS), ['meta_pixel', 'ga4', 'tiktok_pixel', 'linkedin_insight', 'taboola_pixel']);
  assert.deepEqual(PIXEL_PROVIDERS.meta_pixel.csp, {
    script: ['https://connect.facebook.net'], connect: ['https://www.facebook.com'], img: ['https://www.facebook.com'],
  });
  assert.deepEqual(PIXEL_PROVIDERS.ga4.csp, {
    script: ['https://www.googletagmanager.com'],
    connect: ['https://www.google-analytics.com', 'https://region1.google-analytics.com'],
    img: ['https://www.google-analytics.com'],
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(PIXEL_PROVIDERS).map(([slug, provider]) => [slug, provider.source])),
    {
      meta_pixel: 'https://developers.facebook.com/docs/meta-pixel/get-started',
      ga4: 'https://developers.google.com/tag-platform/security/guides/csp',
      tiktok_pixel: 'https://ads.tiktok.com/help/article/tiktok-pixel',
      linkedin_insight: 'https://business.linkedin.com/advertise/ads/insight-tag',
      taboola_pixel: 'https://help.taboola.com/hc/en-us/articles/360002100673',
    },
  );
  for (const provider of Object.values(PIXEL_PROVIDERS)) {
    assert.equal(provider.pageview, 'pageview');
    assert.equal(provider.verifiedAt, '2026-09-05');
    assert.match(provider.source, /^https:\/\//);
  }
  assert.deepEqual(providerOrigins(['meta_pixel', 'ga4']), {
    script: ['https://connect.facebook.net', 'https://www.googletagmanager.com'],
    connect: ['https://www.facebook.com', 'https://www.google-analytics.com', 'https://region1.google-analytics.com'],
    img: ['https://www.facebook.com', 'https://www.google-analytics.com'],
  });
  assert.deepEqual(providerOrigins(['ga4']), {
    script: ['https://www.googletagmanager.com'],
    connect: ['https://www.google-analytics.com', 'https://region1.google-analytics.com'],
    img: ['https://www.google-analytics.com'],
  });
  for (const origins of Object.values(providerOrigins(Object.keys(PIXEL_PROVIDERS)))) {
    assert.equal(origins.includes('https:'), false);
    assert.equal(origins.includes('*'), false);
  }
});

test('registro recusa configurações que não sejam apenas enabled e identificador seguro', () => {
  assert.deepEqual(validatePixelConfiguration('meta_pixel', { enabled: true, identifier: '123456789012345' }), { enabled: true, identifier: '123456789012345' });
  assert.deepEqual(validatePixelConfiguration('ga4', { enabled: false, identifier: 'G-ABC123DEF4' }), { enabled: false, identifier: 'G-ABC123DEF4' });
  for (const input of [
    { enabled: true, identifier: 'https://connect.facebook.net/en_US/fbevents.js' },
    { enabled: true, identifier: '<script>window.evil()</script>' },
    { enabled: true, identifier: 'example.com' },
    { enabled: true, identifier: 'G-ABC123DEF4', token: 'segredo' },
    { enabled: 'true', identifier: '123456789012345' },
    { enabled: true, identifier: 'G-NOT-A-META-ID' },
  ]) assert.throws(() => validatePixelConfiguration('meta_pixel', input), /pixel|configura|identificador/i);
  assert.throws(() => validatePixelConfiguration('desconhecido', { enabled: true, identifier: 'id' }), /provedor/i);
  assert.throws(() => providerOrigins(['ga4', 'desconhecido']), /provedor/i);
  for (const inheritedSlug of ['__proto__', 'constructor']) {
    assert.throws(() => validatePixelConfiguration(inheritedSlug, { enabled: true, identifier: '123456789012345' }), /provedor/i);
    assert.throws(() => providerOrigins([inheritedSlug]), /provedor/i);
  }
});
