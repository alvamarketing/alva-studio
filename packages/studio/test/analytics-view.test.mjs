import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyticsRankModel } from '../public/studio-dashboard.js';
import { viewToHash, hashToView, viewToRestore } from '../public/view-route.js';

test('as listas de Páginas e Origens trazem participação e proporção da barra', () => {
  const linhas = analyticsRankModel([
    { urlPath: '/', total: 1972 },
    { urlPath: '/imobiliarias', total: 789 },
  ]);
  assert.deepEqual(linhas.map((l) => l.label), ['/', '/imobiliarias']);
  assert.deepEqual(linhas.map((l) => l.value), ['1.972', '789']);
  assert.deepEqual(linhas.map((l) => l.share), ['71%', '29%']);
  assert.deepEqual(linhas.map((l) => l.width), ['100%', '40%']);
});

test('a lista aceita origens e nomeia o acesso sem referência', () => {
  const linhas = analyticsRankModel([{ source: '', total: 24 }]);
  assert.equal(linhas[0].label, '(direto)');
});

test('lista vazia não quebra nem divide por zero', () => {
  assert.deepEqual(analyticsRankModel([]), []);
  assert.deepEqual(analyticsRankModel(null), []);
  assert.deepEqual(analyticsRankModel([{ urlPath: '/', total: 0 }])[0].share, '0%');
});

test('analytics tem endereço próprio e exige projeto', () => {
  assert.equal(hashToView(viewToHash('analytics')).view, 'analytics');
  assert.equal(viewToRestore({ view: 'analytics' }, { hasProject: true }), 'analytics');
  assert.equal(viewToRestore({ view: 'analytics' }, { hasProject: false }), 'home');
});

test('a tela de analytics existe com o cabeçalho e as abas da referência visual', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tela = markup.slice(markup.indexOf('id="analytics-view"'), markup.indexOf('id="analytics-view"') + 3000);
  assert.match(tela, /PROJETO · ANALYTICS/);
  for (const aba of ['Visão geral', 'Público', 'Aquisição', 'Comportamento', 'Eventos']) {
    assert.match(tela, new RegExp(aba), `faltou a aba ${aba}`);
  }
  assert.match(tela, /id="analytics-view-metrics"/);
  assert.match(tela, /id="analytics-pages"/);
  assert.match(tela, /id="analytics-sources"/);
});

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('a tela entra no mapa de seções e tem abertura própria', () => {
  const secoes = app.slice(app.indexOf('function setDashboardView('), app.indexOf('function mobileDrawerActive('));
  assert.match(secoes, /analytics: '#analytics-view'/);
  assert.match(app, /async function abrirAnalytics\(\)/);
  assert.match(app, /\$\('#nav-project-analytics'\)\.onclick = action\(abrirAnalytics\)/);
  assert.match(app, /if \(view === 'analytics'\) return void action\(abrirAnalytics\)\(\)/);
});

test('o período escolhido refaz a busca do resumo', () => {
  assert.match(app, /#analytics-range/);
  assert.match(app, /analyticsRangeParams\(/);
});
