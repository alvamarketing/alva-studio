import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsPanelModel, analyticsRangeParams } from '../public/studio-dashboard.js';

function summaryWith(dailyVisits, funnel = []) {
  return { dailyVisits, funnel };
}

test('sempre produz sete barras, mesmo com menos de sete dias de dados', () => {
  const model = analyticsPanelModel(summaryWith([{ date: '2026-09-01', visits: 10 }]));
  assert.equal(model.bars.length, 7);
});

test('a maior barra vira 100% e as demais ficam proporcionais a ela', () => {
  const model = analyticsPanelModel(summaryWith([
    { date: '2026-08-30', visits: 19 }, { date: '2026-08-31', visits: 26 }, { date: '2026-09-01', visits: 22.5 },
    { date: '2026-09-02', visits: 36 }, { date: '2026-09-03', visits: 31.5 }, { date: '2026-09-04', visits: 44.5 },
    { date: '2026-09-05', visits: 39 },
  ]));
  assert.equal(Math.max(...model.bars.map((bar) => bar.altura)), 100);
  assert.equal(model.bars[5].altura, 100);
  assert.ok(model.bars[0].altura < model.bars[5].altura);
});

test('dia sem visita mostra a barra no piso mínimo, sem inventar visitas', () => {
  const model = analyticsPanelModel(summaryWith(Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-0${index + 1}`, visits: index === 3 ? 40 : 0 }))));
  assert.equal(model.bars[0].visitas, 0);
  assert.equal(model.bars[0].altura, 0);
  assert.equal(model.bars[3].altura, 100);
});

test('funil com menos de quatro etapas não quebra e não inventa etapa', () => {
  const model = analyticsPanelModel(summaryWith([], [{ label: 'Meta Ads' }, { label: '/imobiliarias' }]));
  assert.equal(model.funnel.length, 2);
  assert.deepEqual(model.funnel, [{ label: 'Meta Ads' }, { label: '/imobiliarias' }]);
});

test('funil com mais de quatro etapas é cortado em quatro', () => {
  const model = analyticsPanelModel(summaryWith([{ date: '2026-09-01', visits: 1 }], [
    { label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' },
  ]));
  assert.equal(model.funnel.length, 4);
});

test('phase cobre loading, empty, error e ready', () => {
  assert.equal(analyticsPanelModel(null, { phase: 'loading' }).phase, 'loading');
  assert.equal(analyticsPanelModel(null, { phase: 'error', error: 'Falhou' }).phase, 'error');
  assert.equal(analyticsPanelModel(null, { phase: 'error', error: 'Falhou' }).message, 'Falhou');
  assert.equal(analyticsPanelModel(summaryWith([], [])).phase, 'empty');
  assert.equal(analyticsPanelModel(summaryWith([{ date: '2026-09-01', visits: 3 }], [])).phase, 'ready');
});

test('sem a capacidade analytics.read, o modelo fica oculto e sem dados', () => {
  const model = analyticsPanelModel(summaryWith([{ date: '2026-09-01', visits: 40 }], [{ label: 'Lead' }]), { canRead: false });
  assert.equal(model.phase, 'hidden');
  assert.deepEqual(model.bars, []);
  assert.deepEqual(model.funnel, []);
});

test('o intervalo padrão cobre exatamente os últimos 7 dias, terminando agora — /api/projects/:id/analytics/summary exige from e to', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');
  const range = analyticsRangeParams(now);
  assert.equal(range.to, '2026-09-05T12:00:00.000Z');
  assert.equal(range.from, '2026-08-29T12:00:00.000Z');
});

test('a legenda nunca menciona Umami', () => {
  const model = analyticsPanelModel(summaryWith([{ date: '2026-09-01', visits: 1 }]));
  assert.equal(model.updatedLabel.toLowerCase().includes('umami'), false);
  assert.match(model.updatedLabel, /Coletor interno/);
});
