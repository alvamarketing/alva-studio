import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageExportHtml } from '../public/editor-shell.js';

// Publicar a mesma página como quiz é uma decisão de quem monta, não outro editor: o
// HTML é o mesmo, e o que muda é a marca no corpo e o script que navega entre as seções.

const PAGINA = '<main><section id="a"><button data-alva-quiz-next>Ir</button></section><section id="b">Fim</section></main>';

test('página normal continua sem nada de quiz', () => {
  const html = buildPageExportHtml({ title: 'LP', html: PAGINA, css: '' });
  assert.doesNotMatch(html, /data-alva-quiz="true"/);
  assert.doesNotMatch(html, /alva-quiz-progresso/);
});

test('publicada como quiz, a página leva a marca e a navegação', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true });
  assert.match(html, /<body data-alva-quiz="true">/, 'sem a marca o runtime não age');
  assert.match(html, /alva-quiz-progresso/, 'o estilo das etapas vai junto');
  assert.match(html, /data-alva-quiz-next/);
});

test('o destino das respostas entra no script publicado', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true, quizDestino: 'https://api.alva.test/r/123' });
  assert.match(html, /https:\/\/api\.alva\.test\/r\/123/);
});

test('sem destino a página vai ao ar mesmo assim, só não envia', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true });
  assert.match(html, /<body data-alva-quiz="true">/);
  assert.doesNotMatch(html, /undefined/, 'destino ausente não pode virar a palavra undefined na página');
});

test('o título e o conteúdo continuam sendo os da página', () => {
  const html = buildPageExportHtml({ title: 'Meu quiz', html: PAGINA, css: '.hero{color:red}', quiz: true });
  assert.match(html, /<title>Meu quiz<\/title>/);
  assert.match(html, /\.hero\{color:red\}/);
  assert.match(html, /<section id="a">/);
});

test('o app publica com a mecânica quando a página está marcada como quiz', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  // Sem passar a marca adiante, um quiz sobe como landing rolável: todas as etapas de uma
  // vez, sem botão que leve à seguinte.
  assert.match(app, /quiz: page\?\.kind === 'quiz'/);
});
