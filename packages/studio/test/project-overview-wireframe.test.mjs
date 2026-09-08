import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { previewProjectContent } from '../public/studio-dashboard.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const conteudos = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Conteúdo ${i}`, kind: 'page' }));

test('a visão geral mostra apenas os três conteúdos mais recentes, como na referência visual', () => {
  assert.equal(previewProjectContent(conteudos).length, 3);
  assert.deepEqual(previewProjectContent(conteudos).map((c) => c.id), ['c0', 'c1', 'c2']);
});

test('a prévia não inventa itens quando o projeto tem menos de três conteúdos', () => {
  assert.equal(previewProjectContent(conteudos.slice(0, 2)).length, 2);
  assert.deepEqual(previewProjectContent([]), []);
});

test('Ver todos deixa de ser filtro e abre a tela com a lista completa', () => {
  const handler = app.slice(app.indexOf("$('#project-content-all').onclick"), app.indexOf("$('#project-content-all').onclick") + 400);
  assert.match(handler, /abrirFormularios|abrirPaginas/);
});

test('a visão geral renderiza a prévia, não a lista inteira', () => {
  const corpo = app.slice(app.indexOf('function renderProjectContent('), app.indexOf('function renderProjectContent(') + 700);
  assert.match(corpo, /previewProjectContent/);
});

test('agentes e publicação são telas próprias, fora da visão geral', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const projeto = markup.slice(markup.indexOf('id="project-view"'), markup.indexOf('id="agents-view"'));
  assert.doesNotMatch(projeto, /id="project-agent-keys"/);
  assert.doesNotMatch(projeto, /id="project-publication"/);
  assert.match(markup, /id="agents-view"/);
  assert.match(markup, /id="publication-view"/);
});

test('as duas telas novas entram no mapa de seções e no menu', () => {
  const corpo = app.slice(app.indexOf('function setDashboardView('), app.indexOf('function mobileDrawerActive('));
  assert.match(corpo, /agents: '#agents-view'/);
  assert.match(corpo, /publication: '#publication-view'/);
});

test('as telas de agentes e publicação carregam seus dados ao abrir', () => {
  const agentes = app.slice(app.indexOf('async function abrirAgentes('), app.indexOf('async function abrirAgentes(') + 400);
  const publicacao = app.slice(app.indexOf('async function abrirPublicacao('), app.indexOf('async function abrirPublicacao(') + 400);
  assert.match(agentes, /renderProject\(\)/);
  assert.match(publicacao, /renderProject\(\)/);
});
