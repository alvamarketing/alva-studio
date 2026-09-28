import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://studio.example.test/embed/v/abc' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.CustomEvent = window.CustomEvent;
// O jsdom não toca mídia: play e pause só mudam o estado, como o navegador faria.
window.HTMLMediaElement.prototype.play = function play() {
  Object.defineProperty(this, 'paused', { value: false, configurable: true });
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function pause() {
  Object.defineProperty(this, 'paused', { value: true, configurable: true });
  this.dispatchEvent(new window.Event('pause'));
};
window.HTMLMediaElement.prototype.load = function load() {};

const { createVslPlayerController, mensagemDaVsl, mountVslPlayer, resumeStorageKey } = await import('../public/vsl-player.js');

const memoria = () => {
  const salvo = new Map();
  return { salvo, getItem: (k) => salvo.get(k) ?? null, setItem: (k, v) => salvo.set(k, v), removeItem: (k) => salvo.delete(k) };
};
const base = { publicId: 'vsl-abc', versionNumber: 1, sourceUrl: 'https://media.example.test/a.mp4', sourceType: 'mp4', autoplayMuted: true, resumeEnabled: true, accentColor: '#286eea' };
const montar = (config) => {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const player = mountVslPlayer(container, { ...base, storage: memoria(), ...config });
  Object.defineProperty(player.video, 'duration', { value: 100, configurable: true });
  return { container, ...player };
};

test('trava de avanço deixa voltar, mas não passar do que já foi assistido', () => {
  const travado = createVslPlayerController({ duration: 100, travarAvanco: true, storage: null });
  travado.timeUpdate(30);
  assert.equal(travado.destinoDoAvanco(80), 30);
  assert.equal(travado.destinoDoAvanco(10), 10);
  travado.timeUpdate(10);
  assert.equal(travado.destinoDoAvanco(25), 25, 'voltar não reduz o que já foi assistido');
  const livre = createVslPlayerController({ duration: 100, storage: null });
  livre.timeUpdate(30);
  assert.equal(livre.destinoDoAvanco(80), 80);
});

test('a mensagem para a página que embute a VSL leva só identificador, tempo e marco', () => {
  assert.deepEqual(mensagemDaVsl({ type: 'milestone', publicId: 'vsl-abc', versionNumber: 1, value: 25 }), { alvaVsl: 1, tipo: 'marco', publicId: 'vsl-abc', valor: 25 });
  assert.deepEqual(mensagemDaVsl({ type: 'start', publicId: 'vsl-abc' }), { alvaVsl: 1, tipo: 'inicio', publicId: 'vsl-abc' });
  assert.equal(mensagemDaVsl({ type: 'error', publicId: 'vsl-abc' }), null);
});

test('som inteligente: aviso grande por cima; o toque liga o som e recomeça do zero', () => {
  const { container, video } = montar({ opcoes: { textoDoSom: 'Seu vídeo já começou' } });
  const aviso = container.querySelector('.vsl-som');
  assert.ok(aviso, 'o aviso de som aparece');
  assert.equal(aviso.hidden, false);
  assert.match(aviso.textContent, /Seu vídeo já começou/);
  assert.equal(video.muted, true);
  video.currentTime = 12;
  aviso.click();
  assert.equal(video.muted, false);
  assert.equal(video.currentTime, 0);
  assert.equal(aviso.hidden, true);
});

test('som inteligente desligado não mostra o aviso', () => {
  const { container } = montar({ opcoes: { somInteligente: false } });
  assert.equal(container.querySelector('.vsl-som'), null);
});

test('CTA usa a cor, a cor do texto e o subtexto escolhidos', () => {
  const { container } = montar({ ctaText: 'Quero agora', ctaUrl: '/checkout', ctaSeconds: 5, opcoes: { ctaCor: '#ff0000', ctaCorDoTexto: '#000000', ctaSubtexto: 'Vagas limitadas' } });
  const cta = container.querySelector('.vsl-cta');
  assert.match(cta.textContent, /Quero agora/);
  assert.equal(cta.querySelector('small').textContent, 'Vagas limitadas');
  assert.equal(cta.style.background, 'rgb(255, 0, 0)');
  assert.equal(cta.style.color, 'rgb(0, 0, 0)');
});

test('quem volta escolhe entre continuar de onde parou e recomeçar', () => {
  const storage = memoria();
  storage.setItem(resumeStorageKey('vsl-abc', 1), JSON.stringify({ time: 35 }));
  const { container, video } = montar({ storage });
  video.dispatchEvent(new window.Event('loadedmetadata'));
  const pergunta = container.querySelector('.vsl-retomar');
  assert.equal(pergunta.hidden, false);
  assert.equal(container.querySelector('.vsl-som')?.hidden ?? true, true, 'o aviso de som não disputa a tela com a pergunta');
  pergunta.querySelector('[data-retomar="continuar"]').click();
  assert.equal(video.currentTime, 35);
  assert.equal(video.muted, false);
  assert.equal(pergunta.hidden, true);
});

test('recomeçar volta ao zero com som', () => {
  const storage = memoria();
  storage.setItem(resumeStorageKey('vsl-abc', 1), JSON.stringify({ time: 35 }));
  const { container, video } = montar({ storage });
  video.dispatchEvent(new window.Event('loadedmetadata'));
  container.querySelector('[data-retomar="recomecar"]').click();
  assert.equal(video.currentTime, 0);
  assert.equal(video.muted, false);
});

test('sem perguntar ao retomar, o vídeo segue de onde parou sem pergunta', () => {
  const storage = memoria();
  storage.setItem(resumeStorageKey('vsl-abc', 1), JSON.stringify({ time: 35 }));
  const { container, video } = montar({ storage, opcoes: { perguntarAoRetomar: false } });
  video.dispatchEvent(new window.Event('loadedmetadata'));
  assert.equal(container.querySelector('.vsl-retomar')?.hidden ?? true, true);
  assert.equal(video.currentTime, 35);
});

test('pausa quando a aba some e volta a tocar quando ela reaparece', () => {
  const { video } = montar({});
  video.play();
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(video.paused, true);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(video.paused, false);
});

test('tempo oculto esconde o contador, e a barra respeita a trava de avanço', () => {
  const { container, video } = montar({ opcoes: { ocultarTempo: true, travarAvanco: true } });
  assert.equal(container.querySelector('.vsl-time').hidden, true);
  video.dispatchEvent(new window.Event('loadedmetadata'));
  video.currentTime = 20;
  video.dispatchEvent(new window.Event('timeupdate'));
  const barra = container.querySelector('.vsl-seek');
  barra.value = '90';
  barra.dispatchEvent(new window.Event('input'));
  assert.equal(video.currentTime, 20);
});

test('o player avisa a página que o embute: tempo e marcos', () => {
  const recebidas = [];
  const original = window.parent;
  Object.defineProperty(window, 'parent', { value: { postMessage: (dados, origem) => recebidas.push([dados, origem]) }, configurable: true });
  try {
    const { video } = montar({});
    video.dispatchEvent(new window.Event('loadedmetadata'));
    video.currentTime = 30;
    video.dispatchEvent(new window.Event('timeupdate'));
    assert.ok(recebidas.some(([dados]) => dados.tipo === 'tempo' && dados.segundos === 30));
    assert.ok(recebidas.some(([dados]) => dados.tipo === 'marco' && dados.valor === 25));
    assert.ok(recebidas.every(([, origem]) => origem === '*'));
  } finally {
    Object.defineProperty(window, 'parent', { value: original, configurable: true });
  }
});

test('endereço .m3u8 toca como HLS mesmo se a versão publicada disser MP4', () => {
  const { video } = montar({ sourceType: 'mp4', sourceUrl: 'https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8' });
  assert.equal(video.getAttribute('src'), null, 'o .m3u8 não vai direto para o <video>, que não toca HLS fora do Safari');
});
