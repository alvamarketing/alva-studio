import { normalizarOpcoesDaVsl } from '../public/vsl-opcoes.js';
import { cssDoPlayer } from '../public/vsl-player-css.js';

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

// Quem está configurando não é visitante. O player dentro do Studio — o bloco de VSL no
// editor, a prévia da página, a prévia da própria tela de VSL — é a mesma página
// `/embed/v/…` que a landing publicada embute, e ela leva o tracker do projeto. Sem esta
// trava, abrir o editor somava visita, visitante e taxa de rejeição no Analytics do cliente.
// O Studio pede `previa=1`; o Referer da própria origem do Studio é a rede de segurança,
// para quando o navegador o envia.
export function medirEstaVisita({ previa = false, referer = '', studioOrigin = '' } = {}) {
  if (previa) return false;
  try {
    return new URL(String(referer)).origin !== new URL(String(studioOrigin)).origin;
  } catch {
    return true;
  }
}

export function renderVslPage(video, { embed = false, publicOrigin = '', trackerPublicId = '', medir = true } = {}) {
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
  const trackerTag = trackerPublicId && medir !== false ? `<script src="/tracker.js" data-alva-tracker="${escapeHtml(trackerPublicId)}" data-host-url="${escapeHtml(origin)}"></script>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>:root{color-scheme:light;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101828;color:#fff;min-height:100vh;display:grid;place-items:center;padding:clamp(0px,3vw,32px)}.vsl-page{width:min(960px,100%)}.vsl-heading{font-size:clamp(16px,2vw,24px);margin:0 0 14px}.vsl-shell{width:100%;aspect-ratio:${ratio};background:#000;border-radius:${embed ? '0' : '18px'};overflow:hidden}.vsl-embed{margin-top:16px;color:#c7d2e3}.vsl-embed textarea{display:block;width:100%;min-height:80px;margin-top:8px;background:#111827;color:#fff;border:1px solid #344054;padding:8px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}${cssDoPlayer(video.accentColor)}</style>${embed ? '<style>body{padding:0;background:#000;place-items:stretch}.vsl-page{width:100%}.vsl-shell{height:100vh;aspect-ratio:auto!important}</style>' : ''}</head><body><main class="vsl-page">${embed ? '' : `<h1 class="vsl-heading">${title}</h1>`}<div class="vsl-shell"${frameAllow} style="aspect-ratio:${ratio}"><div id="vsl-player" class="vsl-player" data-vsl-config="${config}"></div></div>${embedSnippet}</main><script type="module" src="/vsl-player.js"></script>${trackerTag}</body></html>`;
}

export const renderVideoPage = renderVslPage;
