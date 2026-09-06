function fail(message) {
  return Object.assign(new Error(message), { status: 400, statusCode: 400 });
}

function safeHttpsUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) throw fail('URL da mídia é obrigatória.');
  let url;
  try { url = new URL(text); } catch { throw fail('URL da mídia precisa ser HTTPS e absoluta.'); }
  if (!/^https:\/\//i.test(text) || url.protocol !== 'https:' || !url.hostname || url.username || url.password)
    throw fail('URL da mídia precisa ser HTTPS sem credenciais.');
  return text;
}

function studioOrigin(value) {
  if (!value) throw fail('Informe a origem HTTPS do Studio.');
  let url;
  try { url = new URL(String(value)); } catch { throw fail('Informe a origem HTTPS do Studio.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw fail('Informe a origem HTTPS do Studio.');
  return url.origin;
}

function providerUrl(value, label) {
  const text = safeHttpsUrl(value);
  const url = new URL(text);
  if (url.port) throw fail(`URL do ${label} não aceita porta personalizada.`);
  return url;
}

function youtubeId(value) {
  const text = String(value ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const url = providerUrl(text, 'YouTube');
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'youtu.be' || host === 'www.youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.slice('/embed/'.length);
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw fail('URL do YouTube inválida.');
  return id;
}

function vimeoId(value) {
  const text = String(value ?? '').trim();
  if (/^\d{6,12}$/.test(text)) return text;
  const url = providerUrl(text, 'Vimeo');
  const host = url.hostname.toLowerCase();
  let id = '';
  if (host === 'vimeo.com' || host === 'www.vimeo.com') id = url.pathname.slice(1);
  else if (host === 'player.vimeo.com' && url.pathname.startsWith('/video/')) id = url.pathname.slice('/video/'.length);
  if (!/^\d{6,12}$/.test(id)) throw fail('URL do Vimeo inválida.');
  return id;
}

export const PROVIDER_CSP = Object.freeze({
  youtube: Object.freeze({
    frame: Object.freeze(['https://www.youtube.com']),
    script: Object.freeze(['https://www.youtube.com']),
    connect: Object.freeze(['https://www.youtube.com']),
  }),
  vimeo: Object.freeze({
    frame: Object.freeze(['https://player.vimeo.com']),
    script: Object.freeze(['https://player.vimeo.com']),
    connect: Object.freeze(['https://player.vimeo.com']),
  }),
});

export function providerEmbedUrl(sourceType, providerVideoId, providerConfig = {}) {
  if (sourceType === 'youtube') {
    const id = youtubeId(providerVideoId);
    const params = new URLSearchParams({ enablejsapi: '1' });
    const origin = studioOrigin(providerConfig.studioOrigin);
    if (origin) params.set('origin', origin);
    params.set('autoplay', '1');
    params.set('mute', '1');
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }
  if (sourceType === 'vimeo') {
    const id = vimeoId(providerVideoId);
    return `https://player.vimeo.com/video/${id}?autoplay=1&muted=1`;
  }
  throw fail('Tipo de mídia inválido.');
}

export function parseMediaSource({ sourceType, sourceUrl } = {}, { studioOrigin: configuredStudioOrigin } = {}) {
  const type = sourceType || (/\.m3u8(?:$|[?#])/i.test(String(sourceUrl ?? '')) ? 'hls' : 'mp4');
  if (type === 'youtube') {
    const providerVideoId = youtubeId(sourceUrl);
    return { sourceType: type, providerVideoId, providerConfig: {}, sourceUrl: providerEmbedUrl(type, providerVideoId, { studioOrigin: configuredStudioOrigin }) };
  }
  if (type === 'vimeo') {
    const providerVideoId = vimeoId(sourceUrl);
    return { sourceType: type, providerVideoId, providerConfig: {}, sourceUrl: providerEmbedUrl(type, providerVideoId) };
  }
  if (!['mp4', 'hls'].includes(type)) throw fail('Tipo de mídia inválido.');
  return { sourceType: type, providerVideoId: null, providerConfig: {}, sourceUrl: safeHttpsUrl(sourceUrl) };
}
