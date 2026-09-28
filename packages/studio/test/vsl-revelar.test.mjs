import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FORMATO_ALVA, documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';

const estado = normalizarEstadoAlva({
  formato: FORMATO_ALVA, root: { title: 'P' },
  content: [
    { id: 's1', type: 'section', props: {}, children: [{ id: 'v1', type: 'vsl', props: { publicId: 'abcdefghijklmnop' } }] },
    { id: 's2', type: 'section', props: { revelarNoSegundo: 30 }, children: [{ id: 't1', type: 'text', props: { text: 'Oferta' } }] },
  ],
});

test('seção com "revelar no segundo" sai marcada e escondida até o vídeo chegar lá', () => {
  const html = documentoDaPagina(estado, { publicOrigin: 'https://studio.example.test' });
  assert.match(html, /<section[^>]*data-alva-revelar="30"/);
  assert.match(html, /\[data-alva-revelar\]:not\(\.alva-revelada\)\{display:none/);
  assert.match(html, /<script nonce="__ALVA_RUNTIME_NONCE__">/);
});

test('página sem seção a revelar nem VSL não leva o script', () => {
  const simples = normalizarEstadoAlva({ formato: FORMATO_ALVA, root: { title: 'P' }, content: [{ id: 's1', type: 'section', props: {}, children: [] }] });
  assert.doesNotMatch(documentoDaPagina(simples), /<script/);
});

test('o tempo que chega do player da VSL revela a seção; mensagem de outra janela não', async () => {
  const html = documentoDaPagina(estado, { publicOrigin: 'https://studio.example.test', previa: true }).replaceAll('__ALVA_RUNTIME_NONCE__', 'n');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://cliente.example.test/oferta' });
  const { window } = dom;
  const secao = window.document.querySelector('[data-alva-revelar]');
  const quadro = window.document.querySelector('iframe.alva-vsl-frame');
  const enviar = (source, data) => window.dispatchEvent(new window.MessageEvent('message', { source, data }));
  enviar(window, { alvaVsl: 1, tipo: 'tempo', segundos: 40 });
  assert.equal(secao.classList.contains('alva-revelada'), false);
  enviar(quadro.contentWindow, { alvaVsl: 1, tipo: 'tempo', segundos: 29 });
  assert.equal(secao.classList.contains('alva-revelada'), false);
  enviar(quadro.contentWindow, { alvaVsl: 1, tipo: 'tempo', segundos: 30 });
  assert.equal(secao.classList.contains('alva-revelada'), true);
  const eventos = [];
  window.addEventListener('alva:vsl', (evento) => eventos.push(JSON.parse(JSON.stringify(evento.detail))));
  enviar(quadro.contentWindow, { alvaVsl: 1, tipo: 'marco', publicId: 'abcdefghijklmnop', valor: 25 });
  assert.deepEqual(eventos, [{ tipo: 'marco', publicId: 'abcdefghijklmnop', valor: 25 }]);
  window.close();
});

test('quem volta à página já vê as seções que o vídeo revelou antes', () => {
  const html = documentoDaPagina(estado, { publicOrigin: 'https://studio.example.test', previa: true }).replaceAll('__ALVA_RUNTIME_NONCE__', 'n');
  const primeira = new JSDOM(html, { runScripts: 'dangerously', url: 'https://cliente.example.test/oferta' });
  const quadro = primeira.window.document.querySelector('iframe.alva-vsl-frame');
  primeira.window.dispatchEvent(new primeira.window.MessageEvent('message', { source: quadro.contentWindow, data: { alvaVsl: 1, tipo: 'tempo', segundos: 31 } }));
  const guardado = primeira.window.localStorage.getItem('alva-vsl-revelado:/oferta');
  assert.equal(guardado, '31');
  primeira.window.close();
});
