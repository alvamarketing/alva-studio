const DEFAULT_MILESTONES = [25, 50, 75, 100];
let hlsScriptPromise;

export function resumeStorageKey(publicId, versionNumber) {
  return `alva-vsl-resume:${String(publicId)}:${String(versionNumber)}`;
}

export function toggleCaptionTrack(track, enabled) {
  if (!track) return false;
  track.mode = enabled ? 'showing' : 'disabled';
  return Boolean(enabled);
}

export function createVslPlayerController({
  publicId = '', versionNumber, versionId, duration = 0, ctaSeconds = null, resumeEnabled = true,
  milestones = DEFAULT_MILESTONES, storage = globalThis.localStorage, onEvent = () => {},
} = {}) {
  const publicVersion = versionNumber ?? versionId ?? '';
  const key = resumeStorageKey(publicId, publicVersion);
  const fired = new Set();
  const state = {
    duration: Number(duration) > 0 ? Number(duration) : 0, currentTime: 0, progress: 0,
    playing: false, muted: true, ctaVisible: false, completed: false, error: '',
  };
  const mark = (type, extra = {}) => onEvent({ type, publicId, versionNumber: publicVersion, ...extra });
  const save = () => {
    if (!resumeEnabled || !storage || state.completed || !state.duration || state.currentTime <= 0) return;
    try { storage.setItem(key, JSON.stringify({ time: state.currentTime })); } catch { /* storage can be unavailable */ }
  };
  const updateMilestones = () => {
    for (const milestone of milestones) {
      if (fired.has(milestone) || state.progress < milestone) continue;
      fired.add(milestone);
      mark('milestone', { value: milestone });
    }
  };
  return {
    state: () => ({ ...state }),
    loadedMetadata(value) {
      if (Number.isFinite(value) && value >= 0) state.duration = Number(value);
      return this.state();
    },
    play() {
      if (!state.playing) { state.playing = true; mark('start'); }
      return this.state();
    },
    pause() { state.playing = false; return this.state(); },
    setMuted(value) { state.muted = Boolean(value); return this.state(); },
    timeUpdate(value) {
      const time = Math.max(0, Number(value) || 0);
      state.currentTime = state.duration ? Math.min(time, state.duration) : time;
      state.progress = state.duration ? Math.min(100, Math.max(0, (state.currentTime / state.duration) * 100)) : 0;
      state.ctaVisible = ctaSeconds !== null && Number.isFinite(Number(ctaSeconds)) && state.currentTime >= Number(ctaSeconds);
      updateMilestones();
      save();
      return this.state();
    },
    ended() {
      if (state.duration) { state.currentTime = state.duration; state.progress = 100; }
      state.playing = false; state.completed = true; state.ctaVisible = true;
      updateMilestones();
      try { storage?.removeItem(key); } catch { /* storage can be unavailable */ }
      mark('complete');
      return this.state();
    },
    resumeTime() {
      if (!resumeEnabled || !storage) return 0;
      try {
        const value = JSON.parse(storage.getItem(key) || 'null')?.time;
        return Number.isFinite(value) && value > 0 && (!state.duration || value < state.duration - 1) ? value : 0;
      } catch { return 0; }
    },
    ctaClick() { mark('cta_click'); },
    setError(message) { state.error = String(message || 'Não foi possível carregar o vídeo.'); mark('error'); return this.state(); },
  };
}

function button(label, className, type = 'button') {
  const element = document.createElement('button');
  element.type = type; element.className = className; element.textContent = label;
  return element;
}

async function loadHls(video, sourceUrl) {
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

export function autoplayWhenReady(video, { onBlocked = () => {} } = {}) {
  return new Promise((resolve) => {
    let attempted = false;
    const run = async () => {
      if (attempted || !(video.src || video.currentSrc || video.dataset?.alvaMediaAttached) || video.readyState < 1) return;
      attempted = true;
      try { await video.play(); } catch { onBlocked(); }
      resolve();
    };
    video.addEventListener('loadedmetadata', run);
    video.addEventListener('canplay', run);
    run();
  });
}

export function mountVslPlayer(container, config = {}) {
  if (!container || typeof document === 'undefined') throw new Error('Container do player é obrigatório.');
  const controller = createVslPlayerController(config);
  const video = document.createElement('video');
  video.className = 'vsl-video'; video.playsInline = true; video.preload = 'metadata'; video.muted = config.autoplayMuted !== false;
  if (config.posterUrl) video.poster = config.posterUrl;
  video.controls = false;
  let captionTrack = null;
  if (config.captionsUrl) { captionTrack = document.createElement('track'); captionTrack.kind = 'subtitles'; captionTrack.src = config.captionsUrl; captionTrack.srclang = 'pt-BR'; captionTrack.label = 'Português'; captionTrack.mode = 'disabled'; video.append(captionTrack); }
  const frame = document.createElement('div'); frame.className = 'vsl-frame'; frame.append(video);
  const controls = document.createElement('div'); controls.className = 'vsl-controls';
  const playButton = button('Reproduzir', 'vsl-play');
  const muteButton = button('Ativar som', 'vsl-mute');
  const captionsButton = config.captionsUrl ? button('Legendas', 'vsl-captions') : null;
  captionsButton?.setAttribute('aria-pressed', 'false');
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '100'; seek.step = '0.1'; seek.value = '0'; seek.className = 'vsl-seek'; seek.setAttribute('aria-label', 'Progresso do vídeo');
  const time = document.createElement('span'); time.className = 'vsl-time'; time.textContent = '0:00 / 0:00';
  controls.append(playButton, muteButton); captionsButton && controls.append(captionsButton); controls.append(seek, time);
  const status = document.createElement('p'); status.className = 'vsl-status'; status.setAttribute('role', 'status');
  let cta = null;
  if (config.ctaText && config.ctaUrl) { cta = document.createElement('a'); cta.className = 'vsl-cta'; cta.textContent = config.ctaText; cta.href = config.ctaUrl; cta.hidden = true; frame.append(cta); }
  container.replaceChildren(frame, controls, status);
  const render = () => {
    const current = controller.state();
    seek.value = String(current.progress);
    playButton.textContent = current.playing ? 'Pausar' : 'Reproduzir';
    muteButton.textContent = current.muted ? 'Ativar som' : 'Silenciar';
    if (cta) cta.hidden = !current.ctaVisible;
    if (current.error) status.textContent = current.error;
    time.textContent = `${formatTime(current.currentTime)} / ${formatTime(current.duration)}`;
  };
  video.addEventListener('loadedmetadata', () => { controller.loadedMetadata(video.duration); const resume = controller.resumeTime(); if (resume > 0) video.currentTime = resume; render(); });
  video.addEventListener('timeupdate', () => { controller.timeUpdate(video.currentTime); render(); });
  video.addEventListener('play', () => { controller.play(); render(); });
  video.addEventListener('pause', () => { controller.pause(); render(); });
  video.addEventListener('ended', () => { controller.ended(); render(); });
  video.addEventListener('error', () => { controller.setError('Não foi possível reproduzir este vídeo. Verifique o endereço da mídia.'); render(); });
  playButton.addEventListener('click', () => { if (video.paused) video.play().catch(() => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; }); else video.pause(); });
  muteButton.addEventListener('click', () => { video.muted = !video.muted; controller.setMuted(video.muted); render(); });
  captionsButton?.addEventListener('click', () => { const enabled = captionsButton.getAttribute('aria-pressed') !== 'true'; captionsButton.setAttribute('aria-pressed', String(toggleCaptionTrack(captionTrack, enabled))); });
  seek.addEventListener('input', () => { if (Number.isFinite(video.duration)) video.currentTime = (Number(seek.value) / 100) * video.duration; });
  cta?.addEventListener('click', () => controller.ctaClick());
  const autoplay = config.autoplayMuted !== false
    ? autoplayWhenReady(video, { onBlocked: () => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; } })
    : Promise.resolve();
  if (config.sourceType === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
    loadHls(video, config.sourceUrl).catch((error) => { controller.setError(error.message); render(); });
  } else { video.src = config.sourceUrl; video.load(); }
  autoplay.catch(() => {});
  render();
  return { controller, video, destroy: () => { video.pause(); video.removeAttribute('src'); video.load(); container.replaceChildren(); } };
}

export function bootVslPlayers(root = document) {
  for (const container of root.querySelectorAll('[data-vsl-config]')) {
    try { mountVslPlayer(container, JSON.parse(container.dataset.vslConfig)); }
    catch { container.textContent = 'Não foi possível carregar o player.'; }
  }
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bootVslPlayers());
  else bootVslPlayers();
}
