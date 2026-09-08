import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapasDoQuiz, proximaEtapa, faltamRespostas, respostasDaEtapa, secoesSemAvanco } from '../public/quiz-mecanica.js';

// O quiz é a mesma landing page com uma regra por cima: cada seção é uma etapa, e só se
// avança pela seção atual. O editor, os elementos e o visual continuam sendo os da
// página — o que muda é quem decide o que está na tela.

const secao = (id, { campos = [], botao = true } = {}) => ({ id, campos, botao });

test('cada seção da página vira uma etapa, na ordem em que aparece', () => {
  const etapas = etapasDoQuiz([secao('abertura'), secao('perfil'), secao('oferta')]);
  assert.deepEqual(etapas.map((e) => e.id), ['abertura', 'perfil', 'oferta']);
  assert.equal(etapas[0].primeira, true);
  assert.equal(etapas.at(-1).ultima, true);
});

test('avançar caminha uma etapa por vez até o fim', () => {
  assert.equal(proximaEtapa(0, 3), 1);
  assert.equal(proximaEtapa(1, 3), 2);
  assert.equal(proximaEtapa(2, 3), null, 'depois da última vem o encerramento, não outra etapa');
});

test('a etapa com campo obrigatório vazio não deixa avançar', () => {
  const campos = [{ name: 'nome', required: true, value: '' }];
  assert.equal(faltamRespostas(campos), true);
  assert.equal(faltamRespostas([{ name: 'nome', required: true, value: 'Taian' }]), false);
});

test('campo opcional vazio não trava ninguém', () => {
  assert.equal(faltamRespostas([{ name: 'empresa', required: false, value: '' }]), false);
});

test('escolha obrigatória exige uma marcada, não só existir', () => {
  const nenhuma = [
    { name: 'perfil', type: 'radio', required: true, checked: false, value: 'A' },
    { name: 'perfil', type: 'radio', required: true, checked: false, value: 'B' },
  ];
  assert.equal(faltamRespostas(nenhuma), true);
  const uma = [...nenhuma];
  uma[1] = { ...uma[1], checked: true };
  assert.equal(faltamRespostas(uma), false);
});

test('as respostas saem com o nome do campo, para chegarem no lead', () => {
  const respostas = respostasDaEtapa([
    { name: 'nome', value: 'Taian' },
    { name: 'perfil', type: 'radio', checked: true, value: 'B' },
    { name: 'perfil', type: 'radio', checked: false, value: 'A' },
    { name: 'vazio', value: '' },
  ]);
  assert.deepEqual(respostas, { nome: 'Taian', perfil: 'B' });
});

test('marcação múltipla vira lista, não a última marcada', () => {
  const respostas = respostasDaEtapa([
    { name: 'temas', type: 'checkbox', checked: true, value: 'vendas' },
    { name: 'temas', type: 'checkbox', checked: true, value: 'trafego' },
    { name: 'temas', type: 'checkbox', checked: false, value: 'design' },
  ]);
  assert.deepEqual(respostas.temas, ['vendas', 'trafego']);
});

test('seção sem botão de avanço é apontada: sem ele o quiz para ali', () => {
  const problemas = secoesSemAvanco([secao('abertura'), secao('perfil', { botao: false }), secao('fim')]);
  assert.deepEqual(problemas, ['perfil']);
});

test('a última seção não precisa de botão de avanço, e sim de encerramento', () => {
  const problemas = secoesSemAvanco([secao('abertura'), secao('fim', { botao: false })], { ultimaEncerra: true });
  assert.deepEqual(problemas, [], 'a última fecha o quiz, não avança para outra');
});
