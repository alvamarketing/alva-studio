let vimeoApiPromise;

function loadVimeoApi() {
  if (globalThis.Vimeo?.Player) return Promise.resolve(globalThis.Vimeo);
  if (typeof document === 'undefined') return Promise.reject(new Error('Documento indisponível.'));
  if (!vimeoApiPromise) {
    vimeoApiPromise = new Promise((resolve, reject) => {
      const finish = () => {
        if (globalThis.Vimeo?.Player) resolve(globalThis.Vimeo);
        else reject(new Error('A API do Vimeo não ficou disponível.'));
      };
      const existing = document.querySelector('script[data-alva-vimeo]');
      if (existing) {
        existing.addEventListener?.('load', finish, { once: true });
        existing.addEventListener?.('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://player.vimeo.com/api/player.js';
      script.dataset.alvaVimeo = 'true';
      script.onload = finish;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return vimeoApiPromise;
}

export function createVimeoAdapter({ container, config = {}, on = {}, loadApi = loadVimeoApi } = {}) {
  let player;
  let destroyed = false;
  const listeners = [];
  const emit = (name, value) => { if (!destroyed) on[name]?.(value); };
  return {
    capabilities: { milestones: true, poster: false, captions: false, resume: true },
    async mount() {
      try {
        const Vimeo = await loadApi();
        if (destroyed) return null;
        const frame = typeof document === 'undefined' ? {} : document.createElement('iframe');
        frame.src = config.sourceUrl;
        frame.className = 'vsl-video';
        frame.allow = 'autoplay; fullscreen; picture-in-picture';
        container?.replaceChildren?.(frame);
        player = new Vimeo.Player(frame);
        const events = [
          ['play', () => emit('play')],
          ['pause', () => emit('pause')],
          ['ended', () => emit('ended')],
          ['timeupdate', ({ seconds }) => {
            emit('time', seconds);
          }],
          ['error', () => emit('error', 'Não foi possível reproduzir o vídeo do Vimeo.')],
        ];
        for (const [event, callback] of events) {
          player.on(event, callback);
          listeners.push([event, callback]);
        }
        const duration = await player.getDuration?.();
        if (Number.isFinite(duration)) emit('metadata', duration);
      } catch {
        emit('error', 'Não foi possível carregar o Vimeo.');
      }
      return player;
    },
    play: () => player?.play?.(),
    pause: () => player?.pause?.(),
    seekTo: (seconds) => player?.setCurrentTime?.(seconds),
    setMuted: (muted) => player?.setVolume?.(muted ? 0 : 1),
    destroy() {
      destroyed = true;
      for (const [event, callback] of listeners) player?.off?.(event, callback);
      player?.destroy?.();
      container?.replaceChildren?.();
    },
  };
}
