import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaSource, providerEmbedUrl } from '../server/media-source.mjs';

const youtubeId = 'dQw4w9WgXcQ';
const studioOrigin = 'https://studio.example.test';

test('normaliza as formas aceitas de YouTube para a mesma identidade e URL canônica', () => {
  const inputs = [
    `https://www.youtube.com/watch?v=${youtubeId}&utm_source=colado`,
    `https://youtu.be/${youtubeId}?feature=share`,
    `https://www.youtube.com/embed/${youtubeId}`,
    youtubeId,
  ];
  const results = inputs.map((sourceUrl) => parseMediaSource({ sourceType: 'youtube', sourceUrl }, { studioOrigin }));

  for (const result of results) {
    assert.equal(result.sourceType, 'youtube');
    assert.equal(result.providerVideoId, youtubeId);
    assert.deepEqual(result.providerConfig, {});
    assert.equal(result.sourceUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&origin=https%3A%2F%2Fstudio.example.test&autoplay=1&mute=1');
    assert.equal(result.sourceUrl.includes('utm_source'), false, 'a URL colada não pode vazar para o endereço persistido');
  }
});

test('normaliza Vimeo somente para hosts e identificadores aceitos', () => {
  const parsed = parseMediaSource({ sourceType: 'vimeo', sourceUrl: 'https://player.vimeo.com/video/123456?autoplay=0' });
  assert.deepEqual(parsed, {
    sourceType: 'vimeo', providerVideoId: '123456', providerConfig: {},
    sourceUrl: 'https://player.vimeo.com/video/123456?autoplay=1&muted=1',
  });
  assert.throws(() => parseMediaSource({ sourceType: 'vimeo', sourceUrl: 'https://vimeo.com/12' }), /mídia|Vimeo/i);
});

test('recusa IDs inválidos, hosts arbitrários e esquemas executáveis para provedores', () => {
  for (const sourceUrl of ['abcdefghij', 'abcdefghijkl', `https://evil.tld/embed/${youtubeId}`, 'javascript:alert(1)', 'data:text/html,video']) {
    assert.throws(() => parseMediaSource({ sourceType: 'youtube', sourceUrl }), /mídia|YouTube|HTTPS/i);
  }
  for (const sourceUrl of ['javascript:alert(1)', 'data:video/mp4,bytes'])
    assert.throws(() => parseMediaSource({ sourceType: 'vimeo', sourceUrl }), /mídia|Vimeo|HTTPS/i);
});

test('recusa URLs de provedores sem HTTPS, com credenciais ou porta arbitrária, mas mantém IDs diretos', () => {
  for (const sourceUrl of [
    `http://www.youtube.com/embed/${youtubeId}`,
    `https://user:password@www.youtube.com/embed/${youtubeId}`,
    `https://www.youtube.com:444/embed/${youtubeId}`,
  ]) assert.throws(() => parseMediaSource({ sourceType: 'youtube', sourceUrl }, { studioOrigin }), /HTTPS|credenciais|YouTube/i);
  for (const sourceUrl of [
    'http://vimeo.com/123456',
    'https://user:password@vimeo.com/123456',
    'https://player.vimeo.com:444/video/123456',
  ]) assert.throws(() => parseMediaSource({ sourceType: 'vimeo', sourceUrl }), /HTTPS|credenciais|Vimeo/i);
  assert.equal(parseMediaSource({ sourceType: 'youtube', sourceUrl: youtubeId }, { studioOrigin }).providerVideoId, youtubeId);
  assert.equal(parseMediaSource({ sourceType: 'vimeo', sourceUrl: '123456' }).providerVideoId, '123456');
});

test('mantém MP4 e HLS HTTPS sem credenciais e deduz HLS quando o tipo não é informado', () => {
  assert.deepEqual(
    parseMediaSource({ sourceUrl: 'https://media.example.test/video.m3u8?token=publico' }),
    { sourceType: 'hls', providerVideoId: null, providerConfig: {}, sourceUrl: 'https://media.example.test/video.m3u8?token=publico' },
  );
  assert.deepEqual(
    parseMediaSource({ sourceType: 'mp4', sourceUrl: 'https://media.example.test/video.mp4' }),
    { sourceType: 'mp4', providerVideoId: null, providerConfig: {}, sourceUrl: 'https://media.example.test/video.mp4' },
  );
  for (const sourceUrl of ['http://media.example.test/video.mp4', 'https://user:password@media.example.test/video.mp4', 'javascript:alert(1)', 'data:video/mp4,bytes'])
    assert.throws(() => parseMediaSource({ sourceType: 'mp4', sourceUrl }), /HTTPS/i);
});

test('monta embed do YouTube somente com origem do Studio validada', () => {
  assert.equal(
    providerEmbedUrl('youtube', youtubeId, { studioOrigin: 'https://studio.example.test/path' }),
    'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&origin=https%3A%2F%2Fstudio.example.test&autoplay=1&mute=1',
  );
  assert.equal(
    providerEmbedUrl('youtube', youtubeId, { studioOrigin }),
    'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&origin=https%3A%2F%2Fstudio.example.test&autoplay=1&mute=1',
  );
  assert.throws(() => providerEmbedUrl('youtube', youtubeId, {}), /origem.*Studio/i);
});

test('a origem colada não substitui a configuração do servidor na URL persistida de um provedor', () => {
  const parsed = parseMediaSource({
    sourceType: 'youtube', sourceUrl: youtubeId,
    studioOrigin: 'https://origem-colada.example.test',
  }, { studioOrigin });
  assert.equal(parsed.sourceUrl.includes('origem-colada'), false);
  assert.match(parsed.sourceUrl, /origin=https%3A%2F%2Fstudio.example.test/);
  assert.deepEqual(parsed.providerConfig, {});
});
