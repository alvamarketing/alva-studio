import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyGraph } from '../server/analytics-journey.mjs';

const evento = (sessionId, urlPath, minuto, extra = {}) => ({
  id: `${sessionId}-${urlPath}-${minuto}`, sessionId, urlPath,
  at: new Date(Date.UTC(2026, 8, 1, 10, minuto)), eventType: 'pageview', ...extra,
});

test('cada sessão vira um caminho ordenado no tempo, e páginas repetidas somam no mesmo nó', () => {
  const grafo = buildJourneyGraph([
    evento('s1', '/produto', 2), // fora de ordem de propósito
    evento('s1', '/entrada', 1),
    evento('s1', '/obrigado', 3),
    evento('s2', '/entrada', 1),
    evento('s2', '/produto', 2),
  ]);
  const entrada = grafo.nodes.find((n) => n.id === '/entrada');
  assert.deepEqual(entrada, { id: '/entrada', type: 'page', label: '/entrada', pageviews: 2, sessions: 2, entries: 2, exits: 0 });
  const obrigado = grafo.nodes.find((n) => n.id === '/obrigado');
  assert.equal(obrigado.exits, 1);
  assert.deepEqual(grafo.totals, { pageviews: 5, sessions: 2, pages: 3, conversions: 0, conversionRate: 0 });
});

test('páginas consecutivas viram passagens, contadas por transição e por sessão', () => {
  const grafo = buildJourneyGraph([
    evento('s1', '/a', 1), evento('s1', '/b', 2), evento('s1', '/a', 3), evento('s1', '/b', 4),
    evento('s2', '/a', 1), evento('s2', '/b', 2),
  ]);
  const passagem = grafo.edges.find((e) => e.source === '/a' && e.target === '/b');
  assert.equal(passagem.transitions, 3, 'três passagens de /a para /b');
  assert.equal(passagem.sessions, 2, 'em duas sessões distintas');
});

test('eventos duplicados e o que não é pageview ficam de fora', () => {
  const repetido = evento('s1', '/a', 1);
  const grafo = buildJourneyGraph([
    repetido, { ...repetido },
    { ...evento('s1', '/b', 2), eventType: 'custom' },
  ]);
  assert.deepEqual(grafo.nodes.map((n) => n.id), ['/a']);
  assert.equal(grafo.totals.pageviews, 1);
});

test('a origem da sessão segue utm_source, depois o domínio de referência, depois direct', () => {
  const grafo = buildJourneyGraph([
    evento('s1', '/a', 1, { utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'primavera', utmContent: 'video_01', referrerDomain: 'facebook.com' }),
    evento('s2', '/a', 1, { referrerDomain: 'google.com' }),
    evento('s3', '/a', 1, {}),
  ]);
  assert.deepEqual(grafo.attributions.map((a) => a.source).sort(), ['direct', 'facebook', 'google.com'],
    'utm_source vence o referrer; sem os dois, direct');
  const facebook = grafo.attributions.find((a) => a.source === 'facebook');
  assert.equal(facebook.medium, 'cpc');
  assert.equal(facebook.campaign, 'primavera');
  assert.equal(facebook.content, 'video_01');
  assert.equal(facebook.term, null);
  assert.equal(facebook.entry, '/a');
  assert.equal(facebook.sessions, 1);
});

test('o grafo nunca devolve identificador de sessão', () => {
  const grafo = buildJourneyGraph([evento('sessao-secreta', '/a', 1)]);
  assert.doesNotMatch(JSON.stringify(grafo), /sessao-secreta/);
});

test('sem eventos o grafo é vazio, e não quebra', () => {
  assert.deepEqual(buildJourneyGraph([]), { nodes: [], edges: [], attributions: [], sources: [], totals: { pageviews: 0, sessions: 0, pages: 0, conversions: 0, conversionRate: 0 } });
  assert.deepEqual(buildJourneyGraph(null).totals.sessions, 0);
});

const visita = (sessionId, urlPath, minuto, extra = {}) => ({
  id: `${sessionId}-${urlPath}-${minuto}`, sessionId, urlPath,
  at: new Date(Date.UTC(2026, 8, 1, 10, minuto)), eventType: 'pageview', ...extra,
});
const acao = (sessionId, nome, minuto, urlPath, extra = {}) => ({
  id: `${sessionId}-${nome}-${minuto}`, sessionId, urlPath, eventName: nome,
  at: new Date(Date.UTC(2026, 8, 1, 10, minuto)), eventType: 'custom', ...extra,
});

test('a ação executada vira um nó no fim do caminho da sessão', () => {
  const grafo = buildJourneyGraph([
    visita('s1', '/', 1, { utmSource: 'google' }),
    visita('s1', '/obrigado', 3, { utmSource: 'google' }),
    acao('s1', 'lead', 2, '/', { utmSource: 'google' }),
  ]);
  const evento = grafo.nodes.find((n) => n.type === 'event');
  assert.equal(evento.id, 'evento:lead');
  assert.equal(evento.label, 'lead');
  assert.equal(evento.sessions, 1);
  assert.ok(grafo.edges.some((e) => e.source === '/' && e.target === 'evento:lead'), 'a ação sai da página onde aconteceu');
});

test('a taxa de conversão sai das sessões que executaram alguma ação', () => {
  const grafo = buildJourneyGraph([
    visita('s1', '/', 1), acao('s1', 'lead', 2, '/'),
    visita('s2', '/', 1),
    visita('s3', '/', 1), acao('s3', 'purchase', 2, '/'),
    visita('s4', '/', 1),
  ]);
  assert.equal(grafo.totals.sessions, 4);
  assert.equal(grafo.totals.conversions, 2);
  assert.equal(grafo.totals.conversionRate, 50);
});

test('filtrar por origem deixa no mapa só as sessões daquela campanha', () => {
  const eventos = [
    visita('s1', '/', 1, { utmSource: 'google' }), acao('s1', 'lead', 2, '/', { utmSource: 'google' }),
    visita('s2', '/', 1, { utmSource: 'facebook' }),
  ];
  const google = buildJourneyGraph(eventos, { source: 'google' });
  assert.equal(google.totals.sessions, 1);
  assert.equal(google.totals.conversions, 1);
  assert.deepEqual(google.attributions.map((a) => a.source), ['google']);

  const facebook = buildJourneyGraph(eventos, { source: 'facebook' });
  assert.equal(facebook.totals.conversions, 0);
  assert.equal(buildJourneyGraph(eventos, { source: '' }).totals.sessions, 2, 'sem filtro, tudo entra');
});

test('as origens disponíveis para filtro vêm do próprio período', () => {
  const grafo = buildJourneyGraph([
    visita('s1', '/', 1, { utmSource: 'google' }),
    visita('s2', '/', 1, { referrerDomain: 'facebook.com' }),
    visita('s3', '/', 1),
  ]);
  assert.deepEqual(grafo.sources.sort(), ['direct', 'facebook.com', 'google']);
});
