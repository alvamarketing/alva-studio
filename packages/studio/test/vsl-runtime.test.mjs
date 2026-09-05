import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVslPlayerController, resumeStorageKey } from '../public/vsl-player.js';

test('controlador de VSL calcula progresso real, CTA e marcos uma vez', () => {
  const events = [];
  const controller = createVslPlayerController({ publicId: 'public-vsl-123456', versionId: 'version-1', ctaSeconds: 42, onEvent: (event) => events.push(event) });
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
  const key = resumeStorageKey('vsl-abc', 'version-1');
  const first = createVslPlayerController({ publicId: 'vsl-abc', versionId: 'version-1', duration: 100, resumeEnabled: true, storage });
  first.timeUpdate(35);
  assert.equal(JSON.parse(saved.get(key)).time, 35);
  const second = createVslPlayerController({ publicId: 'vsl-abc', versionId: 'version-1', duration: 100, resumeEnabled: true, storage });
  assert.equal(second.resumeTime(), 35);
  second.ended();
  assert.equal(saved.has(key), false);
});
