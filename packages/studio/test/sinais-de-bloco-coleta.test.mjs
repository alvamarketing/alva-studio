// Etapa 7, passo 2: o tracker mede por bloco e o coletor só aceita o que ele sabe medir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createTracker, criarSinaisDeBloco, bootTracker } from '../public/tracker.js';
import { parseCollectPayload } from '../server/analytics-collect.mjs';

// ---------- o que o coletor aceita ----------

const corpo = (eventData, extra = {}) => JSON.stringify({ trackerPublicId: 'trk_1', event_name: 'bloco_sinais', url_path: '/oferta', event_data: eventData, ...extra });
const analisar = (eventData, extra) => parseCollectPayload(corpo(eventData, extra), 'text/plain');
const recusa = (eventData, padrao, extra) => assert.throws(() => analisar(eventData, extra), padrao);

test('o lote de sinais é aceito e sai normalizado: só ids, contagens e segundos', () => {
  const { event } = analisar({ rolagem: [50, 25], blocos: [{ id: 'secao-1', entrou: 1, segundos: 12, cliques: 2 }, { id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', entrou: 0, segundos: 0, cliques: 1 }] });
  assert.equal(event.event_name, 'bloco_sinais');
  assert.equal(event.url_path, '/oferta');
  assert.deepEqual(event.event_data, {
    rolagem: [25, 50],
    blocos: [{ id: 'secao-1', entrou: 1, segundos: 12, cliques: 2 }, { id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', entrou: 0, segundos: 0, cliques: 1 }],
  });
});

test('só a rolagem, ou só os blocos, também vale', () => {
  assert.deepEqual(analisar({ rolagem: [25] }).event.event_data, { rolagem: [25] });
  assert.deepEqual(analisar({ blocos: [{ id: 'a', entrou: 1, segundos: 0, cliques: 0 }] }).event.event_data.blocos.length, 1);
});

test('o lote precisa dizer de qual página veio, e não pode vir vazio', () => {
  assert.throws(() => parseCollectPayload(JSON.stringify({ trackerPublicId: 'trk_1', event_name: 'bloco_sinais', event_data: { rolagem: [25] } }), 'text/plain'), /url_path/);
  recusa(undefined, /event_data/);
  recusa({}, /vazio|sinais/);
  recusa({ rolagem: [], blocos: [] }, /vazio|sinais/);
});

test('a allowlist é fechada: chave desconhecida no lote ou no bloco é recusada', () => {
  recusa({ rolagem: [25], texto: 'oi' }, /não permitido/);
  recusa({ blocos: [{ id: 'a', entrou: 1, segundos: 1, cliques: 0, texto: 'conteúdo do bloco' }] }, /não permitido/);
  recusa({ blocos: [{ id: 'a', entrou: 1, segundos: 1, cliques: 0, x: 10, y: 20 }] }, /não permitido/);
});

test('o id do bloco é o id do nó: nada de espaço, aspas, marcação ou texto livre', () => {
  for (const id of ['a b', 'x"y', '<script>', 'çã', '', 'a'.repeat(81), 'oi@exemplo.com', 7, null, { id: 'a' }]) {
    recusa({ blocos: [{ id, entrou: 1, segundos: 1, cliques: 0 }] }, /id do bloco/, undefined);
  }
});

test('os números são inteiros e limitados', () => {
  const base = { id: 'a', entrou: 1, segundos: 1, cliques: 0 };
  recusa({ blocos: [{ ...base, entrou: 2 }] }, /entrou/);
  recusa({ blocos: [{ ...base, entrou: true }] }, /entrou/);
  recusa({ blocos: [{ ...base, segundos: -1 }] }, /segundos/);
  recusa({ blocos: [{ ...base, segundos: 3601 }] }, /segundos/);
  recusa({ blocos: [{ ...base, segundos: 1.5 }] }, /segundos/);
  recusa({ blocos: [{ ...base, segundos: '5' }] }, /segundos/);
  recusa({ blocos: [{ ...base, cliques: 101 }] }, /cliques/);
  recusa({ blocos: [{ ...base, cliques: -1 }] }, /cliques/);
  recusa({ blocos: [{ ...base, segundos: undefined }] }, /segundos/);
});

test('a rolagem só tem os marcos 25, 50, 75 e 100', () => {
  recusa({ rolagem: [30] }, /rolagem/);
  recusa({ rolagem: [0] }, /rolagem/);
  recusa({ rolagem: [125] }, /rolagem/);
  recusa({ rolagem: 50 }, /rolagem/);
  recusa({ rolagem: [25, 25, 25, 25, 25] }, /rolagem/);
  assert.deepEqual(analisar({ rolagem: [100, 75, 50, 25] }).event.event_data.rolagem, [25, 50, 75, 100]);
});

test('no máximo 100 blocos por lote, sem id repetido', () => {
  const bloco = (n) => ({ id: `b${n}`, entrou: 1, segundos: 1, cliques: 0 });
  assert.equal(analisar({ blocos: Array.from({ length: 100 }, (_, n) => bloco(n)) }).event.event_data.blocos.length, 100);
  recusa({ blocos: Array.from({ length: 101 }, (_, n) => bloco(n)) }, /blocos/);
  recusa({ blocos: [bloco(1), bloco(1)] }, /repetido|blocos/);
  recusa({ blocos: 'a' }, /blocos/);
  recusa({ blocos: [null] }, /bloco/);
});

test('os campos novos não vazam para os outros eventos', () => {
  assert.throws(() => parseCollectPayload(JSON.stringify({ trackerPublicId: 'trk_1', event_name: 'pageview', url_path: '/', event_data: { blocos: [] } }), 'text/plain'), /não permitido/);
  assert.throws(() => parseCollectPayload(JSON.stringify({ trackerPublicId: 'trk_1', event_name: 'vsl_start', url_path: '/', event_data: { rolagem: [25] } }), 'text/plain'), /não permitido/);
  // E o formato do evento de sinais continua plano na raiz.
  assert.throws(() => analisar({ rolagem: [25] }, { blocos: [] }), /Campo não permitido/);
});

// ---------- o que o tracker mede ----------

class ObservadorFalso {
  static ultimo = null;
  constructor(aoInterceptar, opcoes) { this.aoInterceptar = aoInterceptar; this.opcoes = opcoes; this.alvos = []; ObservadorFalso.ultimo = this; }
  observe(alvo) { this.alvos.push(alvo); }
  disconnect() { this.alvos = []; }
  // Entrada como o navegador entrega: razão visível, e a altura da área visível sobre a da tela.
  mostrar(alvo, { razao = 1, alturaVisivel = 400, alturaDaTela = 800 } = {}) {
    this.aoInterceptar([{ target: alvo, isIntersecting: razao > 0, intersectionRatio: razao, intersectionRect: { height: alturaVisivel }, rootBounds: { height: alturaDaTela } }]);
  }
  esconder(alvo) { this.aoInterceptar([{ target: alvo, isIntersecting: false, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 800 } }]); }
}

const HTML = `<body>
  <section data-alva-bloco="secao-topo"><div data-alva-bloco="titulo-1"><h1>Título</h1></div><div data-alva-bloco="botao-1"><a id="cta" href="#x"><span id="rotulo">Quero</span></a></div><p id="solto">texto</p></section>
  <section data-alva-bloco="secao-fim"><div data-alva-bloco="form-1"><form><input name="email"><button id="enviar" type="submit">Enviar</button></form></div></section>
  <a id="fora" href="#y">fora de bloco</a>
  <div data-alva-bloco="id com espaço"></div>
</body>`;

function montar({ altura = 4000, tela = 800 } = {}) {
  const dom = new JSDOM(HTML, { pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  let agora = 1_000_000;
  let visibilidade = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidade });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => altura });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => tela });
  let rolado = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => rolado });
  window.requestAnimationFrame = (f) => f();
  const lotes = [];
  const sinais = criarSinaisDeBloco({ document, window, track: (nome, dados) => lotes.push({ nome, dados }), now: () => agora, IntersectionObserverImpl: ObservadorFalso });
  sinais.iniciar();
  const el = (id) => document.querySelector(`[data-alva-bloco="${id}"]`);
  return {
    window, document, sinais, lotes, el, io: ObservadorFalso.ultimo,
    passar: (ms) => { agora += ms; },
    esconderAba: () => { visibilidade = 'hidden'; document.dispatchEvent(new window.Event('visibilitychange')); },
    mostrarAba: () => { visibilidade = 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); },
    rolarPara: (y) => { rolado = y; window.dispatchEvent(new window.Event('scroll')); },
  };
}

test('só observa blocos com id no formato do nó', () => {
  const t = montar();
  assert.equal(t.sinais.blocosObservados(), 5);
  assert.deepEqual(t.io.alvos.map((a) => a.getAttribute('data-alva-bloco')).sort(), ['botao-1', 'form-1', 'secao-fim', 'secao-topo', 'titulo-1']);
});

test('entrou na tela com 50% visível, e o tempo só corre com a aba visível', () => {
  const t = montar();
  t.io.mostrar(t.el('titulo-1'), { razao: 0.4, alturaVisivel: 100 });
  t.passar(5000);
  t.esconderAba();
  assert.equal(t.lotes.length, 0, '40% visível não é "entrou", e a página ainda não rolou até o primeiro marco');

  t.mostrarAba();
  t.io.mostrar(t.el('titulo-1'), { razao: 0.5 });
  t.passar(3000);
  t.esconderAba(); // 3 s à vista
  t.passar(60_000); // aba escondida: não conta
  t.mostrarAba();
  t.passar(2000);
  t.esconderAba(); // mais 2 s
  const total = t.lotes.flatMap((l) => l.dados.blocos ?? []).filter((b) => b.id === 'titulo-1');
  assert.deepEqual(total, [{ id: 'titulo-1', entrou: 1, segundos: 3, cliques: 0 }, { id: 'titulo-1', entrou: 0, segundos: 2, cliques: 0 }]);
});

test('bloco mais alto que a tela vale como visto quando ocupa metade da altura dela', () => {
  const t = montar();
  t.io.mostrar(t.el('secao-topo'), { razao: 0.2, alturaVisivel: 420, alturaDaTela: 800 });
  t.passar(1000);
  t.esconderAba();
  assert.deepEqual(t.lotes.flatMap((l) => l.dados.blocos ?? []), [{ id: 'secao-topo', entrou: 1, segundos: 1, cliques: 0 }]);
});

test('sair da tela fecha o intervalo', () => {
  const t = montar();
  t.io.mostrar(t.el('titulo-1'));
  t.passar(4000);
  t.io.esconder(t.el('titulo-1'));
  t.passar(30_000);
  t.window.dispatchEvent(new t.window.Event('pagehide'));
  assert.deepEqual(t.lotes.flatMap((l) => l.dados.blocos ?? []), [{ id: 'titulo-1', entrou: 1, segundos: 4, cliques: 0 }]);
});

test('clique em link ou botão conta para o bloco e para quem o contém; texto solto e link fora de bloco, não', () => {
  const t = montar();
  const clicar = (id) => t.document.getElementById(id).dispatchEvent(new t.window.MouseEvent('click', { bubbles: true, clientX: 33, clientY: 44 }));
  clicar('rotulo'); // dentro do <a> do botão-1, que está na seção-topo
  clicar('rotulo');
  clicar('solto');
  clicar('fora');
  clicar('enviar');
  t.esconderAba();
  const blocos = Object.fromEntries(t.lotes.flatMap((l) => l.dados.blocos ?? []).map((b) => [b.id, b.cliques]));
  assert.deepEqual(blocos, { 'botao-1': 2, 'secao-topo': 2, 'form-1': 1, 'secao-fim': 1 });
});

test('a rolagem não envia nada enquanto a pessoa rola: um lote só, quando a aba some', () => {
  const t = montar({ altura: 4000, tela: 800 });
  for (let y = 0; y <= 3200; y += 40) t.rolarPara(y);
  assert.equal(t.lotes.length, 0, 'rolar centenas de vezes não envia');
  t.esconderAba();
  assert.equal(t.lotes.length, 1);
  assert.deepEqual(t.lotes[0].dados.rolagem, [25, 50, 75, 100]);
});

test('a profundidade é o ponto mais fundo alcançado, em 25/50/75/100', () => {
  const t = montar({ altura: 4000, tela: 800 }); // 800/4000 = 20% à vista de início
  t.rolarPara(1200); // (1200+800)/4000 = 50%
  t.rolarPara(0); // voltar não desfaz
  t.esconderAba();
  assert.deepEqual(t.lotes[0].dados.rolagem, [25, 50]);
});

test('a última rolagem não se perde se o quadro de animação não chegou a rodar antes de a aba sumir', () => {
  const t = montar({ altura: 4000, tela: 800 });
  t.window.requestAnimationFrame = () => {}; // aba em segundo plano: o quadro nunca vem
  t.rolarPara(3200);
  t.esconderAba();
  assert.deepEqual(t.lotes[0].dados.rolagem, [25, 50, 75, 100]);
});

test('uma página que cabe na tela já foi vista até o fim', () => {
  const t = montar({ altura: 700, tela: 800 });
  t.esconderAba();
  assert.deepEqual(t.lotes[0].dados.rolagem, [25, 50, 75, 100]);
});

test('o segundo lote leva só o que mudou: nada de entrada ou marco repetido', () => {
  const t = montar({ altura: 4000, tela: 800 });
  t.io.mostrar(t.el('titulo-1'));
  t.rolarPara(3200);
  t.passar(2000);
  t.esconderAba();
  t.lotes.length = 0;
  t.mostrarAba();
  t.passar(1000);
  t.esconderAba();
  assert.equal(t.lotes.length, 1);
  assert.deepEqual(t.lotes[0].dados, { blocos: [{ id: 'titulo-1', entrou: 0, segundos: 1, cliques: 0 }] });
  // pagehide logo depois não tem mais nada para dizer.
  t.lotes.length = 0;
  t.window.dispatchEvent(new t.window.Event('pagehide'));
  assert.equal(t.lotes.length, 0);
});

test('sem nada medido, nada é enviado', () => {
  const t = montar({ altura: 4000, tela: 800 });
  t.esconderAba();
  t.lotes.length = 0;
  t.mostrarAba();
  t.esconderAba();
  assert.equal(t.lotes.length, 0);
});

test('mais de 100 blocos saem em lotes de até 100, e todos passam no coletor', () => {
  const dom = new JSDOM(`<body>${Array.from({ length: 230 }, (_, n) => `<div data-alva-bloco="b${n}"></div>`).join('')}</body>`, { pretendToBeVisual: true });
  const { window } = dom;
  const lotes = [];
  const sinais = criarSinaisDeBloco({ document: window.document, window, track: (nome, dados) => lotes.push(dados), now: () => 1, IntersectionObserverImpl: ObservadorFalso });
  sinais.iniciar();
  for (const alvo of ObservadorFalso.ultimo.alvos) ObservadorFalso.ultimo.mostrar(alvo);
  sinais.enviar();
  assert.deepEqual(lotes.map((l) => (l.blocos ?? []).length), [100, 100, 30]);
  for (const dados of lotes) assert.doesNotThrow(() => analisar(dados));
});

test('o lote de verdade, enviado pelo tracker, passa pelo coletor sem perda', () => {
  const t = montar({ altura: 4000, tela: 800 });
  const enviados = [];
  const tracker = createTracker({ trackerPublicId: 'trk_1', location: { pathname: '/oferta', search: '?email=a@b.com' }, navigator: { sendBeacon: (url, dados) => { enviados.push(dados); return true; } } });
  const sinais = criarSinaisDeBloco({ document: t.document, window: t.window, track: (nome, dados) => tracker.track(nome, dados), now: () => 5, IntersectionObserverImpl: ObservadorFalso });
  sinais.iniciar();
  ObservadorFalso.ultimo.mostrar(t.el('botao-1'));
  t.document.getElementById('cta').dispatchEvent(new t.window.MouseEvent('click', { bubbles: true }));
  sinais.enviar();
  assert.equal(enviados.length, 1);
  const { event } = parseCollectPayload(enviados[0], 'text/plain');
  assert.equal(event.event_name, 'bloco_sinais');
  assert.equal(event.url_path, '/oferta');
  assert.equal(event.url_query, undefined, 'o e-mail da URL nem chega a sair do navegador');
  // O clique vai para o botão e para a seção que o contém.
  assert.deepEqual(event.event_data.blocos, [{ id: 'secao-topo', entrou: 0, segundos: 0, cliques: 1 }, { id: 'botao-1', entrou: 1, segundos: 0, cliques: 1 }]);
  // Nenhum texto da página, valor de campo ou coordenada foi junto.
  for (const proibido of ['Quero', 'Título', 'a@b.com', 'clientX', 'email']) assert.equal(enviados[0].includes(proibido), false, proibido);
});

test('sem IntersectionObserver o tracker segue com o pageview e só desiste dos sinais', () => {
  const dom = new JSDOM(HTML);
  assert.equal(criarSinaisDeBloco({ document: dom.window.document, window: dom.window, track() {}, IntersectionObserverImpl: undefined }), null);
});

test('o boot liga os sinais na página publicada e o pageview segue saindo como antes', async () => {
  const dom = new JSDOM(HTML, { pretendToBeVisual: true });
  const { document } = dom.window;
  Object.defineProperty(document, 'currentScript', { configurable: true, value: { dataset: { alvaTracker: 'trk_1', hostUrl: 'https://studio.example.test' } } });
  const enviados = [];
  const navigator = { sendBeacon: (url, dados) => { enviados.push(JSON.parse(dados)); return true; } };
  const anterior = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = ObservadorFalso;
  try {
    bootTracker({ doc: document, win: dom.window, location: { pathname: '/oferta', search: '' }, navigator });
  } finally { globalThis.IntersectionObserver = anterior; }
  // O script vem no fim do <body>, mas o jsdom ainda está "loading": o tracker espera o DOM.
  if (document.readyState === 'loading') await new Promise((resolve) => dom.window.addEventListener('DOMContentLoaded', resolve));
  assert.equal(enviados[0].event_name, 'pageview');
  ObservadorFalso.ultimo.mostrar(document.querySelector('[data-alva-bloco="titulo-1"]'));
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  const sinais = enviados.find((e) => e.event_name === 'bloco_sinais');
  assert.ok(sinais);
  assert.equal(sinais.url_path, '/oferta');
});

// ---------- privacidade e quem edita não é visitante ----------

const trackerFonte = readFileSync(fileURLToPath(new URL('../public/tracker.js', import.meta.url)), 'utf8');

test('o tracker nunca lê texto, valor de campo, posição ou armazenamento', () => {
  for (const proibido of ['.value', '.elements', 'FormData', 'localStorage', 'sessionStorage', 'textContent', 'innerText', 'innerHTML', 'outerHTML', 'clientX', 'clientY', 'pageX', 'pageY', 'getBoundingClientRect', 'cookie']) {
    assert.equal(trackerFonte.includes(proibido), false, `tracker.js não deve conter "${proibido}"`);
  }
  // A única consulta em massa ao DOM é a dos blocos marcados.
  const consultas = [...trackerFonte.matchAll(/querySelectorAll\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(consultas, ['SELETOR_DE_BLOCO']);
});

test('o formato do id no tracker é o mesmo que o coletor e a página usam', async () => {
  const { FORMATO_ID_DE_BLOCO } = await import('../public/page-schema.js');
  const noTracker = trackerFonte.match(/const FORMATO_ID_DE_BLOCO = (\/.*\/);/)?.[1];
  assert.equal(noTracker, String(FORMATO_ID_DE_BLOCO));
});

test('nenhuma tela do Studio carrega o tracker: quem edita não é visitante', () => {
  const publico = fileURLToPath(new URL('../public/', import.meta.url));
  const telas = readdirSync(publico).filter((nome) => nome.endsWith('.html'));
  assert.ok(telas.length >= 3, 'index, editor e funil, ao menos');
  for (const tela of telas) {
    const html = readFileSync(`${publico}${tela}`, 'utf8');
    assert.doesNotMatch(html, /tracker\.js|data-alva-tracker/, tela);
  }
  for (const modulo of ['app.js', 'pagina-alva.js', 'puck-conversao.js', 'vsl-ui.js', 'vsl-previa.js']) {
    assert.doesNotMatch(readFileSync(`${publico}${modulo}`, 'utf8'), /tracker\.js|data-alva-tracker/, modulo);
  }
  for (const fonte of ['main.jsx', 'config.jsx', 'funil.jsx']) {
    assert.doesNotMatch(readFileSync(fileURLToPath(new URL(`../editor/${fonte}`, import.meta.url)), 'utf8'), /tracker\.js|data-alva-tracker/, fonte);
  }
});
