import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildPageExportHtml } from '../public/editor-shell.js';
import { materialSymbolsFontCss, materialSymbolsFontUrl, quizElementCss } from '../public/quiz-elements.js';
import { embedVideoCss, templateCss } from '../public/templates.js';
import { createApp } from '../server/index.mjs';

test('fonte Material Symbols local tem MIME correto e CSS absoluto para exportação', async (t) => {
  const app = createApp();
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const response = await fetch(`${base}/material-symbols-outlined.woff2`, {
    headers: { Origin: 'https://published.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.ok((await response.arrayBuffer()).byteLength > 300_000);
  const [api, postFont] = await Promise.all([
    fetch(`${base}/api/session`, { headers: { Origin: 'https://published.example', 'Sec-Fetch-Site': 'cross-site' } }),
    fetch(`${base}/material-symbols-outlined.woff2`, { method: 'POST', headers: { Origin: 'https://published.example', 'Sec-Fetch-Site': 'cross-site' } }),
  ]);
  assert.equal(api.status, 403);
  assert.equal(postFont.status, 403);
  assert.equal(materialSymbolsFontUrl('https://studio.example.test'), 'https://studio.example.test/material-symbols-outlined.woff2');
  assert.match(materialSymbolsFontCss('https://studio.example.test'), /url\('https:\/\/studio\.example\.test\/material-symbols-outlined\.woff2'\)/);
  assert.doesNotMatch(materialSymbolsFontCss('https://studio.example.test'), /fonts\.googleapis|fonts\.gstatic/);
  const [index, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/material-symbols.css', import.meta.url), 'utf8'),
  ]);
  assert.match(index, /href="\/material-symbols\.css"/);
  assert.match(css, /url\('\/material-symbols-outlined\.woff2'\)/);
  const exportHtml = buildPageExportHtml({ title: 'Página', css: templateCss, html: '<div class="alva-embed-video" data-alva-video-empty="true"><iframe src="about:blank"></iframe><p class="alva-embed-video-placeholder">Cole uma URL HTTPS para incorporar o vídeo.</p></div>', publicOrigin: 'https://studio.example.test' });
  assert.match(exportHtml, /url\('https:\/\/studio\.example\.test\/material-symbols-outlined\.woff2'\)/);
  assert.ok(templateCss.includes(embedVideoCss), 'Landing deve receber o estilo responsivo do embed');
  assert.ok(quizElementCss.includes(embedVideoCss), 'Quiz deve reutilizar exatamente o mesmo estilo do embed');
  assert.match(exportHtml, /\.alva-embed-video\{position:relative;aspect-ratio:16\/9/);
  assert.match(exportHtml, /alva-embed-video-placeholder/);
});
