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
