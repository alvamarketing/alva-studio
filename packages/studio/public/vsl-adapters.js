import { createVimeoAdapter } from './vimeo-adapter.js';
import { createYouTubeAdapter } from './youtube-adapter.js';

let hlsScriptPromise;

function defaultVideo() {
  if (typeof document === 'undefined') throw new Error('Documento indisponível para o player.');
  return document.createElement('video');
}

async function defaultLoadHls(video, sourceUrl) {
  if (!globalThis.Hls?.isSupported?.()) {
    if (typeof document === 'undefined') throw new Error('Este navegador não suporta streaming HLS.');
    if (!hlsScriptPromise) {
      const existing = document.querySelector('script[data-alva-hls]');
      hlsScriptPromise = existing
        ? new Promise((resolve, reject) => { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); })
        : new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = '/vendor/hls.min.js'; script.dataset.alvaHls = 'true';
          script.onload = resolve; script.onerror = reject; document.head.append(script);
        });
    }
    await hlsScriptPromise;
  }
  if (!globalThis.Hls?.isSupported?.()) throw new Error('Este navegador não suporta streaming HLS.');
  const hls = new globalThis.Hls();
  hls.loadSource(sourceUrl); hls.attachMedia(video);
  if (video.dataset) video.dataset.alvaMediaAttached = 'true';
  return hls;
}

function defaultAutoplay(video, { onBlocked = () => {}, isDestroyed = () => false } = {}) {
  return new Promise((resolve) => {
    let attempted = false;
    const cleanup = () => { video.removeEventListener?.('loadedmetadata', run); video.removeEventListener?.('canplay', run); };
    const run = async () => {
      if (isDestroyed()) { cleanup(); return resolve(); }
      if (attempted || !(video.src || video.currentSrc || video.dataset?.alvaMediaAttached) || video.readyState < 1) return;
      attempted = true;
      try { await video.play(); } catch { onBlocked(); }
      cleanup();
      resolve();
    };
    video.addEventListener('loadedmetadata', run); video.addEventListener('canplay', run); run();
  });
}

export function createNativeAdapter({
  container, config = {}, on = {}, createVideo = defaultVideo,
  createTrack = () => document.createElement('track'),
  canPlayHls = (video) => Boolean(video.canPlayType?.('application/vnd.apple.mpegurl')),
  loadHls = defaultLoadHls,
  autoplay = defaultAutoplay,
} = {}) {
  let video;
  let captionTrack = null;
  let hls = null;
  let destroyed = false;
  const listeners = [];
  const emit = (name, value) => { if (!destroyed) on[name]?.(value); };
  const listen = (name, fn) => { video.addEventListener(name, fn); listeners.push([name, fn]); };
  return {
    capabilities: { milestones: true, poster: true, captions: true, resume: true, status: true },
    async mount() {
      video = createVideo();
      video.className = 'vsl-video'; video.playsInline = true; video.preload = 'metadata'; video.controls = false;
      video.muted = config.autoplayMuted !== false;
      if (config.posterUrl) video.poster = config.posterUrl;
      if (config.captionsUrl) {
        const track = createTrack();
        track.kind = 'subtitles'; track.src = config.captionsUrl; track.srclang = 'pt-BR'; track.label = 'Português'; track.mode = 'disabled';
        video.append?.(track);
        captionTrack = track;
      }
      listen('loadedmetadata', () => emit('metadata', video.duration));
      listen('timeupdate', () => emit('time', video.currentTime));
      listen('play', () => emit('play'));
      listen('pause', () => emit('pause'));
      listen('ended', () => emit('ended'));
      listen('error', () => emit('error', 'Não foi possível reproduzir este vídeo. Verifique o endereço da mídia.'));
      try {
        if (['hls', 'r2-hls'].includes(config.sourceType) && !canPlayHls(video)) {
          const loaded = await loadHls(video, config.sourceUrl);
          if (destroyed) { loaded?.destroy?.(); return video; }
          hls = loaded;
        } else { video.src = config.sourceUrl || ''; video.load?.(); }
      } catch {
        emit('error', 'Não foi possível carregar o streaming HLS.');
        return video;
      }
      container?.replaceChildren?.(video);
      if (!destroyed && config.autoplayMuted !== false) await autoplay(video, { onBlocked: () => on.status?.('Clique em reproduzir para iniciar o vídeo.'), isDestroyed: () => destroyed });
      return video;
    },
    play: () => video?.play?.(),
    pause: () => video?.pause?.(),
    seekTo: (seconds) => { if (video) video.currentTime = Math.max(0, Number(seconds) || 0); },
    setMuted: (muted) => { if (video) video.muted = Boolean(muted); },
    destroy() {
      destroyed = true;
      for (const [name, fn] of listeners) video?.removeEventListener?.(name, fn);
      hls?.destroy?.(); video?.pause?.(); video?.removeAttribute?.('src'); video?.load?.(); container?.replaceChildren?.();
    },
    captionTrack: () => captionTrack,
    element: () => video,
  };
}

export const ADAPTERS = Object.freeze({
  mp4: createNativeAdapter,
  hls: createNativeAdapter,
  r2: createNativeAdapter,
  'r2-hls': createNativeAdapter,
  youtube: createYouTubeAdapter,
  vimeo: createVimeoAdapter,
});
