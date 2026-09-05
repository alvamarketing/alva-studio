export function allowedPublicationOrigin(origin, allowedOrigins = []) {
  if (typeof origin !== 'string' || !origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    return allowedOrigins.some((allowed) => {
      try { return new URL(allowed).origin === parsed.origin; } catch { return false; }
    });
  } catch { return false; }
}

export function publicSubmissionCors({ method, origin, expectedOrigin, allowedOrigins = [] }) {
  const requestOrigin = typeof origin === 'string' ? origin : '';
  if (requestOrigin && requestOrigin === expectedOrigin) return { allowed: true, corsOrigin: null };
  if (!requestOrigin) return { allowed: method === 'POST', corsOrigin: null };
  const allowed = allowedPublicationOrigin(requestOrigin, allowedOrigins);
  return { allowed, corsOrigin: allowed ? requestOrigin : null };
}

export function customDomainOriginAllowed(origin, host) {
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(`https://${host}`).origin; } catch { return false; }
}
