import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correspondenciaModel } from '../public/studio-dashboard.js';

test('sem conversão nenhuma, a tela convida a publicar em vez de mostrar zero', () => {
  const model = correspondenciaModel({ eventos: 0, media: null, nivel: null, faltando: [] });
  assert.equal(model.phase, 'empty');
  assert.match(model.message, /ainda/i, 'a mensagem precisa dizer que ainda não houve conversão');
  // Um "0%" aqui seria lido como correspondência ruim, quando o que existe é ausência de
  // dado. O travessão diz "não há o que medir".
  assert.equal(model.valor, '—');
  assert.equal(model.rotulo, '');
});

test('a nota aparece como percentual e o nível vira palavra', () => {
  const model = correspondenciaModel({ eventos: 12, media: 78, nivel: 'boa', faltando: [] });
  assert.equal(model.phase, 'ready');
  assert.equal(model.valor, '78%');
  assert.equal(model.rotulo, 'Boa');
  assert.match(model.detalhe, /12 conversões/);
});

test('uma conversão só não vira "1 conversões"', () => {
  assert.match(correspondenciaModel({ eventos: 1, media: 50, nivel: 'parcial', faltando: [] }).detalhe, /1 conversão\b/);
});

// A lista existe para alguém agir. Ordem por quantos eventos, e o que fazer junto.
test('o que falta vem com quantos eventos atinge e o que fazer', () => {
  const model = correspondenciaModel({
    eventos: 10, media: 40, nivel: 'parcial',
    faltando: [
      { chave: 'email', sinal: 'E-mail da pessoa', eventos: 8, peso: 25, oQueFazer: 'Acrescente o campo de e-mail no formulário desta página.' },
      { chave: 'navegador', sinal: 'Identificador do navegador', eventos: 3, peso: 12, oQueFazer: 'Confira se o pixel está ativo na página publicada.' },
    ],
  });
  assert.deepEqual(model.faltando.map((item) => item.sinal), ['E-mail da pessoa', 'Identificador do navegador']);
  assert.equal(model.faltando[0].alcance, '8 de 10 conversões');
  assert.equal(model.faltando[1].alcance, '3 de 10 conversões');
  assert.equal(model.faltando[0].oQueFazer, 'Acrescente o campo de e-mail no formulário desta página.');
});

test('nada faltando é dito em palavras, não com uma lista vazia', () => {
  const model = correspondenciaModel({ eventos: 5, media: 100, nivel: 'boa', faltando: [] });
  assert.deepEqual(model.faltando, []);
  assert.match(model.message, /nenhum sinal/i);
});

// Chamar de "nota da Meta" seria dar como medido o que é estimado aqui.
test('a tela não se apresenta como a nota da plataforma', () => {
  const model = correspondenciaModel({ eventos: 3, media: 60, nivel: 'parcial', faltando: [] });
  assert.doesNotMatch(JSON.stringify(model), /nota da Meta|Event Match Quality|EMQ/i);
});
