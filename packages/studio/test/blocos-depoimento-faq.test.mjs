import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeCss } from '../public/templates.js';


test('o carrossel desliza sozinho, sem depender de javascript', () => {
  // scroll-snap faz o arrasto e o teclado funcionarem mesmo se o script falhar
  assert.match(runtimeCss, /\.alva-carousel-track\{[^}]*scroll-snap-type:x mandatory/);
  assert.match(runtimeCss, /\.alva-testimonial\{[^}]*scroll-snap-align:center/);
});



