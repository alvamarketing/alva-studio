import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { criarEscolhaPesquisavel, rotuloDaOpcao } from '../public/escolha-pesquisavel.js';

const CONTAS = [
  { id: '111', nome: 'Academia Eliana Giaretta' },
  { id: '222', nome: 'CA - Alva Marketing' },
  { id: '746361326269461', nome: '746361326269461' },
  { id: '333', nome: 'Clínica São José' },
];

function montar(extra = {}) {
  const janela = new JSDOM('<div id="alvo"></div>').window;
  const doc = janela.document;
  const mudancas = [];
  const caixa = criarEscolhaPesquisavel(doc, { nome: 'conta', rotulo: 'Conta de anúncios', opcoes: CONTAS, valor: '', vazio: 'Escolha a conta', aoMudar: (valor) => mudancas.push(valor), ...extra });
  doc.querySelector('#alvo').append(caixa);
  const tecla = (alvo, key) => alvo.dispatchEvent(new janela.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const digitar = (texto) => { const busca = caixa.querySelector('.escolha-busca'); busca.value = texto; busca.dispatchEvent(new janela.Event('input', { bubbles: true })); };
  const abrir = () => caixa.querySelector('.escolha-botao').click();
  const opcoes = () => [...caixa.querySelectorAll('[role="option"]')].map((item) => item.dataset.valor);
  return { janela, doc, caixa, mudancas, tecla, digitar, abrir, opcoes };
}

test('fechada: mostra o texto de vazio e não deixa o painel visível', () => {
  const { caixa } = montar();
  assert.equal(caixa.querySelector('.escolha-botao').textContent.trim().startsWith('Escolha a conta'), true);
  assert.equal(caixa.querySelector('.escolha-painel').hidden, true);
  assert.equal(caixa.querySelector('.escolha-botao').getAttribute('aria-expanded'), 'false');
});

test('abrir lista todas as opções; escolher fecha, mostra o nome e avisa uma vez', () => {
  const { caixa, mudancas, abrir, opcoes } = montar();
  abrir();
  assert.equal(caixa.querySelector('.escolha-botao').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(opcoes(), ['111', '222', '746361326269461', '333']);
  caixa.querySelector('[data-valor="222"]').click();
  assert.deepEqual(mudancas, ['222']);
  assert.equal(caixa.value, '222');
  assert.equal(caixa.querySelector('.escolha-painel').hidden, true);
  assert.match(caixa.querySelector('.escolha-botao').textContent, /CA - Alva Marketing/);
});

test('escolher o que já estava escolhido não avisa de novo', () => {
  const { caixa, mudancas, abrir } = montar({ valor: '111' });
  abrir();
  caixa.querySelector('[data-valor="111"]').click();
  assert.deepEqual(mudancas, []);
});

test('a busca acha por nome ou por número, sem ligar para acento nem maiúscula', () => {
  const { digitar, abrir, opcoes, caixa } = montar();
  abrir();
  digitar('clinica sao');
  assert.deepEqual(opcoes(), ['333']);
  digitar('ALVA');
  assert.deepEqual(opcoes(), ['222']);
  digitar('7463');
  assert.deepEqual(opcoes(), ['746361326269461']);
  digitar('nada disso');
  assert.deepEqual(opcoes(), []);
  assert.match(caixa.querySelector('.escolha-vazio').textContent, /Nada encontrado/);
});

test('teclado: setas movem o destaque, Enter escolhe, Esc fecha sem escolher', () => {
  const { caixa, mudancas, tecla, abrir } = montar();
  const busca = () => caixa.querySelector('.escolha-busca');
  abrir();
  tecla(busca(), 'ArrowDown');
  tecla(busca(), 'ArrowDown');
  assert.equal(caixa.querySelector('.destaque').dataset.valor, '746361326269461');
  tecla(busca(), 'Enter');
  assert.deepEqual(mudancas, ['746361326269461']);
  abrir();
  tecla(busca(), 'Escape');
  assert.equal(caixa.querySelector('.escolha-painel').hidden, true);
  assert.deepEqual(mudancas, ['746361326269461']);
});

test('seta para baixo no botão abre o painel', () => {
  const { caixa, tecla } = montar();
  tecla(caixa.querySelector('.escolha-botao'), 'ArrowDown');
  assert.equal(caixa.querySelector('.escolha-painel').hidden, false);
});

test('clicar fora fecha', () => {
  const { caixa, doc, janela, abrir } = montar();
  abrir();
  doc.body.dispatchEvent(new janela.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(caixa.querySelector('.escolha-painel').hidden, true);
});

test('desligada não abre', () => {
  const { caixa, abrir } = montar({ desligado: true });
  abrir();
  assert.equal(caixa.querySelector('.escolha-botao').disabled, true);
  assert.equal(caixa.querySelector('.escolha-painel').hidden, true);
});

test('conta sem nome (o nome é o próprio número) mostra o número uma vez só', () => {
  assert.deepEqual(rotuloDaOpcao({ id: '746361326269461', nome: '746361326269461' }), { titulo: '746361326269461', detalhe: '' });
  assert.deepEqual(rotuloDaOpcao({ id: '9', nome: '' }), { titulo: '9', detalhe: '' });
  assert.deepEqual(rotuloDaOpcao({ id: '9', nome: 'Loja' }), { titulo: 'Loja', detalhe: '9' });
  const { caixa, abrir } = montar();
  abrir();
  assert.doesNotMatch(caixa.querySelector('[data-valor="746361326269461"]').textContent, /746361326269461.*746361326269461/);
});

test('acessibilidade: listbox, opções com aria-selected e rótulo no botão', () => {
  const { caixa, abrir } = montar({ valor: '222' });
  abrir();
  assert.equal(caixa.querySelector('[role="listbox"]') !== null, true);
  assert.equal(caixa.querySelector('[data-valor="222"]').getAttribute('aria-selected'), 'true');
  assert.equal(caixa.querySelector('[data-valor="111"]').getAttribute('aria-selected'), 'false');
  assert.equal(caixa.querySelector('.escolha-botao').getAttribute('aria-label'), 'Conta de anúncios');
});

test('só tokens: nada de cor, sombra ou raio literal no módulo e no CSS da caixa', async () => {
  const fonte = await readFile(new URL('../public/escolha-pesquisavel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /#[0-9a-f]{3,8}\b|rgba?\(|\.style\.|font-weight|style=/i);
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const bloco = css.slice(css.indexOf('/* Caixa de escolha com busca'), css.indexOf('.conta-meta-escolha .provider-actions'));
  assert.ok(bloco.length > 200);
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b|rgba?\(|font-weight|font-family/i);
  for (const sombra of bloco.match(/box-shadow:[^;]+/g) ?? []) assert.match(sombra, /var\(--(?:ring|shadow)-/);
  for (const raio of bloco.match(/border-radius:[^;]+/g) ?? []) assert.match(raio, /var\(--radius-/);
});
