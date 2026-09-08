import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingMetricsModel, trackingEventsModel, trackingHealthModel } from '../public/studio-dashboard.js';

const entregas = [
  { id: '1', eventRef: 'e1', eventName: 'lead', destination: 'meta', status: 'delivered', attemptCount: 1, consentState: 'granted', contentId: 'Diagnóstico', createdAt: '2026-09-08T20:01:42.000Z', deliveredAt: '2026-09-08T20:01:43.000Z' },
  { id: '2', eventRef: 'e1', eventName: 'lead', destination: 'google', status: 'delivered', attemptCount: 1, consentState: 'granted', contentId: 'Diagnóstico', createdAt: '2026-09-08T20:01:42.000Z', deliveredAt: '2026-09-08T20:01:44.000Z' },
  { id: '3', eventRef: 'e2', eventName: 'purchase', destination: 'meta', status: 'pending', attemptCount: 2, consentState: 'pending', contentId: 'Checkout', createdAt: '2026-09-08T19:50:00.000Z', deliveredAt: null },
  { id: '4', eventRef: 'e3', eventName: 'lead', destination: 'tiktok', status: 'dead', attemptCount: 5, consentState: 'denied', contentId: 'Captação', createdAt: '2026-09-08T19:30:00.000Z', deliveredAt: null },
];

test('as quatro métricas contam entregas por estado com participação', () => {
  const m = trackingMetricsModel(entregas);
  assert.deepEqual(m.map((x) => x.label), ['Eventos recebidos', 'Entregues', 'Em nova tentativa', 'Falhas encerradas']);
  assert.deepEqual(m.map((x) => x.value), ['3', '2', '1', '1']);
  assert.deepEqual(m.map((x) => x.detail), ['', '50,0%', '25,0%', '25,0%']);
});

test('um evento vira uma linha, com seus destinos reunidos', () => {
  const linhas = trackingEventsModel(entregas);
  assert.equal(linhas.length, 3);
  assert.deepEqual(linhas[0], {
    eventRef: 'e1', eventName: 'lead', contentId: 'Diagnóstico', consentState: 'granted',
    consentLabel: 'granted', receivedAt: '2026-09-08T20:01:42.000Z',
    destinations: ['meta', 'google'], delivered: 2, total: 2, status: 'Entregue',
  });
});

test('o estado da linha reflete a pior situação entre os destinos', () => {
  const [, emTentativa, encerrado] = trackingEventsModel(entregas);
  assert.equal(emTentativa.status, 'Nova tentativa');
  assert.equal(encerrado.status, 'Encerrada');
});

test('a saúde por destino mostra a taxa de entrega de cada um', () => {
  const saude = trackingHealthModel(entregas);
  assert.deepEqual(saude, [
    { destination: 'meta', rate: '50%', delivered: 1, total: 2 },
    { destination: 'google', rate: '100%', delivered: 1, total: 1 },
    { destination: 'tiktok', rate: '0%', delivered: 0, total: 1 },
  ]);
});

test('sem entregas nada quebra', () => {
  assert.deepEqual(trackingMetricsModel([]).map((m) => m.value), ['0', '0', '0', '0']);
  assert.deepEqual(trackingEventsModel(null), []);
  assert.deepEqual(trackingHealthModel(null), []);
});

const { readFile } = await import('node:fs/promises');
const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('a tela de rastreamento reúne tudo numa página só', () => {
  const tela = markup.slice(markup.indexOf('id="tracking-view"'), markup.indexOf('id="agents-view"'));
  assert.match(tela, /id="tracking-view-title">Rastreamento</);
  assert.match(tela, /Eventos recentes/);
  for (const secao of ['Entregas por destino', 'Destinos', 'Consentimento']) assert.match(tela, new RegExp(secao), `faltou a seção ${secao}`);
  assert.match(tela, /id="tracking-metrics"/);
  assert.match(tela, /id="tracking-events"/);
  assert.match(tela, /id="tracking-journey"/);
  assert.match(tela, /id="tracking-health"/);
  for (const coluna of ['Evento', 'Conteúdo', 'Consentimento', 'Recebido', 'Entrega']) assert.match(tela, new RegExp(`<th>${coluna}</th>`), `faltou a coluna ${coluna}`);
});

test('rastreamento é tela própria com rota e abertura', async () => {
  const { viewToHash, hashToView, viewToRestore } = await import('../public/view-route.js');
  assert.equal(hashToView(viewToHash('tracking')).view, 'tracking');
  assert.equal(viewToRestore({ view: 'tracking' }, { hasProject: false }), 'home');
  assert.match(app, /tracking: '#tracking-view'/);
  assert.match(app, /async function abrirRastreamento\(\)/);
  assert.match(app, /\$\('#nav-project-tracking'\)\.onclick = action\(abrirRastreamento\)/);
  assert.match(app, /if \(view === 'tracking'\) return void action\(abrirRastreamento\)\(\)/);
});

test('a lista de eventos mostra 10 por vez até acabar', async () => {
  const { trackingPageModel } = await import('../public/studio-dashboard.js');
  const eventos = Array.from({ length: 26 }, (_, i) => ({ eventRef: `e${i}` }));

  const primeira = trackingPageModel(eventos, 10);
  assert.equal(primeira.rows.length, 10);
  assert.equal(primeira.hasMore, true);

  const segunda = trackingPageModel(eventos, 20);
  assert.equal(segunda.rows.length, 20);
  assert.equal(segunda.hasMore, true);

  const terceira = trackingPageModel(eventos, 30);
  assert.equal(terceira.rows.length, 26);
  assert.equal(terceira.hasMore, false);
});

test('a paginação não quebra com lista curta ou vazia', async () => {
  const { trackingPageModel } = await import('../public/studio-dashboard.js');
  assert.deepEqual(trackingPageModel([], 10), { rows: [], hasMore: false, remaining: 0 });
  assert.equal(trackingPageModel([{ eventRef: 'x' }], 10).hasMore, false);
});

test('a tela tem o botão de carregar mais e volta ao início quando o filtro muda', () => {
  const tela = markup.slice(markup.indexOf('id="tracking-view"'), markup.indexOf('id="agents-view"'));
  assert.match(tela, /id="tracking-more"/);
  assert.match(app, /trackingVisiveis = TRACKING_PAGINA/);
  assert.match(app, /const TRACKING_PAGINA = 10;/);
  assert.match(app, /verMais\.textContent = 'Ver mais';/);
});
