import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoplayWhenReady, createVslPlayerController, mapVslEventToTrackerEvent, resumeStorageKey, toggleCaptionTrack } from '../public/vsl-player.js';

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

test('mapeia cada evento do controlador para o nome de coleta correspondente, sem URL de mídia', () => {
  const base = { publicId: 'public-vsl-123456', versionNumber: 3 };
  assert.deepEqual(mapVslEventToTrackerEvent({ type: 'start', ...base }), { name: 'vsl_start', data: { publicId: base.publicId, versionNumber: 3 } });
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
