const verifiedAt = '2026-09-05';

function provider({ identifier, source, csp }) {
  return Object.freeze({
    identifier,
    pageview: 'pageview',
    source,
    verifiedAt,
    csp: Object.freeze(Object.fromEntries(Object.entries(csp).map(([directive, origins]) => [directive, Object.freeze([...origins])]))),
  });
}

export const PIXEL_PROVIDERS = Object.freeze({
  meta_pixel: provider({
    identifier: Object.freeze({ label: 'Pixel ID' }),
    source: 'https://developers.facebook.com/docs/meta-pixel/get-started',
    csp: { script: ['https://connect.facebook.net'], connect: ['https://www.facebook.com'], img: ['https://www.facebook.com'] },
  }),
  ga4: provider({
    identifier: Object.freeze({ label: 'Measurement ID' }),
    source: 'https://developers.google.com/tag-platform/security/guides/csp',
    csp: {
      script: ['https://www.googletagmanager.com'],
      connect: ['https://www.google-analytics.com', 'https://region1.google-analytics.com'],
      img: ['https://www.google-analytics.com'],
    },
  }),
  tiktok_pixel: provider({
    identifier: Object.freeze({ label: 'Pixel ID' }),
    source: 'https://ads.tiktok.com/help/article/tiktok-pixel',
    csp: { script: ['https://analytics.tiktok.com'], connect: ['https://analytics.tiktok.com'], img: ['https://analytics.tiktok.com'] },
  }),
  linkedin_insight: provider({
    identifier: Object.freeze({ label: 'Partner ID' }),
    source: 'https://business.linkedin.com/advertise/ads/insight-tag',
    csp: {
      script: ['https://snap.licdn.com'],
      connect: ['https://snap.licdn.com', 'https://px.ads.linkedin.com'],
      img: ['https://px.ads.linkedin.com'],
    },
  }),
  taboola_pixel: provider({
    identifier: Object.freeze({ label: 'Account ID' }),
    source: 'https://help.taboola.com/hc/en-us/articles/360002100673',
    csp: { script: ['https://cdn.taboola.com'], connect: ['https://trc.taboola.com'], img: ['https://trc.taboola.com'] },
  }),
});

const identifierValidators = Object.freeze({
  meta_pixel: /^\d{5,20}$/,
  ga4: /^G-[A-Z0-9]{6,20}$/,
  tiktok_pixel: /^[A-Za-z0-9]{8,64}$/,
  linkedin_insight: /^\d{5,20}$/,
  taboola_pixel: /^\d{5,20}$/,
});

function pixelProvider(slug) {
  if (!Object.hasOwn(PIXEL_PROVIDERS, slug)) throw new Error('Provedor de pixel desconhecido.');
  return PIXEL_PROVIDERS[slug];
}

export function validatePixelConfiguration(slug, input) {
  pixelProvider(slug);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'enabled') || !Object.hasOwn(input, 'identifier'))
    throw new Error('Configuração de pixel inválida.');
  const { enabled, identifier } = input;
  if (typeof enabled !== 'boolean' || typeof identifier !== 'string' || !identifierValidators[slug].test(identifier))
    throw new Error('Identificador de pixel inválido.');
  return { enabled, identifier };
}

export function providerOrigins(slugs) {
  if (!Array.isArray(slugs)) throw new Error('Provedores de pixel inválidos.');
  const enabled = new Set(slugs);
  for (const slug of enabled) pixelProvider(slug);
  const result = { script: [], connect: [], img: [] };
  for (const [slug, provider] of Object.entries(PIXEL_PROVIDERS)) {
    if (!enabled.has(slug)) continue;
    for (const directive of Object.keys(result)) {
      for (const origin of provider.csp[directive]) {
        if (!result[directive].includes(origin)) result[directive].push(origin);
      }
    }
  }
  return result;
}
