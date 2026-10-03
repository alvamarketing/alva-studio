// A âncora da seção: o botão com "#contato" precisa de uma seção que se chame "contato".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarAncora, renderNode } from '../public/page-schema.js';
import { documentoDaPagina, normalizarEstadoAlva, paginaInicial } from '../public/pagina-alva.js';
import { secoesProntas } from '../public/secoes-prontas.js';
import { ancorasDaPagina, quantasVezesAAncoraAparece } from '../editor/ancoras.js';
import { alvaParaPuck } from '../public/puck-conversao.js';

test('o nome da âncora vira minúsculas, sem acento, com hífen no lugar do espaço', () => {
  assert.equal(normalizarAncora('Fale Conosco!'), 'fale-conosco');
  assert.equal(normalizarAncora('  Ação   rápida  '), 'acao-rapida');
  assert.equal(normalizarAncora('#contato'), 'contato');
  assert.equal(normalizarAncora('preço_e_planos'), 'preco-e-planos');
  assert.equal(normalizarAncora('---'), '');
  assert.equal(normalizarAncora(undefined), '');
});

test('a âncora tem no máximo 40 caracteres e não termina em hífen', () => {
  const longa = normalizarAncora('uma âncora muito comprida que passa de quarenta caracteres');
  assert.ok(longa.length <= 40);
  assert.doesNotMatch(longa, /-$/);
  // Digitando, o hífen do fim fica: é o espaço antes da próxima palavra.
  assert.equal(normalizarAncora('fale ', { digitando: true }), 'fale-');
});

test('a seção publicada leva o id da âncora; sem âncora, nada muda', () => {
  assert.match(renderNode({ id: 's1', type: 'section', props: { ancora: 'Contato' }, children: [] }), /<section class="alva-secao" id="contato"/);
  assert.doesNotMatch(renderNode({ id: 's1', type: 'section', props: {}, children: [] }), / id=/);
  const hostil = renderNode({ id: 's1', type: 'section', props: { ancora: '"><script>alert(1)</script>' }, children: [] });
  assert.doesNotMatch(hostil, /<script/);
});

test('a página rola suave até a âncora, sem esconder o começo da seção', () => {
  const html = documentoDaPagina(normalizarEstadoAlva(paginaInicial('Oferta')));
  assert.match(html, /scroll-behavior:smooth/);
  assert.match(html, /prefers-reduced-motion:no-preference/);
  assert.match(html, /scroll-margin-top:16px/);
});

test('a landing nova e a seção pronta de contato já respondem ao #contato do botão', () => {
  const html = documentoDaPagina(normalizarEstadoAlva(paginaInicial('Oferta')));
  assert.match(html, /href="#contato"/);
  assert.match(html, /<section class="[^"]*" id="contato"/);
  assert.equal(secoesProntas.find((secao) => secao.id === 'secao-contato').props.ancora, 'contato');
});

test('normalizar de novo não muda a âncora', () => {
  const estado = normalizarEstadoAlva({ formato: 'alva/1', root: { title: '' }, content: [{ type: 'section', props: { ancora: 'Fale Conosco' }, children: [] }] });
  assert.equal(estado.content[0].props.ancora, 'fale-conosco');
  assert.deepEqual(normalizarEstadoAlva(estado), estado);
});

test('o editor lista as âncoras da página e sabe quando uma se repete', () => {
  const dados = alvaParaPuck(normalizarEstadoAlva({ formato: 'alva/1', root: { title: '' }, content: [
    { id: 'a', type: 'section', props: { ancora: 'contato' }, children: [] },
    { id: 'b', type: 'section', props: { ancora: 'planos' }, children: [] },
    { id: 'c', type: 'section', props: { ancora: 'contato' }, children: [] },
    { id: 'd', type: 'section', props: {}, children: [] },
  ] }));
  assert.deepEqual(ancorasDaPagina(dados), ['contato', 'planos']);
  assert.equal(quantasVezesAAncoraAparece(dados, 'contato'), 2);
  assert.equal(quantasVezesAAncoraAparece(dados, 'planos'), 1);
});
