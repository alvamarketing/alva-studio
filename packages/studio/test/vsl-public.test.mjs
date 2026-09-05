import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderVslPage, vslContentSecurityPolicy } from '../server/vsl-public.mjs';

const video = {
  publicId: 'public-vsl-123456', versionId: 2, name: 'Oferta <especial>', sourceUrl: 'https://media.example.test/path/vsl.m3u8', sourceType: 'hls',
  posterUrl: 'https://media.example.test/poster.jpg', captionsUrl: 'https://media.example.test/captions.vtt', accentColor: '#286eea', aspectRatio: '16:9',
  autoplayMuted: true, resumeEnabled: true, ctaText: 'Comprar', ctaUrl: '/checkout?from=vsl', ctaSeconds: 42,
};

test('renderizador público escapa HTML, configura CSP por origem e usa player local', () => {
  const html = renderVslPage(video);
  assert.match(html, /Oferta &lt;especial&gt;/);
  assert.match(html, /src="\/vsl-player\.js"/);
  assert.match(html, /data-vsl-config=/);
  assert.doesNotMatch(html, /\/video\//);
  const policy = vslContentSecurityPolicy(video.sourceUrl, { embed: false });
  assert.match(policy, /media-src 'self' https:\/\/media\.example\.test/);
  assert.match(policy, /connect-src 'self' https:\/\/media\.example\.test/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('embed permite ancestrais HTTPS, mantém proporção e inclui allow autoplay', () => {
  const html = renderVslPage({ ...video, aspectRatio: '9:16' }, { embed: true });
  assert.match(html, /allow="autoplay"/);
  assert.match(html, /aspect-ratio:9\/16/);
  assert.match(vslContentSecurityPolicy(video.sourceUrl, { embed: true }), /frame-ancestors https:/);
});
