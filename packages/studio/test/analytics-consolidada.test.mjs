import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const analytics = markup.slice(markup.indexOf('id="analytics-view"'), markup.indexOf('id="tracking-view"'));
const tracking = markup.slice(markup.indexOf('id="tracking-view"'), markup.indexOf('id="agents-view"'));

test('Analytics deixa de esconder conteúdo atrás de abas', () => {
  assert.doesNotMatch(analytics, /data-analytics-tab/);
  assert.doesNotMatch(analytics, /data-analytics-panel/);
  assert.doesNotMatch(app, /selecionarAbaAnalytics/);
});

test('Rastreamento também vira uma página só', () => {
  assert.doesNotMatch(tracking, /data-tracking-tab/);
  assert.doesNotMatch(tracking, /data-tracking-panel/);
  assert.doesNotMatch(app, /selecionarAbaRastreamento/);
});

test('todo o conteúdo das antigas abas continua na página', () => {
  for (const id of ['analytics-view-metrics', 'analytics-view-chart', 'analytics-pages', 'analytics-sources',
    'analytics-countries', 'analytics-cities', 'analytics-devices', 'analytics-entries', 'analytics-exits',
    'analytics-campaigns', 'analytics-events', 'journey-graph', 'journey-attributions']) {
    assert.match(analytics, new RegExp(`id="${id}"`), `sumiu ${id}`);
  }
  for (const id of ['tracking-metrics', 'tracking-events', 'tracking-journey', 'tracking-health',
    'tracking-destinations', 'tracking-consent']) {
    assert.match(tracking, new RegExp(`id="${id}"`), `sumiu ${id}`);
  }
});

test('as seções são nomeadas, para orientar quem rola a página', () => {
  for (const titulo of ['Quem visitou', 'Como navegaram', 'Mapa de resultados']) {
    assert.match(analytics, new RegExp(titulo), `faltou a seção ${titulo}`);
  }
});

test('as métricas saem da caixa: sem borda, sem fundo e sem rótulo em caixa alta', () => {
  const regra = css.slice(css.indexOf('.analytics-view .metric {'), css.indexOf('.analytics-view .metric {') + 400);
  assert.match(regra, /border:\s*0/);
  assert.doesNotMatch(regra, /background:\s*var\(--alva-surface-alt\)/);
  const rotulo = css.slice(css.indexOf('.analytics-view .metric small'), css.indexOf('.analytics-view .metric small') + 300);
  assert.doesNotMatch(rotulo, /text-transform:\s*uppercase/);
});

test('a caixa fica só onde delimita área de interação, não em toda lista', () => {
  assert.match(css, /\.analytics-view \.journey-graph/);
  // as listas passam a viver sobre o fundo da página
  const lista = css.slice(css.indexOf('.analytics-view .list-card {'), css.indexOf('.analytics-view .list-card {') + 300);
  assert.match(lista, /border:\s*0|background:\s*transparent/);
});
