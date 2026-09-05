function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function mediaOrigin(sourceUrl) {
  try { return new URL(sourceUrl).origin; } catch { return 'null'; }
}

export function vslContentSecurityPolicy(sourceUrl, { embed = false } = {}) {
  const origin = mediaOrigin(sourceUrl);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${origin} data:`,
    `media-src 'self' ${origin}`,
    `connect-src 'self' ${origin}`,
    embed ? 'frame-ancestors https:' : "frame-ancestors 'none'",
  ].join('; ');
}

function publicConfig(video) {
  return {
    publicId: video.publicId,
    versionId: video.versionId,
    sourceUrl: video.sourceUrl,
    sourceType: video.sourceType,
    posterUrl: video.posterUrl,
    captionsUrl: video.captionsUrl,
    accentColor: video.accentColor,
    aspectRatio: video.aspectRatio,
    autoplayMuted: video.autoplayMuted,
    resumeEnabled: video.resumeEnabled,
    ctaText: video.ctaText,
    ctaUrl: video.ctaUrl,
    ctaSeconds: video.ctaSeconds,
    milestones: [25, 50, 75, 100],
  };
}

export function renderVslPage(video, { embed = false } = {}) {
  const config = escapeHtml(JSON.stringify(publicConfig(video)));
  const title = escapeHtml(video.name || 'Vídeo');
  const ratio = escapeHtml(String(video.aspectRatio || '16:9').replace(':', '/'));
  const frameAllow = embed ? ' allow="autoplay"' : '';
  const embedSnippet = embed ? '' : `<details class="vsl-embed"><summary>Incorporar este vídeo</summary><textarea readonly aria-label="Código de incorporação">${escapeHtml(`<iframe src="/embed/v/${video.publicId}" title="${video.name || 'Vídeo'}" allow="autoplay" style="width:100%;aspect-ratio:${ratio};border:0" loading="lazy"></iframe>`)}</textarea></details>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>:root{color-scheme:light;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101828;color:#fff;min-height:100vh;display:grid;place-items:center;padding:clamp(0px,3vw,32px)}.vsl-page{width:min(960px,100%)}.vsl-heading{font-size:clamp(16px,2vw,24px);margin:0 0 14px}.vsl-shell{width:100%;aspect-ratio:${ratio};background:#000;border-radius:${embed ? '0' : '18px'};overflow:hidden}.vsl-player{height:100%;display:flex;flex-direction:column}.vsl-frame{position:relative;min-height:0;flex:1}.vsl-video{width:100%;height:100%;display:block;background:#000;object-fit:contain}.vsl-cta{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);padding:13px 22px;border-radius:999px;background:${escapeHtml(video.accentColor || '#286eea')};color:#fff;text-decoration:none;font-weight:700;white-space:nowrap}.vsl-controls{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#111827}.vsl-controls button{border:0;background:transparent;color:#fff;padding:6px;cursor:pointer}.vsl-seek{flex:1;accent-color:${escapeHtml(video.accentColor || '#286eea')}}.vsl-time{font-variant-numeric:tabular-nums;font-size:12px;color:#c7d2e3}.vsl-status{margin:0;padding:5px 12px;background:#111827;color:#fecaca;font-size:12px}.vsl-embed{margin-top:16px;color:#c7d2e3}.vsl-embed textarea{display:block;width:100%;min-height:80px;margin-top:8px;background:#111827;color:#fff;border:1px solid #344054;padding:8px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}</style></head><body><main class="vsl-page"><h1 class="vsl-heading">${title}</h1><div class="vsl-shell"${frameAllow} style="aspect-ratio:${ratio}"><div id="vsl-player" class="vsl-player" data-vsl-config="${config}"></div></div>${embedSnippet}</main><script type="module" src="/vsl-player.js"></script></body></html>`;
}

export const renderVideoPage = renderVslPage;
