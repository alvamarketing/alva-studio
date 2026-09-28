import { normalizarOpcoesDaVsl } from '../public/vsl-opcoes.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function mediaOrigin(sourceUrl) {
  try { return new URL(sourceUrl).origin; } catch { return ''; }
}

export function vslContentSecurityPolicy(sourceUrl, { embed = false, posterUrl = '', captionsUrl = '', studioOrigin = '' } = {}) {
  const sourceOrigin = mediaOrigin(sourceUrl);
  const posterOrigin = mediaOrigin(posterUrl);
  const captionsOrigin = mediaOrigin(captionsUrl);
  const studioConnectOrigin = mediaOrigin(studioOrigin);
  const origins = (...values) => [...new Set(values.filter(Boolean))].join(' ');
  const mediaOrigins = origins(sourceOrigin, captionsOrigin);
  const connectOrigins = origins(sourceOrigin, captionsOrigin, studioConnectOrigin);
  const imageOrigins = origins(posterOrigin);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self'${imageOrigins ? ` ${imageOrigins}` : ''} data:`,
    `media-src 'self'${mediaOrigins ? ` ${mediaOrigins}` : ''}`,
    `connect-src 'self'${connectOrigins ? ` ${connectOrigins}` : ''}`,
    embed ? "frame-ancestors 'self' https:" : "frame-ancestors 'none'",
  ].join('; ');
}

function publicConfig(video) {
  return {
    publicId: video.publicId,
    versionNumber: video.versionNumber ?? video.versionId,
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
    milestones: Array.isArray(video.milestones) && video.milestones.length ? video.milestones : [25, 50, 75, 100],
    opcoes: normalizarOpcoesDaVsl(video.opcoes),
  };
}

export function renderVslPage(video, { embed = false, publicOrigin = '', trackerPublicId = '' } = {}) {
  const config = escapeHtml(JSON.stringify(publicConfig(video)));
  const title = escapeHtml(video.name || 'Vídeo');
  const ratio = escapeHtml(String(video.aspectRatio || '16:9').replace(':', '/'));
  const frameAllow = embed ? ' allow="autoplay"' : '';
  const origin = publicOrigin ? new URL(publicOrigin).origin : '';
  const embedUrl = `${origin}/embed/v/${encodeURIComponent(video.publicId)}`;
  const snippetTitle = escapeHtml(video.name || 'Vídeo');
  const embedSnippet = embed ? '' : `<details class="vsl-embed"><summary>Incorporar este vídeo</summary><textarea readonly aria-label="Código de incorporação">${escapeHtml(`<iframe src="${embedUrl}" title="${snippetTitle}" allow="autoplay" style="width:100%;aspect-ratio:${ratio};border:0" loading="lazy"></iframe>`)}</textarea></details>`;
  // Script de primeira parte, mesma origem que a página: 'self' em script-src já cobre,
  // sem precisar abrir a CSP para a origem do Studio (ver vslContentSecurityPolicy).
  const trackerTag = trackerPublicId ? `<script src="/tracker.js" data-alva-tracker="${escapeHtml(trackerPublicId)}" data-host-url="${escapeHtml(origin)}"></script>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>:root{color-scheme:light;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101828;color:#fff;min-height:100vh;display:grid;place-items:center;padding:clamp(0px,3vw,32px)}.vsl-page{width:min(960px,100%)}.vsl-heading{font-size:clamp(16px,2vw,24px);margin:0 0 14px}.vsl-shell{width:100%;aspect-ratio:${ratio};background:#000;border-radius:${embed ? '0' : '18px'};overflow:hidden}.vsl-player{height:100%;display:flex;flex-direction:column}.vsl-frame{position:relative;min-height:0;flex:1}.vsl-video{width:100%;height:100%;display:block;background:#000;object-fit:contain}.vsl-cta{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);padding:13px 22px;border-radius:999px;background:${escapeHtml(video.accentColor || '#286eea')};color:#fff;text-decoration:none;font-weight:700;white-space:nowrap}.vsl-cta span,.vsl-cta small{display:block;text-align:center}.vsl-cta small{font-weight:500;font-size:.78em;opacity:.9;margin-top:2px}.vsl-som{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:12px;width:100%;border:0;padding:24px;background:rgba(0,0,0,.45);color:#fff;font:700 clamp(16px,3.2vw,26px)/1.2 system-ui,sans-serif;cursor:pointer;text-align:center}.vsl-som svg{width:clamp(40px,8vw,72px);height:auto;animation:vsl-pulso 1.6s ease-in-out infinite}@keyframes vsl-pulso{50%{transform:scale(1.12)}}.vsl-retomar{position:absolute;inset:0;display:grid;place-content:center;gap:10px;padding:24px;background:rgba(0,0,0,.72);text-align:center}.vsl-retomar p{margin:0 0 6px;font-weight:700;font-size:clamp(15px,2.6vw,20px)}.vsl-retomar button{border:0;border-radius:999px;padding:12px 22px;font:600 15px system-ui,sans-serif;cursor:pointer}.vsl-retomar-sim{background:${escapeHtml(video.accentColor || '#286eea')};color:#fff}.vsl-retomar-nao{background:rgba(255,255,255,.14);color:#fff}[hidden]{display:none!important}.vsl-controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 12px;background:#111827}.vsl-controls button{border:0;background:transparent;color:#fff;padding:6px;cursor:pointer}.vsl-seek{flex:1;min-width:0;accent-color:${escapeHtml(video.accentColor || '#286eea')}}.vsl-time{font-variant-numeric:tabular-nums;font-size:12px;color:#c7d2e3}.vsl-status{margin:0;padding:5px 12px;background:#111827;color:#fecaca;overflow-wrap:anywhere;white-space:normal}.vsl-embed{margin-top:16px;color:#c7d2e3}.vsl-embed textarea{display:block;width:100%;min-height:80px;margin-top:8px;background:#111827;color:#fff;border:1px solid #344054;padding:8px}@media(max-width:520px){.vsl-seek{order:10;flex-basis:100%;width:100%}}@media(prefers-reduced-motion:reduce){.vsl-som svg{animation:none}*{scroll-behavior:auto!important;transition:none!important}}</style>${embed ? '<style>body{padding:0;background:#000;place-items:stretch}.vsl-page{width:100%}.vsl-shell{height:100vh;aspect-ratio:auto!important}</style>' : ''}</head><body><main class="vsl-page">${embed ? '' : `<h1 class="vsl-heading">${title}</h1>`}<div class="vsl-shell"${frameAllow} style="aspect-ratio:${ratio}"><div id="vsl-player" class="vsl-player" data-vsl-config="${config}"></div></div>${embedSnippet}</main><script type="module" src="/vsl-player.js"></script>${trackerTag}</body></html>`;
}

export const renderVideoPage = renderVslPage;
