let youtubeApiPromise;

function loadYouTubeApi() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (typeof document === 'undefined') return Promise.reject(new Error('Documento indisponível.'));
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = globalThis.onYouTubeIframeAPIReady;
      globalThis.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        if (globalThis.YT?.Player) resolve(globalThis.YT);
        else reject(new Error('A API do YouTube não ficou disponível.'));
      };
      const existing = document.querySelector('script[data-alva-youtube]');
      if (existing) {
        existing.addEventListener?.('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.dataset.alvaYoutube = 'true';
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return youtubeApiPromise;
}

export function createYouTubeAdapter({ container, config = {}, on = {}, loadApi = loadYouTubeApi } = {}) {
  let player;
  let timer = null;
  let destroyed = false;
  const emit = (name, value) => { if (!destroyed) on[name]?.(value); };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    capabilities: { milestones: true, poster: false, captions: false, resume: true },
    async mount() {
      try {
        const YT = await loadApi();
        if (destroyed) return null;
        const frame = typeof document === 'undefined' ? {} : document.createElement('div');
        frame.className = 'vsl-provider-frame';
        container?.replaceChildren?.(frame);
        const source = new URL(config.sourceUrl);
        const videoId = source.pathname.split('/').filter(Boolean).at(-1);
        player = new YT.Player(frame, {
          videoId,
          playerVars: {
            autoplay: config.autoplayMuted === false ? 0 : 1,
            mute: config.autoplayMuted === false ? 0 : 1,
            enablejsapi: 1,
            origin: source.searchParams.get('origin') || globalThis.location?.origin,
          },
          events: {
            onStateChange: ({ data }) => {
              if (data === YT.PlayerState.PLAYING) {
                emit('play');
                stop();
                timer = setInterval(() => {
                  emit('metadata', player.getDuration());
                  emit('time', player.getCurrentTime());
                }, 250);
              }
              if (data === YT.PlayerState.PAUSED) {
                stop();
                emit('pause');
              }
              if (data === YT.PlayerState.ENDED) {
                stop();
                emit('ended');
              }
            },
            onReady: ({ target }) => emit('metadata', target?.getDuration?.() ?? 0),
            onError: () => emit('error', 'Não foi possível reproduzir o vídeo do YouTube.'),
          },
        });
      } catch {
        emit('error', 'Não foi possível carregar o YouTube.');
      }
      return player;
    },
    play: () => player?.playVideo?.(),
    pause: () => player?.pauseVideo?.(),
    seekTo: (seconds) => player?.seekTo?.(seconds, true),
    setMuted: (muted) => muted ? player?.mute?.() : player?.unMute?.(),
    destroy() {
      destroyed = true;
      stop();
      player?.destroy?.();
      container?.replaceChildren?.();
    },
  };
}
