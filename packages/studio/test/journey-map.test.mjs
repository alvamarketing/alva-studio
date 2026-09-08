import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { journeyLayout } from '../public/studio-dashboard.js';

const grafo = {
  nodes: [
    { id: '/', label: '/', pageviews: 100, sessions: 80, entries: 70, exits: 20 },
    { id: '/precos', label: '/precos', pageviews: 60, sessions: 50, entries: 5, exits: 15 },
    { id: '/obrigado', label: '/obrigado', pageviews: 20, sessions: 18, entries: 0, exits: 18 },
  ],
  edges: [
    { source: '/', target: '/precos', transitions: 40, sessions: 35 },
    { source: '/precos', target: '/obrigado', transitions: 18, sessions: 18 },
  ],
  attributions: [{ source: 'google', medium: 'cpc', campaign: 'marca', entry: '/', sessions: 40 }],
  totals: { pageviews: 180, sessions: 80, pages: 3 },
};

test('a jornada vira colunas: a entrada abre o mapa e cada passagem avança uma etapa', () => {
  // sem origens declaradas o mapa começa na entrada; a coluna de origem tem teste próprio
  const mapa = journeyLayout({ ...grafo, attributions: [] });
  const porId = Object.fromEntries(mapa.nodes.map((n) => [n.id, n]));
  assert.equal(porId['/'].depth, 0, 'a página de entrada abre o mapa');
  assert.equal(porId['/precos'].depth, 1);
  assert.equal(porId['/obrigado'].depth, 2);
  assert.deepEqual(mapa.columns.map((c) => c.title), ['Entrada', 'Etapa 2', 'Etapa 3']);
});

test('cada cartão recebe coordenadas dentro da área desenhada', () => {
  const mapa = journeyLayout(grafo);
  for (const no of mapa.nodes) {
    assert.ok(Number.isFinite(no.x) && no.x >= 0, `x inválido em ${no.id}`);
    assert.ok(Number.isFinite(no.y) && no.y >= 0, `y inválido em ${no.id}`);
    assert.ok(no.x + mapa.cardWidth <= mapa.width, `${no.id} passa da largura`);
  }
  assert.ok(mapa.height > 0 && mapa.width > 0);
});

test('as passagens sabem seu volume e sua participação na origem', () => {
  const mapa = journeyLayout(grafo);
  const passagem = mapa.edges.find((e) => e.source === '/' && e.target === '/precos');
  assert.equal(passagem.transitions, 40);
  assert.equal(passagem.share, '40%', '40 das 100 visualizações de / seguiram para /precos');
  assert.ok(passagem.path.startsWith('M'), 'a curva é um caminho SVG');
});

test('o mapa se limita aos nós mais relevantes', () => {
  const muitos = { ...grafo, nodes: Array.from({ length: 40 }, (_, i) => ({ id: `/p${i}`, label: `/p${i}`, pageviews: 100 - i, sessions: 1, entries: i === 0 ? 1 : 0, exits: 0 })), edges: [] };
  assert.equal(journeyLayout(muitos).nodes.length, 24);
});

test('grafo vazio não quebra o mapa', () => {
  const vazio = journeyLayout({ nodes: [], edges: [], attributions: [], totals: { pageviews: 0, sessions: 0, pages: 0 } });
  assert.deepEqual(vazio.nodes, []);
  assert.deepEqual(vazio.columns, []);
  assert.equal(journeyLayout(null).nodes.length, 0);
});

test('o mapa de resultados fecha a página de Analytics', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tela = markup.slice(markup.indexOf('id="analytics-view"'), markup.indexOf('id="tracking-view"'));
  assert.match(tela, /id="journey-graph"/);
  assert.match(tela, /Mapa de resultados/);
});

test('o app busca a jornada junto com o resto da página', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /analytics\/journey/);
  assert.match(app, /journeyLayout/);
  assert.match(app, /function pintarJornadaDoSite\(/);
  assert.match(app, /void carregarJornada\(\)/);
});

const comOrigens = {
  ...grafo,
  attributions: [
    { source: 'google', medium: 'cpc', campaign: 'marca', entry: '/', sessions: 40 },
    { source: 'facebook', medium: 'cpc', campaign: 'frio', entry: '/', sessions: 25 },
    { source: 'google', medium: 'cpc', campaign: 'marca', entry: '/precos', sessions: 10 },
    { source: 'direct', medium: null, campaign: null, entry: '/', sessions: 15 },
  ],
};

test('cada origem vira um nó na primeira coluna, antes das páginas de entrada', () => {
  const mapa = journeyLayout(comOrigens);
  const origens = mapa.nodes.filter((n) => n.type === 'source');
  assert.deepEqual(origens.map((n) => n.label).sort(), ['direct', 'facebook · frio', 'google · marca']);
  assert.ok(origens.every((n) => n.depth === 0), 'origens abrem o mapa');
  assert.equal(mapa.nodes.find((n) => n.id === '/').depth, 1, 'a entrada passa para a segunda coluna');
  // /precos também é entrada de campanha, então divide a coluna Entrada com /
  assert.deepEqual(mapa.columns.map((c) => c.title), ['Origem', 'Entrada', 'Etapa 2']);
});

test('a mesma origem com entradas diferentes é um nó só, com uma passagem para cada entrada', () => {
  const mapa = journeyLayout(comOrigens);
  const google = mapa.nodes.find((n) => n.label === 'google · marca');
  assert.equal(google.sessions, 50, '40 na home e 10 em /precos');
  const passagens = mapa.edges.filter((e) => e.source === google.id);
  assert.deepEqual(passagens.map((e) => `${e.target}:${e.transitions}`).sort(), ['/:40', '/precos:10']);
});

test('sem origens registradas o mapa continua começando na entrada', () => {
  const mapa = journeyLayout({ ...grafo, attributions: [] });
  assert.equal(mapa.nodes.filter((n) => n.type === 'source').length, 0);
  assert.deepEqual(mapa.columns.map((c) => c.title), ['Entrada', 'Etapa 2', 'Etapa 3']);
});

test('o mapa separa cartões de página e de ação', () => {
  const comAcao = {
    ...grafo,
    nodes: [...grafo.nodes, { id: 'evento:lead', type: 'event', label: 'lead', pageviews: 0, sessions: 30, entries: 0, exits: 0 }],
    edges: [...grafo.edges, { source: '/precos', target: 'evento:lead', transitions: 30, sessions: 30 }],
  };
  const mapa = journeyLayout(comAcao);
  const acao = mapa.nodes.find((n) => n.id === 'evento:lead');
  assert.equal(acao.type, 'event');
  assert.ok(acao.depth > mapa.nodes.find((n) => n.id === '/precos').depth, 'a ação vem depois da página onde acontece');
});

test('a tela tem filtro de origem e controles de zoom no mapa', async () => {
  const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tela = markup.slice(markup.indexOf('id="analytics-view"'), markup.indexOf('id="tracking-view"'));
  assert.match(tela, /id="journey-source"/);
  assert.match(tela, /id="journey-zoom-in"/);
  assert.match(tela, /id="journey-zoom-out"/);
  assert.match(tela, /id="journey-reset"/);
});

test('o mapa arrasta, dá zoom e destaca o caminho ao clicar num cartão', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /pointerdown/);
  assert.match(app, /wheel/);
  assert.match(app, /function destacarCaminho\(/);
  assert.match(app, /journey-dim/);
  // o filtro refaz a busca, porque o recorte é feito no servidor
  assert.match(app, /journeySource/);
});

test('rótulos de passagens que saem do mesmo cartão não caem no mesmo ponto', () => {
  const leque = {
    nodes: [
      { id: '/', type: 'page', label: '/', pageviews: 200, sessions: 200, entries: 200, exits: 0 },
      ...['/a', '/b', '/c', '/d'].map((id, i) => ({ id, type: 'page', label: id, pageviews: 50 - i, sessions: 50 - i, entries: 0, exits: 10 })),
    ],
    edges: ['/a', '/b', '/c', '/d'].map((target, i) => ({ source: '/', target, transitions: 50 - i * 12, sessions: 40 - i * 10 })),
    attributions: [], totals: { pageviews: 400, sessions: 200, pages: 5 },
  };
  const mapa = journeyLayout(leque);
  const pontos = mapa.edges.map((e) => `${Math.round(e.labelX)},${Math.round(e.labelY)}`);
  assert.equal(new Set(pontos).size, pontos.length, 'cada passagem escreve seu rótulo em um ponto próprio');
});

test('só as passagens mais fortes trazem rótulo fixo; as fracas ficam para o destaque', () => {
  const leque = {
    nodes: [
      { id: '/', type: 'page', label: '/', pageviews: 100, sessions: 100, entries: 100, exits: 0 },
      ...['/a', '/b', '/c', '/d', '/e'].map((id) => ({ id, type: 'page', label: id, pageviews: 10, sessions: 10, entries: 0, exits: 5 })),
    ],
    edges: [
      { source: '/', target: '/a', transitions: 60, sessions: 50 },
      { source: '/', target: '/b', transitions: 20, sessions: 18 },
      { source: '/', target: '/c', transitions: 12, sessions: 10 },
      { source: '/', target: '/d', transitions: 5, sessions: 4 },
      { source: '/', target: '/e', transitions: 3, sessions: 2 },
    ],
    attributions: [], totals: { pageviews: 200, sessions: 100, pages: 6 },
  };
  const mapa = journeyLayout(leque);
  assert.deepEqual(mapa.edges.filter((e) => e.major).map((e) => e.target), ['/a', '/b', '/c']);
  assert.equal(mapa.edges.filter((e) => !e.major).length, 2);
});

test('clicar num cartão acende a cadeia inteira: quem leva até ele e o que sai dele', async () => {
  const { journeyConnected } = await import('../public/studio-dashboard.js');
  const cadeia = {
    edges: [
      { source: 'origem:google', target: '/' },
      { source: '/', target: '/precos' },
      { source: '/precos', target: 'evento:lead' },
      { source: 'evento:lead', target: '/obrigado' },
      { source: 'origem:facebook', target: '/outra' },
      { source: '/outra', target: '/sem-relacao' },
    ],
  };
  // do /obrigado, tudo que leva até ele acende — inclusive a origem
  const ate = journeyConnected(cadeia, '/obrigado');
  assert.deepEqual([...ate].sort(), ['/', '/obrigado', '/precos', 'evento:lead', 'origem:google']);
  assert.ok(!ate.has('/outra'), 'o que não tem ligação fica de fora');

  // de um nó do meio, acende para os dois lados
  const meio = journeyConnected(cadeia, '/precos');
  assert.deepEqual([...meio].sort(), ['/', '/obrigado', '/precos', 'evento:lead', 'origem:google']);

  assert.equal(journeyConnected(cadeia, null).size, 0);
  assert.equal(journeyConnected(null, '/').size, 0);
});
