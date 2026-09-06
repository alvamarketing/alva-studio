import { ADAPTERS } from './vsl-adapters.js';

const DEFAULT_MILESTONES = [25, 50, 75, 100];

export function resumeStorageKey(publicId, versionNumber) {
  return `alva-vsl-resume:${String(publicId)}:${String(versionNumber)}`;
}

const TRACKER_EVENT_NAMES = {
  start: 'vsl_start', milestone: 'vsl_progress', complete: 'vsl_complete', cta_click: 'vsl_cta_click', error: 'vsl_error',
};

// Traduz o evento do controlador para o nome que o coletor entende, sem nunca incluir a URL da
// mídia — só identificador público, versão e (para marco) o valor atingido.
export function mapVslEventToTrackerEvent(event) {
  const name = TRACKER_EVENT_NAMES[event?.type];
  if (!name) return null;
  const data = { publicId: event.publicId, versionNumber: event.versionNumber };
  if (typeof event.adapter === 'string') data.adapter = event.adapter;
  if (event.type === 'milestone') data.value = event.value;
  return { name, data };
}

export function toggleCaptionTrack(track, enabled) {
  if (!track) return false;
  const textTrack = track.track ?? track;
  textTrack.mode = enabled ? 'showing' : 'disabled';
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
  let resumeApplied = false;
  const controller = createVslPlayerController({
    ...config,
    onEvent: (event) => {
      config.onEvent?.({ ...event, adapter: config.sourceType });
      const mapped = mapVslEventToTrackerEvent({ ...event, adapter: config.sourceType });
      if (mapped) container.dispatchEvent(new CustomEvent('alva:track', { bubbles: true, detail: mapped }));
    },
  });
  const frame = document.createElement('div'); frame.className = 'vsl-frame';
  const media = document.createElement('div'); media.className = 'vsl-media'; frame.append(media);
  const controls = document.createElement('div'); controls.className = 'vsl-controls';
  const playButton = button('Reproduzir', 'vsl-play');
  const muteButton = button('Ativar som', 'vsl-mute');
  const Adapter = ADAPTERS[config.sourceType];
  let adapter = null;
  const captionsButton = config.captionsUrl && Adapter === ADAPTERS.mp4 ? button('Legendas', 'vsl-captions') : null;
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
  if (Adapter) {
    adapter = Adapter({
      container: media,
      config,
      on: {
        metadata: (duration) => {
          controller.loadedMetadata(duration);
          const resume = resumeApplied ? 0 : controller.resumeTime();
          if (resume > 0) adapter.seekTo(resume);
          resumeApplied = true;
          render();
        },
        time: (currentTime) => { controller.timeUpdate(currentTime); render(); },
        play: () => { controller.play(); render(); },
        pause: () => { controller.pause(); render(); },
        ended: () => { controller.ended(); render(); },
        error: (message) => { controller.setError(message); render(); },
        status: (message) => { status.textContent = String(message || ''); },
      },
    });
    controller.setMuted(config.autoplayMuted !== false);
  } else {
    status.textContent = 'Não foi possível carregar este tipo de vídeo.';
  }
  playButton.addEventListener('click', () => {
    const action = controller.state().playing ? adapter?.pause() : adapter?.play();
    Promise.resolve(action).catch(() => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; });
  });
  muteButton.addEventListener('click', () => {
    const muted = !controller.state().muted;
    adapter?.setMuted(muted);
    controller.setMuted(muted);
    render();
  });
  captionsButton?.addEventListener('click', () => {
    const enabled = captionsButton.getAttribute('aria-pressed') !== 'true';
    const captionTrack = adapter?.captionTrack?.();
    captionsButton.setAttribute('aria-pressed', String(toggleCaptionTrack(captionTrack, enabled)));
  });
  seek.addEventListener('input', () => {
    const duration = controller.state().duration;
    if (Number.isFinite(duration)) adapter?.seekTo((Number(seek.value) / 100) * duration);
  });
  cta?.addEventListener('click', () => controller.ctaClick());
  const ready = adapter
    ? Promise.resolve(adapter.mount()).catch((error) => {
      controller.setError(error?.message || 'Não foi possível carregar o vídeo.');
      render();
      return null;
    })
    : Promise.resolve(null);
  render();
  const video = adapter?.element?.() ?? null;
  return {
    adapter,
    controller,
    ready,
    video,
    destroy: () => { adapter?.destroy(); container.replaceChildren(); },
  };
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
