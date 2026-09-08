import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';

const bloco = (id) => blocks.find(([blocoId]) => blocoId === id);

test('o vídeo de fora diz de onde vem, e não se confunde com a VSL do Studio', () => {
  assert.equal(bloco('embedded-video')[1], 'Vídeo do YouTube ou Vimeo');
  assert.equal(bloco('vsl')[1], 'VSL do Studio');
  assert.match(blockDescriptions.vsl, /Studio|própri/i);
});

test('o texto de espera fala em link, não em URL HTTPS', () => {
  const html = bloco('embedded-video')[3];
  assert.doesNotMatch(html, /URL HTTPS/);
  assert.match(html, /link do v[íi]deo/i);
});
