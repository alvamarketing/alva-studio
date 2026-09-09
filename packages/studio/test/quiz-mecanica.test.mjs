import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapasDoQuiz, proximaEtapa, faltamRespostas, respostasDaEtapa, secoesSemAvanco, conteudoDaLista, textosDaLista, contagemDaLista } from '../public/quiz-mecanica.js';

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

// A lista de Quizzes e a de Páginas são a mesma tela. O que decide o que aparece — e como
// a tela se chama — é a marca, e é isso que estas funções resolvem antes de qualquer DOM.

test('a lista separa por marca, sem misturar quiz com landing page', () => {
  const tudo = [
    { id: 'a', name: 'LP', kind: 'page' },
    { id: 'b', name: 'Diagnóstico', kind: 'quiz' },
    { id: 'c', name: 'Antiga' },
  ];
  assert.deepEqual(conteudoDaLista(tudo, 'page').map((p) => p.id), ['a', 'c']);
  assert.deepEqual(conteudoDaLista(tudo, 'quiz').map((p) => p.id), ['b']);
});

test('quem foi criada antes da marca continua sendo página', () => {
  assert.deepEqual(conteudoDaLista([{ id: 'antiga' }], 'page').map((p) => p.id), ['antiga']);
});

test('os textos da tela mudam com a marca, para ninguém achar que errou de menu', () => {
  const pagina = textosDaLista('page');
  const quiz = textosDaLista('quiz');
  assert.equal(pagina.singular, 'página');
  assert.equal(quiz.singular, 'quiz');
  assert.equal(quiz.plural, 'quizzes');
  assert.match(quiz.vazio, /quiz/i);
  assert.notEqual(pagina.vazio, quiz.vazio);
});

test('a contagem sai pronta, no plural certo', () => {
  assert.equal(contagemDaLista(1, 'quiz'), '1 quiz');
  assert.equal(contagemDaLista(3, 'quiz'), '3 quizzes');
  assert.equal(contagemDaLista(1, 'page'), '1 página');
  assert.equal(contagemDaLista(2, 'page'), '2 páginas');
});

test('o cabeçalho inteiro troca junto, não só o miolo da lista', () => {
  const pagina = textosDaLista('page');
  const quiz = textosDaLista('quiz');
  for (const campo of ['eyebrow', 'titulo', 'descricao', 'botao', 'busca']) {
    assert.notEqual(quiz[campo], pagina[campo], `${campo} deveria mudar entre página e quiz`);
    assert.ok(quiz[campo], `${campo} do quiz não pode ficar vazio`);
  }
  assert.match(quiz.titulo, /quiz/i);
});

// Dentro do editor não há pista de qual lista a pessoa veio. Sem isso, o botão de voltar
// promete "minhas páginas" e devolve para os quizzes.
test('o editor se apresenta pela marca do que está aberto', () => {
  const pagina = textosDaLista('page');
  const quiz = textosDaLista('quiz');
  assert.equal(pagina.contexto, 'Landing');
  assert.equal(quiz.contexto, 'Quiz');
  assert.equal(quiz.voltar, 'Meus quizzes');
  assert.equal(pagina.voltar, 'Minhas páginas');
  assert.equal(quiz.nomeDoConteudo, 'Nome do quiz');
  assert.equal(pagina.nomeDoConteudo, 'Nome da página');
});

test('o diálogo de criação também fala a língua da lista', () => {
  assert.match(textosDaLista('quiz').criar, /quiz/i);
  assert.match(textosDaLista('page').criar, /página/i);
  assert.notEqual(textosDaLista('quiz').comecar, textosDaLista('page').comecar);
});

test('o rodapé da lista também fala do que está na tela', () => {
  assert.notEqual(textosDaLista('quiz').rodape, textosDaLista('page').rodape);
  assert.match(textosDaLista('quiz').rodape, /quiz|etapa|pergunta/i);
});
