// Os dados da página (raiz): descrição, imagem de compartilhamento, ícone da aba e "não
// aparecer no Google" — e o <head> que a página publicada e a prévia ganham com eles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';

const STUDIO = 'https://studio.example.test';
const estado = (root) => normalizarEstadoAlva({ formato: 'alva/1', root: { title: 'Oferta "especial"', ...root }, content: [] });
const cabeca = (root, opcoes = { publicOrigin: STUDIO }) => documentoDaPagina(estado(root), opcoes).split('</head>')[0];

test('página antiga, só com título, continua igual', () => {
  assert.deepEqual(estado({}).root, { title: 'Oferta "especial"' });
  const html = cabeca({});
  assert.doesNotMatch(html, /name="description"|og:image|rel="icon"|name="robots"/);
  assert.match(html, /<meta property="og:title" content="Oferta &quot;especial&quot;">/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
});

test('descrição vai para o Google e para o compartilhamento, até 160 caracteres, escapada', () => {
  const longa = 'Uma descrição <com> "aspas" e quebra\nde linha '.padEnd(200, 'x');
  const limpo = estado({ descricao: longa }).root;
  assert.equal(limpo.descricao.length, 160);
  assert.doesNotMatch(limpo.descricao, /\n/);
  const html = cabeca({ descricao: 'Curso de <b>vendas</b> "ao vivo"' });
  assert.match(html, /<meta name="description" content="Curso de &lt;b&gt;vendas&lt;\/b&gt; &quot;ao vivo&quot;">/);
  assert.match(html, /<meta property="og:description" content="Curso de &lt;b&gt;vendas/);
});

test('imagem de compartilhamento do Studio vira endereço absoluto; vazia, a tag some', () => {
  const html = cabeca({ imagemDeCompartilhamento: '/i/11111111-1111-4111-8111-111111111111' });
  assert.match(html, /<meta property="og:image" content="https:\/\/studio.example.test\/i\/11111111-1111-4111-8111-111111111111">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(cabeca({ imagemDeCompartilhamento: 'https://cdn.exemplo.test/capa.png' }), /og:image" content="https:\/\/cdn.exemplo.test\/capa.png"/);
  assert.doesNotMatch(cabeca({ imagemDeCompartilhamento: '' }), /og:image/);
  // Sem origem conhecida, um caminho relativo não serve a quem compartilha: some.
  assert.doesNotMatch(cabeca({ imagemDeCompartilhamento: '/i/abc' }, {}), /og:image/);
  assert.equal(estado({ imagemDeCompartilhamento: 'javascript:alert(1)' }).root.imagemDeCompartilhamento, undefined);
});

test('ícone da aba e "não aparecer no Google"', () => {
  assert.match(cabeca({ icone: '/i/22222222-2222-4222-8222-222222222222' }), /<link rel="icon" href="https:\/\/studio.example.test\/i\/22222222-2222-4222-8222-222222222222">/);
  assert.match(cabeca({ naoIndexar: true }), /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(cabeca({ naoIndexar: false }), /robots/);
  assert.equal(estado({ naoIndexar: 'sim' }).root.naoIndexar, undefined);
});

test('a prévia leva o mesmo <head>', () => {
  const html = documentoDaPagina(estado({ descricao: 'Prévia', naoIndexar: true }), { publicOrigin: STUDIO, previa: true });
  assert.match(html, /<meta name="description" content="Prévia">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('os dados da página atravessam o editor (Puck) sem se perder, e normalizar de novo não muda', () => {
  const salvo = estado({ descricao: 'Desc', imagemDeCompartilhamento: 'https://cdn.exemplo.test/capa.png', icone: 'https://cdn.exemplo.test/ico.png', naoIndexar: true });
  assert.deepEqual(normalizarEstadoAlva(puckParaAlva(alvaParaPuck(salvo))), salvo);
  assert.deepEqual(normalizarEstadoAlva(salvo), salvo);
  const vazio = puckParaAlva({ root: { props: { title: 'X', descricao: '', imagemDeCompartilhamento: '', icone: '', naoIndexar: false, itens: [] } }, content: [] });
  assert.deepEqual(vazio.root, { title: 'X' });
});
