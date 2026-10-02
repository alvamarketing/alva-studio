// A imagem sem endereço. No editor ela vira um lugar visível para escolher a imagem; na
// página publicada ela some por inteiro: `<img src="#">` não tem tamanho, e a caixa vazia
// em volta empurrava o resto com as margens dela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoDaImagem, renderNode, renderTree } from '../public/page-schema.js';
import { documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';

const imagem = (src) => ({ id: 'img-1', type: 'image', props: { src, alt: 'Foto' }, children: [] });

test('endereço de imagem: só o que um <img> consegue carregar', () => {
  assert.equal(enderecoDaImagem('https://cdn.exemplo/a.png'), 'https://cdn.exemplo/a.png');
  assert.equal(enderecoDaImagem('  /i/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e '), '/i/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e');
  for (const ruim of ['', '   ', undefined, null, '#', '#topo', 'mailto:a@b.c', 'tel:11999', 'javascript:alert(1)', 'imagem.png']) {
    assert.equal(enderecoDaImagem(ruim), '', `“${ruim}” não é endereço de imagem`);
  }
});

test('imagem com endereço é publicada como antes', () => {
  assert.match(renderNode(imagem('https://cdn.exemplo/a.png')), /<img class="alva-imagem" src="https:\/\/cdn\.exemplo\/a\.png" alt="Foto">/);
});

test('imagem sem endereço não vai para a página publicada, nem a caixa dela', () => {
  for (const src of ['', '#', 'mailto:x@y.z', undefined]) {
    assert.equal(renderNode(imagem(src)), '');
  }
  const html = renderTree([{ type: 'section', props: {}, children: [imagem(''), { type: 'text', props: { text: 'Depois' }, children: [] }] }]);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /src="#"/);
  assert.match(html, /Depois/);
});

test('o documento publicado e a prévia não têm a imagem vazia', () => {
  const estado = normalizarEstadoAlva({ formato: 'alva/1', root: { title: 'T' }, content: [{ type: 'section', props: {}, children: [imagem('')] }] });
  for (const previa of [false, true]) assert.doesNotMatch(documentoDaPagina(estado, { previa }), /<img/);
});
