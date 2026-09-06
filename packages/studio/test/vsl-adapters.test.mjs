import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, createNativeAdapter } from '../public/vsl-adapters.js';

function fakeVideo() {
  const listeners = new Map();
  return {
    dataset: {}, paused: true, muted: false, duration: 120, currentTime: 0, src: '',
    addEventListener(name, fn) { listeners.set(name, fn); },
    emit(name) { listeners.get(name)?.(); },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    load() { this.loaded = true; },
    async play() { this.paused = false; this.emit('play'); },
    pause() { this.paused = true; this.emit('pause'); },
  };
}

test('adaptador nativo traduz eventos, controla vídeo e limpa recursos', async () => {
  const video = fakeVideo();
  const container = { replaceChildren(...children) { this.children = children; } };
  const events = [];
  const adapter = createNativeAdapter({ container, config: { sourceUrl: 'https://media.test/video.mp4' }, on: {
    metadata: (value) => events.push(['metadata', value]), time: (value) => events.push(['time', value]),
    play: () => events.push(['play']), pause: () => events.push(['pause']), ended: () => events.push(['ended']), error: (value) => events.push(['error', value]),
  }, createVideo: () => video, autoplay: async () => {} });
  adapter.mount();
  video.emit('loadedmetadata'); video.currentTime = 42; video.emit('timeupdate'); await adapter.play(); adapter.pause(); video.emit('ended'); video.emit('error');
  assert.deepEqual(events, [['metadata', 120], ['time', 42], ['play'], ['pause'], ['ended'], ['error', 'Não foi possível reproduzir este vídeo. Verifique o endereço da mídia.']]);
  adapter.seekTo(7); adapter.setMuted(true);
  assert.equal(video.currentTime, 7); assert.equal(video.muted, true);
  adapter.destroy();
  assert.equal(video.src, ''); assert.equal(video.loaded, true); assert.deepEqual(container.children, []);
});

test('mapa reutiliza nativo para MP4, HLS e R2', () => {
  assert.equal(ADAPTERS.mp4, ADAPTERS.hls);
  assert.equal(ADAPTERS.mp4, ADAPTERS.r2);
  assert.equal(ADAPTERS.mp4, ADAPTERS['r2-hls']);
});

test('HLS usa fallback, autoplay, legenda e não aceita callbacks após destroy', async () => {
  const video = fakeVideo();
  const container = { replaceChildren(...children) { this.children = children; } };
  const track = { kind: '', mode: '', src: '' };
  const hls = { destroy() { this.destroyed = true; } };
  const events = [];
  const adapter = createNativeAdapter({
    container, config: { sourceType: 'hls', sourceUrl: 'https://media.test/video.m3u8', captionsUrl: 'https://media.test/captions.vtt', autoplayMuted: true },
    on: { error: (message) => events.push(message), time: () => events.push('time') },
    createVideo: () => video, createTrack: () => track,
    canPlayHls: () => false, loadHls: async () => hls, autoplay: async () => { video.autoplayed = true; },
  });
  await adapter.mount();
  assert.equal(hls.destroyed, undefined); assert.equal(video.autoplayed, true);
  assert.equal(track.kind, 'subtitles'); assert.equal(track.mode, 'disabled'); assert.equal(track.src, 'https://media.test/captions.vtt');
  assert.equal(adapter.capabilities.captions, true);
  adapter.destroy(); video.currentTime = 3; video.emit('timeupdate'); video.emit('error');
  assert.equal(hls.destroyed, true); assert.deepEqual(events, []);
});

test('mapa declara os provedores futuros explicitamente', () => {
  assert.equal(typeof ADAPTERS.youtube, 'function');
  assert.equal(typeof ADAPTERS.vimeo, 'function');
});

test('falha de HLS encerra mount antes do autoplay', async () => {
  const errors = [];
  let autoplayed = false;
  const adapter = createNativeAdapter({
    container: { replaceChildren() {} },
    config: { sourceType: 'hls', sourceUrl: 'https://media.test/video.m3u8' },
    createVideo: fakeVideo,
    canPlayHls: () => false,
    loadHls: async () => { throw new Error('falhou'); },
    autoplay: async () => { autoplayed = true; },
    on: { error: (message) => errors.push(message) },
  });
  await adapter.mount();
  assert.deepEqual(errors, ['Não foi possível carregar o streaming HLS.']);
  assert.equal(autoplayed, false);
});

test('destroy encerra o ready nativo mesmo sem metadados', async () => {
  const video = fakeVideo();
  const adapter = createNativeAdapter({
    container: { replaceChildren() {} }, config: { sourceType: 'mp4', sourceUrl: 'https://media.test/video.mp4', autoplayMuted: true },
    createVideo: () => video,
  });
  const ready = adapter.mount();
  adapter.destroy();
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('ready permaneceu pendente')), 100))]);
});

test('loader HLS compartilha um único script entre montagens concorrentes', async () => {
  const previousDocument = globalThis.document;
  const previousHls = globalThis.Hls;
  const scripts = [];
  const instances = [];
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: {
      append(script) {
        scripts.push(script);
        queueMicrotask(() => {
          globalThis.Hls = class Hls {
            static isSupported() { return true; }
            constructor() { instances.push(this); }
            loadSource(sourceUrl) { this.sourceUrl = sourceUrl; }
            attachMedia(video) { this.video = video; }
            destroy() { this.destroyed = true; }
          };
          script.onload();
        });
      },
    },
  };
  delete globalThis.Hls;
  try {
    const first = createNativeAdapter({
      container: { replaceChildren() {} },
      config: { sourceType: 'hls', sourceUrl: 'https://media.test/first.m3u8' },
      createVideo: fakeVideo,
      canPlayHls: () => false,
      autoplay: async () => {},
    });
    const second = createNativeAdapter({
      container: { replaceChildren() {} },
      config: { sourceType: 'hls', sourceUrl: 'https://media.test/second.m3u8' },
      createVideo: fakeVideo,
      canPlayHls: () => false,
      autoplay: async () => {},
    });

    await Promise.all([first.mount(), second.mount()]);
    assert.equal(scripts.length, 1);
    assert.equal(instances.length, 2);
    assert.deepEqual(instances.map((instance) => instance.sourceUrl), [
      'https://media.test/first.m3u8',
      'https://media.test/second.m3u8',
    ]);
    first.destroy();
    second.destroy();
    assert.equal(instances.every((instance) => instance.destroyed), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHls === undefined) delete globalThis.Hls;
    else globalThis.Hls = previousHls;
  }
});
