import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeAdapter } from '../public/youtube-adapter.js';
import { createVimeoAdapter } from '../public/vimeo-adapter.js';

test('YouTube consulta tempo e duração a cada 250 ms e destrói polling', async () => {
  const callbacks = {};
  const events = [];
  const previous = globalThis.setInterval;
  const previousClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, delay) => {
    callbacks.poll = fn;
    callbacks.delay = delay;
    return 7;
  };
  globalThis.clearInterval = () => { callbacks.cleared = true; };
  try {
    const YT = {
      PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
      Player: function Player(_frame, options) {
        const instance = {
          getDuration: () => 90,
          getCurrentTime: () => 12,
          destroy() {},
        };
        callbacks.state = options.events.onStateChange;
        options.events.onReady({ target: instance });
        return instance;
      },
    };
    const adapter = createYouTubeAdapter({
      config: {
        sourceUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&origin=https%3A%2F%2Fstudio.example.test&autoplay=1&mute=1',
      },
      on: {
        play: () => events.push(['play']),
        time: (value) => events.push(['time', value]),
        metadata: (value) => events.push(['metadata', value]),
      },
      loadApi: async () => YT,
    });
    await adapter.mount();
    callbacks.state({ data: 1 });
    callbacks.poll();
    adapter.destroy();
    assert.equal(callbacks.delay, 250);
    assert.deepEqual(events, [['metadata', 90], ['play'], ['metadata', 90], ['time', 12]]);
    assert.equal(callbacks.cleared, true);
  } finally {
    globalThis.setInterval = previous;
    globalThis.clearInterval = previousClear;
  }
});

test('Vimeo emite duração ao montar, usa eventos push sem polling e remove listeners', async () => {
  const events = []; const handlers = {}; const player = {
    on: (n, fn) => { handlers[n] = fn; }, off: (n) => { delete handlers[n]; }, destroy() {}, getDuration: async () => 20,
  };
  const adapter = createVimeoAdapter({ config: { sourceUrl: 'https://player.vimeo.com/video/123456' }, on: { time: (v) => events.push(['time', v]), metadata: (v) => events.push(['metadata', v]) }, loadApi: async () => ({ Player: function () { return player; } }) });
  await adapter.mount(); handlers.timeupdate({ seconds: 8, duration: 20 }); adapter.destroy();
  assert.deepEqual(events, [['metadata', 20], ['time', 8]]); assert.equal(handlers.timeupdate, undefined);
});

test('YouTube carrega a IFrame API uma vez quando ela ainda não existe', async () => {
  const previousDocument = globalThis.document;
  const previousYouTube = globalThis.YT;
  const previousReady = globalThis.onYouTubeIframeAPIReady;
  const scripts = [];
  globalThis.document = {
    querySelector: () => null,
    createElement: (tagName) => ({ tagName, dataset: {} }),
    head: {
      append(script) {
        scripts.push(script);
        queueMicrotask(() => {
          globalThis.YT = {
            PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
            Player: function Player() { return { destroy() {} }; },
          };
          globalThis.onYouTubeIframeAPIReady();
        });
      },
    },
  };
  delete globalThis.YT;
  try {
    const container = { replaceChildren() {} };
    const first = createYouTubeAdapter({ container, config: { sourceUrl: 'https://www.youtube.com/embed/first' } });
    const second = createYouTubeAdapter({ container, config: { sourceUrl: 'https://www.youtube.com/embed/second' } });
    await Promise.all([first.mount(), second.mount()]);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://www.youtube.com/iframe_api');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousYouTube === undefined) delete globalThis.YT;
    else globalThis.YT = previousYouTube;
    if (previousReady === undefined) delete globalThis.onYouTubeIframeAPIReady;
    else globalThis.onYouTubeIframeAPIReady = previousReady;
  }
});

test('Vimeo carrega player.js uma vez quando a API ainda não existe', async () => {
  const previousDocument = globalThis.document;
  const previousVimeo = globalThis.Vimeo;
  const scripts = [];
  globalThis.document = {
    querySelector: () => null,
    createElement: (tagName) => ({ tagName, dataset: {} }),
    head: {
      append(script) {
        scripts.push(script);
        queueMicrotask(() => {
          globalThis.Vimeo = {
            Player: function Player() {
              return { on() {}, off() {}, destroy() {} };
            },
          };
          script.onload();
        });
      },
    },
  };
  delete globalThis.Vimeo;
  try {
    const container = { replaceChildren() {} };
    const first = createVimeoAdapter({ container, config: { sourceUrl: 'https://player.vimeo.com/video/123' } });
    const second = createVimeoAdapter({ container, config: { sourceUrl: 'https://player.vimeo.com/video/456' } });
    await Promise.all([first.mount(), second.mount()]);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://player.vimeo.com/api/player.js');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousVimeo === undefined) delete globalThis.Vimeo;
    else globalThis.Vimeo = previousVimeo;
  }
});
