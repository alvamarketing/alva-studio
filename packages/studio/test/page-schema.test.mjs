import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode, renderNode, renderTree, PAGE_NODE_TYPES } from '../public/page-schema.js';

// O esquema é a fonte da verdade e o HTML passa a ser derivado dele no servidor. Isso
// muda o peso de duas coisas: o que sai precisa ser idêntico ao que o editor produzia
// (senão o visual muda sozinho), e escapar deixa de ser detalhe e vira fronteira — é o
// servidor quem monta o que o público vê.

test('uma seção com filhos sai igual ao que o editor produzia', () => {
  const html = renderNode({
    type: 'section',
    children: [
      { type: 'heading', props: { text: 'Uma nova seção' } },
      { type: 'text', props: { text: 'Conte sua história aqui.' } },
    ],
  });
  assert.equal(html, '<section class="alva-secao"><h2 class="alva-titulo">Uma nova seção</h2><p class="alva-texto">Conte sua história aqui.</p></section>');
});

test('o título respeita o nível escolhido, e recusa o que não é nível', () => {
  assert.equal(renderNode({ type: 'heading', props: { text: 'Olá', level: 1 } }), '<h1 class="alva-titulo">Olá</h1>');
  assert.equal(renderNode({ type: 'heading', props: { text: 'Olá', level: 9 } }), '<h2 class="alva-titulo">Olá</h2>');
});

test('o botão leva destino e abertura em nova aba', () => {
  assert.equal(
    renderNode({ type: 'button', props: { text: 'Quero saber mais ↗', href: 'https://alva.test/x', newTab: true } }),
    '<a href="https://alva.test/x" class="cta" target="_blank" rel="noopener noreferrer">Quero saber mais ↗</a>',
  );
});

// O servidor renderiza; portanto o servidor é quem impede que um texto vire marcação.
test('texto nunca vira marcação, em nenhuma propriedade', () => {
  const html = renderNode({ type: 'text', props: { text: '<script>roubar()</script> & "aspas"' } });
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; &quot;aspas&quot;/);
});

test('endereço de link só aceita esquema de navegação', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
    const html = renderNode({ type: 'button', props: { text: 'Ir', href } });
    assert.equal(html.includes(href), false, `${href} não pode chegar ao HTML`);
    assert.match(html, /href="#"/, 'o botão continua existindo, sem destino perigoso');
  }
  assert.match(renderNode({ type: 'button', props: { text: 'Ir', href: '#contato' } }), /href="#contato"/);
  assert.match(renderNode({ type: 'button', props: { text: 'Ir', href: 'mailto:a@b.test' } }), /href="mailto:a@b.test"/);
});

test('tipo desconhecido é recusado, não ignorado em silêncio', () => {
  assert.throws(() => normalizeNode({ type: 'trojan' }), /tipo de elemento/i);
  assert.throws(() => renderNode({ type: 'trojan' }), /tipo de elemento/i);
});

test('todo tipo declarado sabe se desenhar', () => {
  for (const type of PAGE_NODE_TYPES) {
    const html = renderNode({ type, props: {} });
    assert.equal(typeof html, 'string', `${type} não devolveu HTML`);
    assert.ok(html.length > 0, `${type} devolveu vazio`);
  }
});

// Uma árvore funda ou enorme não pode travar o servidor que a desenha.
test('árvore funda demais é recusada antes de desenhar', () => {
  let node = { type: 'text', props: { text: 'fim' } };
  for (let i = 0; i < 60; i += 1) node = { type: 'section', children: [node] };
  assert.throws(() => renderNode(node), /profunda/i);
});

test('a mesma árvore desenha sempre igual', () => {
  const arvore = [{ type: 'section', children: [{ type: 'heading', props: { text: 'A' } }] }];
  assert.equal(renderTree(arvore), renderTree(arvore));
});

test('a árvore vazia desenha vazio, sem explodir', () => {
  assert.equal(renderTree([]), '');
  assert.equal(renderTree(undefined), '');
});

// Um campo de captura é um nó do Alva, não um <input> a ser descoberto dentro de HTML.
test('o campo carrega o que a captura precisa saber', () => {
  const node = normalizeNode({ type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true } });
  assert.equal(node.props.fieldType, 'email');
  assert.equal(node.props.required, true);
  assert.match(renderNode(node), /type="email"[^>]*required|required[^>]*type="email"/);
});

test('campo com tipo que a captura não aceita é recusado na origem', () => {
  assert.throws(() => normalizeNode({ type: 'field', props: { label: 'X', name: 'x', fieldType: 'password' } }), /tipo de resposta/i);
});
