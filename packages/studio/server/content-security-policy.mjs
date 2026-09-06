import { randomBytes } from 'node:crypto';

export function createNonce() {
  return randomBytes(16).toString('base64');
}

function values(value) {
  return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string' && item);
}

export function buildContentSecurityPolicy({
  nonce, scriptSrc, styleSrc, fontSrc, imgSrc, mediaSrc, connectSrc, frameSrc, formAction, frameAncestors, baseUri,
} = {}) {
  if (!frameAncestors) throw new Error('frame-ancestors deve ser explícito.');
  const scripts = values(scriptSrc);
  if (nonce) scripts.splice(Math.min(1, scripts.length), 0, `'nonce-${nonce}'`);
  const directives = ["default-src 'none'"];
  const append = (name, value) => {
    const list = values(value);
    if (list.length) directives.push(`${name} ${list.join(' ')}`);
  };
  append('script-src', scripts);
  append('style-src', styleSrc);
  append('font-src', fontSrc);
  append('img-src', imgSrc);
  append('media-src', mediaSrc);
  append('connect-src', connectSrc);
  append('frame-src', frameSrc);
  append('form-action', formAction);
  directives.push(`frame-ancestors ${frameAncestors}`);
  append('base-uri', baseUri);
  return directives.join('; ');
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
  return buildContentSecurityPolicy({
    nonce,
    scriptSrc: ["'self'", ...pixelDomains],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ['https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https:'],
    mediaSrc: ['https:'],
    connectSrc: ["'self'", studioOrigin, ...pixelDomains],
    frameSrc: frameOrigins,
    formAction: actionOrigin,
    frameAncestors: "'self'",
    baseUri: "'none'",
  });
}
