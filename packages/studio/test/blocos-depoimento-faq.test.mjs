import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, runtimeCss, blockDescriptions } from '../public/templates.js';

const conteudo = (id) => blocks.find(([blocoId]) => blocoId === id)[3];


test('o carrossel desliza sozinho, sem depender de javascript', () => {
  // scroll-snap faz o arrasto e o teclado funcionarem mesmo se o script falhar
  assert.match(runtimeCss, /\.alva-carousel-track\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(runtimeCss, /\.alva-testimonial\{[^}]*scroll-snap-align:center/);
});




test('as setas do carrossel funcionam na página publicada', async () => {
  const { buildPageExportHtml } = await import('../public/editor-shell.js');
  const html = buildPageExportHtml({ title: 'Teste', css: '', html: '<div class="alva-carousel"></div>', js: '' });
  assert.match(html, /data-carousel/, 'o script do carrossel acompanha a página');
  assert.match(html, /scrollBy/);
});

test('página sem carrossel não carrega o script à toa', async () => {
  const { buildPageExportHtml } = await import('../public/editor-shell.js');
  const html = buildPageExportHtml({ title: 'Teste', css: '', html: '<p>oi</p>', js: '' });
  assert.doesNotMatch(html, /scrollBy/);
});
