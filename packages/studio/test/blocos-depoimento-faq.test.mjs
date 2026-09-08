import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, runtimeCss, blockDescriptions } from '../public/templates.js';

const conteudo = (id) => blocks.find(([blocoId]) => blocoId === id)[3];

test('depoimentos viram um carrossel com vários cartões', () => {
  const html = conteudo('testimonials-section');
  assert.match(html, /alva-carousel/);
  assert.equal((html.match(/alva-testimonial/g) || []).length >= 3, true, 'nasce com mais de um depoimento');
  assert.match(html, /alva-stars/, 'com estrelas');
  assert.match(html, /data-carousel="prev"/);
  assert.match(html, /data-carousel="next"/);
});

test('o carrossel desliza sozinho, sem depender de javascript', () => {
  // scroll-snap faz o arrasto e o teclado funcionarem mesmo se o script falhar
  assert.match(runtimeCss, /\.alva-carousel-track\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(runtimeCss, /\.alva-testimonial\{[^}]*scroll-snap-align:center/);
});

test('o cartão de depoimento tem fundo, borda e estrelas visíveis', () => {
  assert.match(runtimeCss, /\.alva-testimonial\{[^}]*background:/);
  assert.match(runtimeCss, /\.alva-testimonial\{[^}]*border:/);
  assert.match(runtimeCss, /\.alva-stars\{/);
});

test('as perguntas frequentes ganham cartão e sinal de abrir', () => {
  assert.match(runtimeCss, /\.faq details\{[^}]*background:/);
  assert.match(runtimeCss, /\.faq summary::after\{/, 'um sinal indica que abre');
});

test('o bloco de depoimentos continua explicado na biblioteca', () => {
  assert.match(blockDescriptions['testimonials-section'], /client|depoiment/i);
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
