import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medirEstaVisita, renderVslPage } from '../server/vsl-public.mjs';

const video = {
  publicId: 'public-vsl-123456', versionNumber: 1, name: 'VSL', sourceUrl: 'https://media.test/v.m3u8', sourceType: 'hls',
  accentColor: '#286eea', aspectRatio: '16:9', autoplayMuted: true, resumeEnabled: true,
};
const STUDIO = 'https://studio.example.test';

test('quem abre o player dentro do Studio não vira visita do projeto', () => {
  // O editor de páginas e a prévia embutem o player pedindo `previa=1`.
  assert.equal(medirEstaVisita({ previa: true, referer: '', studioOrigin: STUDIO }), false);
  // Rede de segurança: veio de uma página do próprio Studio, é quem está configurando.
  assert.equal(medirEstaVisita({ previa: false, referer: `${STUDIO}/editor.html?pagina=1`, studioOrigin: STUDIO }), false);
});

test('a visita de quem chega pela página publicada continua contando', () => {
  assert.equal(medirEstaVisita({ previa: false, referer: 'https://cliente.com.br/oferta', studioOrigin: STUDIO }), true);
  assert.equal(medirEstaVisita({ previa: false, referer: '', studioOrigin: STUDIO }), true);
  assert.equal(medirEstaVisita({ previa: false, referer: 'coisa-que-não-é-url', studioOrigin: STUDIO }), true);
});

test('sem medição, a página do player não carrega o tracker', () => {
  const com = renderVslPage(video, { embed: true, publicOrigin: STUDIO, trackerPublicId: 'trk_1' });
  assert.match(com, /tracker\.js/);
  const sem = renderVslPage(video, { embed: true, publicOrigin: STUDIO, trackerPublicId: 'trk_1', medir: false });
  assert.doesNotMatch(sem, /tracker\.js/);
});
