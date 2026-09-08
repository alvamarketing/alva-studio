import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsMetricsModel } from '../public/studio-dashboard.js';

const umami = { pageviews: 6754, visits: 2132, visitors: 1931, bounces: 1087, totalTime: 289912 };

test('as cinco métricas da referência visual saem do resumo do Umami', () => {
  const metricas = analyticsMetricsModel(umami);
  assert.deepEqual(metricas.map((m) => m.label), ['Visualizações', 'Visitas', 'Visitantes', 'Taxa de rejeição', 'Duração média']);
  assert.deepEqual(metricas.map((m) => m.value), ['6.754', '2.132', '1.931', '51%', '2m 16s']);
});

test('o coletor legado não quebra: o que ele não mede aparece como travessão', () => {
  const metricas = analyticsMetricsModel({ pageviews: 120, visitors: 45 });
  assert.deepEqual(metricas.map((m) => m.value), ['120', '—', '45', '—', '—']);
});

test('sem resumo nenhum, todas as métricas ficam em travessão', () => {
  assert.deepEqual(analyticsMetricsModel(null).map((m) => m.value), ['—', '—', '—', '—', '—']);
});

test('a taxa de rejeição não divide por zero', () => {
  const [, , , rejeicao] = analyticsMetricsModel({ visits: 0, bounces: 0 });
  assert.equal(rejeicao.value, '—');
});

test('a duração média passa de minutos para horas quando precisa', () => {
  const [, , , , duracao] = analyticsMetricsModel({ visits: 2, totalTime: 7324 });
  assert.equal(duracao.value, '1h 1m 2s');
});

const { readFile } = await import('node:fs/promises');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('a visão geral não repete as métricas: elas vivem na tela de Analytics', () => {
  const painel = markup.slice(markup.indexOf('id="analytics-panel"'), markup.indexOf('id="analytics-chart"'));
  assert.doesNotMatch(painel, /id="analytics-metrics"/);
  assert.match(markup, /id="analytics-view-metrics"/);
});

test('o modelo do painel já carrega as métricas do resumo que ele busca', async () => {
  const { analyticsPanelModel } = await import('../public/studio-dashboard.js');
  const model = analyticsPanelModel(umami, {});
  assert.equal(model.metrics.length, 5);
  assert.equal(model.metrics[0].value, '6.754');
});

test('o cartão da visão geral não pinta métricas', () => {
  const corpo = app.slice(app.indexOf('function paintAnalyticsPanel('), app.indexOf('function paintAnalyticsPanel(') + 1400);
  assert.doesNotMatch(corpo, /#analytics-metrics/);
});
