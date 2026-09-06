import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoplayWhenReady,
  createVslPlayerController,
  mapVslEventToTrackerEvent,
  mountVslPlayer,
  resumeStorageKey,
  toggleCaptionTrack,
} from '../public/vsl-player.js';

test('controlador de VSL calcula progresso real, CTA e marcos uma vez', () => {
  const events = [];
  const controller = createVslPlayerController({ publicId: 'public-vsl-123456', versionNumber: 1, ctaSeconds: 42, onEvent: (event) => events.push(event) });
  controller.loadedMetadata(120);
  controller.play();
  controller.timeUpdate(30);
  assert.equal(controller.state().progress, 25);
  controller.timeUpdate(60);
  controller.timeUpdate(90);
  controller.timeUpdate(100);
  assert.equal(controller.state().ctaVisible, true);
  assert.deepEqual(events.filter((event) => event.type === 'milestone').map((event) => event.value), [25, 50, 75]);
  controller.ended();
  assert.equal(controller.state().progress, 100);
  assert.equal(controller.state().completed, true);
  assert.deepEqual(events.filter((event) => event.type === 'milestone').map((event) => event.value), [25, 50, 75, 100]);
});

test('retomada usa chave por VSL e versão e apaga ao concluir', () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  const key = resumeStorageKey('vsl-abc', 1);
  const first = createVslPlayerController({ publicId: 'vsl-abc', versionNumber: 1, duration: 100, resumeEnabled: true, storage });
  first.timeUpdate(35);
  assert.equal(JSON.parse(saved.get(key)).time, 35);
  const second = createVslPlayerController({ publicId: 'vsl-abc', versionNumber: 1, duration: 100, resumeEnabled: true, storage });
  assert.equal(second.resumeTime(), 35);
  second.ended();
  assert.equal(saved.has(key), false);
});

test('autoplay espera mídia anexada e pronta e executa somente uma vez', async () => {
  const listeners = {};
  const video = { src: '', readyState: 0, addEventListener: (event, fn) => { listeners[event] = fn; }, play: async () => { video.plays = (video.plays || 0) + 1; } };
  const pending = autoplayWhenReady(video);
  assert.equal(video.plays, undefined);
  video.src = 'https://media.test/vsl.m3u8'; video.readyState = 1;
  listeners.loadedmetadata(); await pending;
  listeners.loadedmetadata();
  assert.equal(video.plays, 1);
});

test('mapeia cada evento do controlador para o nome e adapter seguro de coleta', () => {
  const base = { publicId: 'public-vsl-123456', versionNumber: 3 };
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'start', adapter: 'youtube', ...base }), { name: 'vsl_start', data: { publicId: base.publicId, versionNumber: 3, adapter: 'youtube' } });
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'milestone', value: 75, ...base }), { name: 'vsl_progress', data: { publicId: base.publicId, versionNumber: 3, value: 75 } });
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'complete', ...base }), { name: 'vsl_complete', data: { publicId: base.publicId, versionNumber: 3 } });
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'cta_click', ...base }), { name: 'vsl_cta_click', data: { publicId: base.publicId, versionNumber: 3 } });
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'error', ...base }), { name: 'vsl_error', data: { publicId: base.publicId, versionNumber: 3 } });
  assert.equal(mapVslEventToTrackerEvent({ type: 'unknown', ...base }), null);
  const events = [];
  const controller = createVslPlayerController({ ...base, duration: 100, onEvent: (event) => events.push(mapVslEventToTrackerEvent(event)) });
  controller.play();
  controller.timeUpdate(100);
  controller.ctaClick();
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('http'), false, 'nenhum evento mapeado pode carregar a URL da mídia');
  assert.deepEqual(events.filter(Boolean).map((event) => event.name), ['vsl_start', 'vsl_progress', 'vsl_progress', 'vsl_progress', 'vsl_progress', 'vsl_cta_click']);
});

test('legenda VTT pode ser ativada por controle acessível', () => {
  const track = { mode: 'disabled' };
  assert.equal(toggleCaptionTrack(track, true), true);
  assert.equal(track.mode, 'showing');
  assert.equal(toggleCaptionTrack(track, false), false);
  assert.equal(track.mode, 'disabled');
  const element = { track: { mode: 'disabled' } };
  toggleCaptionTrack(element, true);
  assert.equal(element.track.mode, 'showing');
});

function fakeElement(tagName) {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    hidden: false,
    paused: true,
    muted: false,
    duration: 100,
    currentTime: 0,
    readyState: 0,
    src: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) ?? [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
    },
    removeEventListener(name, callback) {
      listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== callback));
    },
    emit(name, detail = {}) {
      for (const callback of listeners.get(name) ?? []) callback({ target: this, ...detail });
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'src') this.src = '';
    },
    load() { this.loaded = true; },
    canPlayType() { return 'probably'; },
    async play() {
      this.paused = false;
      this.emit('play');
    },
    pause() {
      this.paused = true;
      this.emit('pause');
    },
  };
  return element;
}

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children ?? []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

async function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.document = {
    createElement: (tagName) => fakeElement(tagName),
    querySelector: () => null,
    readyState: 'complete',
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
      this.bubbles = options.bubbles;
    }
  };
  try {
    await run();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
}

test('mountVslPlayer integra mídia nativa com progresso, CTA, retomada, legenda e cleanup', async () => {
  await withFakeDocument(async () => {
    const tracked = [];
    const saved = new Map([[resumeStorageKey('vsl-native', 1), JSON.stringify({ time: 20 })]]);
    const storage = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    };
    const container = fakeElement('div');
    container.dispatchEvent = (event) => tracked.push(event.detail.name);
    const mounted = mountVslPlayer(container, {
      sourceType: 'mp4',
      sourceUrl: 'https://media.example.test/video.mp4',
      publicId: 'vsl-native',
      versionNumber: 1,
      storage,
      captionsUrl: 'https://media.example.test/captions.vtt',
      autoplayMuted: false,
      ctaText: 'Continuar',
      ctaUrl: '/continuar',
      ctaSeconds: 30,
    });

    await mounted.ready;
    const video = mounted.video;
    video.emit('loadedmetadata');
    assert.equal(video.currentTime, 20);
    findByClass(container, 'vsl-captions').emit('click');
    assert.equal(video.children[0].mode, 'showing');
    video.currentTime = 50;
    video.emit('timeupdate');
    video.emit('play');

    assert.equal(mounted.controller.state().progress, 50);
    assert.equal(findByClass(container, 'vsl-cta').hidden, false);
    assert.equal(findByClass(container, 'vsl-time').textContent, '0:50 / 1:40');
    assert.equal(findByClass(container, 'vsl-captions') !== null, true);
    findByClass(container, 'vsl-cta').emit('click');
    assert.deepEqual(tracked, ['vsl_progress', 'vsl_progress', 'vsl_start', 'vsl_cta_click']);

    mounted.destroy();
    assert.deepEqual(container.children, []);
    assert.equal(video.src, '');
  });
});

test('mountVslPlayer escolhe YouTube, usa controles compartilhados e limpa polling', async () => {
  await withFakeDocument(async () => {
    const previousYouTube = globalThis.YT;
    const previousSetInterval = globalThis.setInterval;
    const previousClearInterval = globalThis.clearInterval;
    const callbacks = {};
    const calls = [];
    globalThis.setInterval = (callback, delay) => {
      callbacks.poll = callback;
      calls.push(['interval', delay]);
      return 41;
    };
    globalThis.clearInterval = (id) => calls.push(['clear', id]);
    globalThis.YT = {
      PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
      Player: function Player(_frame, options) {
        callbacks.state = options.events.onStateChange;
        const player = {
          getCurrentTime: () => 25,
          getDuration: () => 100,
          playVideo: () => calls.push(['play']),
          pauseVideo: () => calls.push(['pause']),
          seekTo: (seconds) => calls.push(['seek', seconds]),
          mute: () => calls.push(['mute']),
          unMute: () => calls.push(['unmute']),
          destroy: () => calls.push(['destroy']),
        };
        options.events.onReady({ target: player });
        return player;
      },
    };

    try {
      const container = fakeElement('div');
      container.dispatchEvent = () => {};
      const mounted = mountVslPlayer(container, {
        sourceType: 'youtube',
        sourceUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        autoplayMuted: false,
      });
      await mounted.ready;
      callbacks.state({ data: 1 });
      callbacks.poll();

      assert.equal(mounted.controller.state().progress, 25);
      assert.deepEqual(calls.slice(0, 2), [['interval', 250]]);
      const seek = findByClass(container, 'vsl-seek');
      seek.value = '50';
      seek.emit('input');
      findByClass(container, 'vsl-play').emit('click');
      findByClass(container, 'vsl-mute').emit('click');
      assert.equal(calls.some(([name]) => name === 'pause'), true);
      assert.equal(calls.some(([name]) => name === 'mute'), true);
      assert.equal(calls.some(([name, value]) => name === 'seek' && value === 50), true);

      mounted.destroy();
      assert.equal(calls.some(([name, value]) => name === 'clear' && value === 41), true);
      assert.equal(calls.some(([name]) => name === 'destroy'), true);
      assert.deepEqual(container.children, []);
    } finally {
      if (previousYouTube === undefined) delete globalThis.YT;
      else globalThis.YT = previousYouTube;
      globalThis.setInterval = previousSetInterval;
      globalThis.clearInterval = previousClearInterval;
    }
  });
});

test('mountVslPlayer escolhe Vimeo e remove listeners no cleanup', async () => {
  await withFakeDocument(async () => {
    const previousVimeo = globalThis.Vimeo;
    const handlers = {};
    const removed = [];
    const player = {
      on: (name, callback) => { handlers[name] = callback; },
      off: (name) => removed.push(name),
      play: () => {},
      pause: () => {},
      getDuration: async () => 120,
      setCurrentTime: () => {},
      setVolume: () => {},
      destroy: () => { player.destroyed = true; },
    };
    globalThis.Vimeo = { Player: function Player() { return player; } };
    try {
      const container = fakeElement('div');
      container.dispatchEvent = () => {};
      const mounted = mountVslPlayer(container, {
        sourceType: 'vimeo',
        sourceUrl: 'https://player.vimeo.com/video/123456',
        autoplayMuted: false,
      });
      await mounted.ready;
      handlers.timeupdate({ seconds: 30, duration: 120 });

      assert.equal(mounted.controller.state().progress, 25);
      mounted.destroy();
      assert.deepEqual(removed.sort(), ['ended', 'error', 'pause', 'play', 'timeupdate']);
      assert.equal(player.destroyed, true);
      assert.deepEqual(container.children, []);
    } finally {
      if (previousVimeo === undefined) delete globalThis.Vimeo;
      else globalThis.Vimeo = previousVimeo;
    }
  });
});

test('Vimeo aplica a retomada uma vez depois da duração inicial, sem saltar no progresso', async () => {
  await withFakeDocument(async () => {
    const previousVimeo = globalThis.Vimeo;
    const handlers = {};
    const seeks = [];
    const player = {
      on: (name, callback) => { handlers[name] = callback; }, off() {}, play() {}, pause() {},
      getDuration: async () => 120, setCurrentTime: (seconds) => seeks.push(seconds), setVolume() {}, destroy() {},
    };
    globalThis.Vimeo = { Player: function Player() { return player; } };
    try {
      const storage = { getItem: () => JSON.stringify({ time: 24 }), setItem() {}, removeItem() {} };
      const mounted = mountVslPlayer(fakeElement('div'), {
        sourceType: 'vimeo', sourceUrl: 'https://player.vimeo.com/video/123456', publicId: 'vsl-vimeo', versionNumber: 1, storage, autoplayMuted: false,
      });
      await mounted.ready;
      handlers.timeupdate({ seconds: 25, duration: 120 });
      handlers.timeupdate({ seconds: 26, duration: 120 });
      assert.deepEqual(seeks, [24]);
      mounted.destroy();
    } finally {
      if (previousVimeo === undefined) delete globalThis.Vimeo;
      else globalThis.Vimeo = previousVimeo;
    }
  });
});

test('status visual do adaptador não emite vsl_error', async () => {
  await withFakeDocument(async () => {
    const tracked = [];
    const container = fakeElement('div');
    container.dispatchEvent = (event) => tracked.push(event.detail.name);
    const mounted = mountVslPlayer(container, {
      sourceType: 'mp4',
      sourceUrl: 'https://media.example.test/video.mp4',
      autoplayMuted: true,
    });
    mounted.video.play = async () => { throw new Error('bloqueado'); };
    mounted.video.readyState = 1;
    mounted.video.emit('loadedmetadata');
    await mounted.ready;

    assert.equal(findByClass(container, 'vsl-status').textContent, 'Clique em reproduzir para iniciar o vídeo.');
    assert.equal(tracked.includes('vsl_error'), false);
    mounted.destroy();
  });
});

test('tipo de mídia desconhecido mostra erro visual sem lançar', async () => {
  await withFakeDocument(async () => {
    const container = fakeElement('div');
    container.dispatchEvent = () => {};
    const mounted = mountVslPlayer(container, { sourceType: 'desconhecido' });
    await mounted.ready;
    assert.equal(findByClass(container, 'vsl-status').textContent, 'Não foi possível carregar este tipo de vídeo.');
    mounted.destroy();
    assert.deepEqual(container.children, []);
  });
});
