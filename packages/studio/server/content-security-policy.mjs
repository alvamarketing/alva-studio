import { randomBytes } from 'node:crypto';

export function createNonce() {
  return randomBytes(16).toString('base64');
}

export function formContentSecurityPolicy({
  nonce,
  studioOrigin,
  actionOrigin,
  frameOrigins = [],
  pixelDomains = [],
  reportOnly,
} = {}) {
  void reportOnly;
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, ...pixelDomains].join(' ');
  const connectSrc = ["'self'", studioOrigin, ...pixelDomains].filter(Boolean).join(' ');
  const directives = [
    `default-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src https://fonts.gstatic.com`,
    `img-src 'self' data: https:`,
    `media-src https:`,
    `connect-src ${connectSrc}`,
  ];
  if (frameOrigins.length) directives.push(`frame-src ${frameOrigins.join(' ')}`);
  directives.push(`form-action ${actionOrigin}`);
  directives.push(`frame-ancestors 'self'`);
  directives.push(`base-uri 'none'`);
  return directives.join('; ');
}
