import { normalizarOpcoesDaVsl } from './vsl-opcoes.js';

const DEFAULT_MILESTONES = [25, 50, 75, 100];
let hlsScriptPromise;

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
  if (event.type === 'milestone') data.value = event.value;
  return { name, data };
}

// O que a página que embute a VSL precisa saber: o segundo do vídeo (para revelar seções)
// e os marcos (para o pixel do projeto). Vai com origem "*" porque a página do cliente pode
// estar em qualquer domínio; por isso leva só o identificador público, nunca a mídia.
const TIPOS_DA_MENSAGEM = { start: 'inicio', milestone: 'marco', complete: 'fim', cta_click: 'cta' };
export function mensagemDaVsl(event) {
  const tipo = TIPOS_DA_MENSAGEM[event?.type];
  if (!tipo) return null;
  return { alvaVsl: 1, tipo, publicId: event.publicId, ...(event.type === 'milestone' ? { valor: event.value } : {}) };
}

export function toggleCaptionTrack(track, enabled) {
  if (!track) return false;
  const textTrack = track.track ?? track;
  textTrack.mode = enabled ? 'showing' : 'disabled';
  return Boolean(enabled);
}

export function createVslPlayerController({
  publicId = '', versionNumber, versionId, duration = 0, ctaSeconds = null, resumeEnabled = true,
  milestones = DEFAULT_MILESTONES, storage = globalThis.localStorage, onEvent = () => {}, travarAvanco = false,
} = {}) {
  const publicVersion = versionNumber ?? versionId ?? '';
  const key = resumeStorageKey(publicId, publicVersion);
  const fired = new Set();
  const state = {
    duration: Number(duration) > 0 ? Number(duration) : 0, currentTime: 0, progress: 0,
    playing: false, muted: true, ctaVisible: false, completed: false, error: '', assistido: 0,
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
      state.assistido = Math.max(state.assistido, state.currentTime);
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
    // Com a trava, a barra só leva até onde a pessoa já assistiu; voltar é livre.
    destinoDoAvanco(value) {
      const alvo = Math.max(0, Number(value) || 0);
      return travarAvanco ? Math.min(alvo, state.assistido) : alvo;
    },
    // A retomada conta como assistida: quem volta pode seguir dali.
    marcarAssistido(value) { state.assistido = Math.max(state.assistido, Number(value) || 0); },
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

// `podeTocar`: a pergunta de retomada segura o autoplay — o vídeo não começa mudo atrás dela.
export function autoplayWhenReady(video, { onBlocked = () => {}, podeTocar = () => true } = {}) {
  return new Promise((resolve) => {
    let attempted = false;
    const run = async () => {
      if (attempted || !(video.src || video.currentSrc || video.dataset?.alvaMediaAttached) || video.readyState < 1) return;
      attempted = true;
      if (podeTocar()) {
        try { await video.play(); } catch { onBlocked(); }
      }
      resolve();
    };
    video.addEventListener('loadedmetadata', run);
    video.addEventListener('canplay', run);
    run();
  });
}

// Ícone de som (Lucide "volume-2"), fixo: nada do conteúdo da VSL passa por aqui.
const ICONE_DO_SOM = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>';

export function mountVslPlayer(container, config = {}) {
  if (!container || typeof document === 'undefined') throw new Error('Container do player é obrigatório.');
  const opcoes = normalizarOpcoesDaVsl(config.opcoes);
  const embutido = () => typeof window !== 'undefined' && window.parent && window.parent !== window;
  const avisarPagina = (dados) => {
    if (!embutido()) return;
    try { window.parent.postMessage(dados, '*'); } catch { /* página sem acesso: nada a avisar */ }
  };
  const controller = createVslPlayerController({
    ...config,
    travarAvanco: opcoes.travarAvanco,
    onEvent: (event) => {
      config.onEvent?.(event);
      const mapped = mapVslEventToTrackerEvent(event);
      if (mapped) container.dispatchEvent(new CustomEvent('alva:track', { bubbles: true, detail: mapped }));
      const mensagem = mensagemDaVsl(event);
      if (mensagem) avisarPagina(mensagem);
    },
  });
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
  time.hidden = opcoes.ocultarTempo;
  controls.append(playButton, muteButton); captionsButton && controls.append(captionsButton); controls.append(seek, time);
  const status = document.createElement('p'); status.className = 'vsl-status'; status.setAttribute('role', 'status');

  // Som inteligente: o vídeo começa mudo (os navegadores só deixam assim) e um aviso grande
  // cobre o quadro. O toque liga o som e recomeça do zero, para ninguém perder o começo.
  let avisoDoSom = null;
  if (opcoes.somInteligente && config.autoplayMuted !== false) {
    avisoDoSom = button('', 'vsl-som');
    avisoDoSom.innerHTML = ICONE_DO_SOM;
    const rotulo = document.createElement('span'); rotulo.textContent = opcoes.textoDoSom;
    avisoDoSom.append(rotulo);
    frame.append(avisoDoSom);
  }
  // Quem volta escolhe: seguir de onde parou ou recomeçar. As duas saídas já ligam o som.
  const retomar = document.createElement('div'); retomar.className = 'vsl-retomar'; retomar.hidden = true;
  const pergunta = document.createElement('p'); pergunta.textContent = 'Você já começou a assistir este vídeo.';
  const continuar = button('Continuar de onde parei', 'vsl-retomar-sim'); continuar.dataset.retomar = 'continuar';
  const recomecar = button('Assistir do início', 'vsl-retomar-nao'); recomecar.dataset.retomar = 'recomecar';
  retomar.append(pergunta, continuar, recomecar);
  frame.append(retomar);
  let pontoDeRetomada = 0;

  let cta = null;
  if (config.ctaText && config.ctaUrl) {
    cta = document.createElement('a'); cta.className = 'vsl-cta'; cta.href = config.ctaUrl; cta.hidden = true;
    const rotulo = document.createElement('span'); rotulo.textContent = config.ctaText; cta.append(rotulo);
    if (opcoes.ctaSubtexto) { const subtexto = document.createElement('small'); subtexto.textContent = opcoes.ctaSubtexto; cta.append(subtexto); }
    cta.style.background = opcoes.ctaCor || config.accentColor || '#286eea';
    cta.style.color = opcoes.ctaCorDoTexto;
    frame.append(cta);
  }
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
  const tocarComSom = (tempo) => {
    if (avisoDoSom) avisoDoSom.hidden = true;
    retomar.hidden = true;
    video.muted = false; controller.setMuted(false);
    video.currentTime = tempo;
    controller.timeUpdate(tempo);
    video.play().catch(() => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; });
    render();
  };
  let ultimoSegundo = -1;
  video.addEventListener('loadedmetadata', () => {
    controller.loadedMetadata(video.duration);
    const resume = controller.resumeTime();
    if (resume > 0) {
      controller.marcarAssistido(resume);
      if (opcoes.perguntarAoRetomar) {
        pontoDeRetomada = resume;
        if (avisoDoSom) avisoDoSom.hidden = true;
        retomar.hidden = false;
        if (!video.paused) video.pause();
      } else video.currentTime = resume;
    }
    render();
  });
  video.addEventListener('timeupdate', () => {
    controller.timeUpdate(video.currentTime);
    const segundo = Math.floor(video.currentTime || 0);
    if (segundo !== ultimoSegundo) { ultimoSegundo = segundo; avisarPagina({ alvaVsl: 1, tipo: 'tempo', publicId: config.publicId, segundos: segundo }); }
    render();
  });
  video.addEventListener('play', () => { controller.play(); render(); });
  video.addEventListener('pause', () => { controller.pause(); render(); });
  video.addEventListener('ended', () => { controller.ended(); render(); });
  video.addEventListener('volumechange', () => { if (!video.muted && avisoDoSom) avisoDoSom.hidden = true; });
  video.addEventListener('error', () => { controller.setError('Não foi possível reproduzir este vídeo. Verifique o endereço da mídia.'); render(); });
  playButton.addEventListener('click', () => {
    if (!retomar.hidden) { tocarComSom(pontoDeRetomada); return; }
    if (video.paused) video.play().catch(() => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; }); else video.pause();
  });
  muteButton.addEventListener('click', () => { video.muted = !video.muted; controller.setMuted(video.muted); if (avisoDoSom) avisoDoSom.hidden = true; render(); });
  avisoDoSom?.addEventListener('click', () => tocarComSom(0));
  continuar.addEventListener('click', () => tocarComSom(pontoDeRetomada));
  recomecar.addEventListener('click', () => tocarComSom(0));
  captionsButton?.addEventListener('click', () => { const enabled = captionsButton.getAttribute('aria-pressed') !== 'true'; captionsButton.setAttribute('aria-pressed', String(toggleCaptionTrack(captionTrack, enabled))); });
  seek.addEventListener('input', () => {
    if (!Number.isFinite(video.duration)) return;
    const destino = controller.destinoDoAvanco((Number(seek.value) / 100) * video.duration);
    video.currentTime = destino;
    controller.timeUpdate(destino);
    render();
  });
  cta?.addEventListener('click', (event) => {
    controller.ctaClick();
    // Dentro da página do cliente, o CTA leva a página toda, não só o quadro do vídeo. Um
    // caminho relativo é do site do cliente: quem navega é a página, que conhece o domínio.
    if (!embutido()) return;
    const destino = String(config.ctaUrl);
    if (destino.startsWith('/') && !destino.startsWith('//')) {
      event.preventDefault();
      avisarPagina({ alvaVsl: 1, tipo: 'abrir', publicId: config.publicId, caminho: destino });
    } else cta.target = '_top';
  });
  // Fora da aba o vídeo pausa (ninguém perde trecho sem ver) e volta quando a aba volta.
  let pausadoPelaAba = false;
  const aoTrocarDeAba = () => {
    if (document.hidden) {
      if (!video.paused) { pausadoPelaAba = true; video.pause(); }
    } else if (pausadoPelaAba) {
      pausadoPelaAba = false;
      video.play().catch(() => {});
    }
  };
  if (opcoes.pausarForaDaAba) document.addEventListener('visibilitychange', aoTrocarDeAba);
  const autoplay = config.autoplayMuted !== false
    ? autoplayWhenReady(video, { onBlocked: () => { status.textContent = 'Clique em reproduzir para iniciar o vídeo.'; }, podeTocar: () => retomar.hidden })
    : Promise.resolve();
  if (config.sourceType === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
    loadHls(video, config.sourceUrl).catch((error) => { controller.setError(error.message); render(); });
  } else { video.src = config.sourceUrl; video.load(); }
  autoplay.catch(() => {});
  render();
  return {
    controller, video,
    destroy: () => {
      document.removeEventListener('visibilitychange', aoTrocarDeAba);
      video.pause(); video.removeAttribute('src'); video.load(); container.replaceChildren();
    },
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
