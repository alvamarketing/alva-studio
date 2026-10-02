import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConteudo, normalizeNode, renderNode, renderTree, PAGE_NODE_TYPES } from '../public/page-schema.js';

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
  // A seção guarda o conteúdo numa área central, e cada bloco numa caixa de layout.
  assert.equal(html, '<section class="alva-secao"><div class="alva-conteudo"><div class="alva-bloco"><h2 class="alva-titulo">Uma nova seção</h2></div><div class="alva-bloco"><p class="alva-texto">Conte sua história aqui.</p></div></div></section>');
});

test('o título respeita o nível escolhido, e recusa o que não é nível', () => {
  assert.equal(renderConteudo({ type: 'heading', props: { text: 'Olá', level: 1 } }), '<h1 class="alva-titulo">Olá</h1>');
  assert.equal(renderConteudo({ type: 'heading', props: { text: 'Olá', level: 9 } }), '<h2 class="alva-titulo">Olá</h2>');
});

test('o botão leva destino e abertura em nova aba', () => {
  assert.equal(
    renderConteudo({ type: 'button', props: { text: 'Quero saber mais ↗', href: 'https://alva.test/x', newTab: true } }),
    '<a href="https://alva.test/x" class="cta" target="_blank" rel="noopener noreferrer">Quero saber mais ↗</a>',
  );
});

// Como no Elementor: o bloco ocupa a linha inteira, e a pessoa escolhe largura,
// alinhamento e movimento de entrada. O que não for opção conhecida é ignorado.
test('cada bloco sai numa caixa com a largura, o alinhamento e o movimento escolhidos', () => {
  assert.equal(renderNode({ type: 'text', props: { text: 'x', largura: '1/2', alinhamento: 'centro', movimento: 'fade-up' } }),
    '<div class="alva-bloco alva-l-1-2 alva-a-centro" data-alva-motion="fade-up"><p class="alva-texto">x</p></div>');
  assert.equal(renderNode({ type: 'text', props: { text: 'x', largura: '7/8', alinhamento: 'torto', movimento: 'explodir' } }),
    '<div class="alva-bloco"><p class="alva-texto">x</p></div>');
});

test('botão com degradê e cor de texto próprios', () => {
  assert.match(renderConteudo({ type: 'button', props: { text: 'Ir', href: '#', corDoBotao: '#286EEA', corDoBotao2: '#5B8CFF', direcaoDoDegrade: 'horizontal', corDoTextoDoBotao: '#ffffff' } }),
    /style="background-image:linear-gradient\(90deg,#286EEA,#5B8CFF\);color:#ffffff"/);
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
  // A imagem precisa de endereço para existir (sem ele, some: imagem-sem-endereco.test.mjs).
  for (const type of PAGE_NODE_TYPES) {
    const html = renderNode({ type, props: type === 'image' ? { src: 'https://cdn.exemplo/a.png' } : {} });
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

// Regras de UX de 27/09 (docs/specs/2026-09-27-ux-do-editor.md).
test('Linha: os blocos dentro dela dividem o espaço em partes iguais', () => {
  const html = renderNode({ type: 'row', props: {}, children: [
    { type: 'icon', props: { name: 'star' } }, { type: 'icon', props: { name: 'bolt' } },
  ] });
  assert.match(html, /^<div class="alva-bloco"><div class="alva-linha"><div class="alva-bloco">.*<\/div><div class="alva-bloco">.*<\/div><\/div><\/div>$/);
});

test('Colunas por desenho: 2 iguais, 1/3+2/3, 2/3+1/3 e 3 iguais', () => {
  const classe = (estrutura) => renderConteudo({ type: 'columns', props: { estrutura }, children: [] }).match(/class="([^"]+)"/)[1];
  assert.equal(classe('1/2+1/2'), 'alva-colunas');
  assert.equal(classe('1/3+2/3'), 'alva-colunas alva-colunas-1-3-2-3');
  assert.equal(classe('2/3+1/3'), 'alva-colunas alva-colunas-2-3-1-3');
  assert.equal(classe('1/3x3'), 'alva-colunas alva-colunas-3');
  assert.equal(renderConteudo({ type: 'columns', props: { quantidade: 3 }, children: [] }).match(/class="([^"]+)"/)[1], 'alva-colunas alva-colunas-3', 'páginas salvas antes seguem valendo');
});

test('Seção: respiro, espaço entre blocos e alinhamento em escala', () => {
  const html = renderNode({ type: 'section', props: { respiro: 'g', espacamento: 'p', alinhamento: 'centro' }, children: [] });
  assert.equal(html, '<section class="alva-secao alva-respiro-g"><div class="alva-conteudo alva-espaco-p alva-conteudo-centro"></div></section>');
});

test('Avançado: largura, movimento e margem do bloco moram em "avancado"', () => {
  assert.equal(renderNode({ type: 'text', props: { text: 'x', avancado: { largura: '1/3', movimento: 'zoom-in', espacoAcima: 'g', espacoAbaixo: 'p' } } }),
    '<div class="alva-bloco alva-l-1-3 alva-m-topo-g alva-m-base-p" data-alva-motion="zoom-in"><p class="alva-texto">x</p></div>');
});
