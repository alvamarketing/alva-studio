import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPCOES_PADRAO, normalizarOpcoesDaVsl } from '../public/vsl-opcoes.js';

test('opções da VSL vazias ficam no padrão: som inteligente, retomar perguntando, pausar fora da aba', () => {
  assert.deepEqual(normalizarOpcoesDaVsl(undefined), OPCOES_PADRAO);
  assert.equal(OPCOES_PADRAO.somInteligente, true);
  assert.equal(OPCOES_PADRAO.perguntarAoRetomar, true);
  assert.equal(OPCOES_PADRAO.pausarForaDaAba, true);
  assert.equal(OPCOES_PADRAO.travarAvanco, false);
  assert.equal(OPCOES_PADRAO.ocultarTempo, false);
});

test('opções da VSL guardam só o que conhece e no formato certo', () => {
  const opcoes = normalizarOpcoesDaVsl({
    somInteligente: false, textoDoSom: '  Seu vídeo já começou  ', ctaCor: '#FF0000', ctaCorDoTexto: '#000000',
    ctaSubtexto: 'Vagas limitadas', travarAvanco: true, ocultarTempo: true, qualquer: 'coisa',
  });
  assert.equal(opcoes.somInteligente, false);
  assert.equal(opcoes.textoDoSom, 'Seu vídeo já começou');
  assert.equal(opcoes.ctaCor, '#ff0000');
  assert.equal(opcoes.ctaCorDoTexto, '#000000');
  assert.equal(opcoes.ctaSubtexto, 'Vagas limitadas');
  assert.equal(opcoes.travarAvanco, true);
  assert.equal(opcoes.ocultarTempo, true);
  assert.equal('qualquer' in opcoes, false);
});

test('opções da VSL recusam cor inválida e texto longo demais', () => {
  assert.throws(() => normalizarOpcoesDaVsl({ ctaCor: 'red' }), /cor/i);
  assert.throws(() => normalizarOpcoesDaVsl({ textoDoSom: 'x'.repeat(81) }), /som/i);
  assert.throws(() => normalizarOpcoesDaVsl({ ctaSubtexto: 'x'.repeat(121) }), /CTA/i);
  // Texto do som vazio volta ao padrão: sem ele o aviso não diz nada.
  assert.equal(normalizarOpcoesDaVsl({ textoDoSom: '   ' }).textoDoSom, OPCOES_PADRAO.textoDoSom);
  // Cor do CTA vazia quer dizer "a cor da VSL".
  assert.equal(normalizarOpcoesDaVsl({ ctaCor: '' }).ctaCor, '');
});
