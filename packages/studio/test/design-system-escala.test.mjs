import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// O sistema visual só parece um sistema se as peças repetirem os mesmos degraus.
// Raio, elevação e foco inventados caso a caso são o que faz a tela parecer
// montada por partes, mesmo quando cada parte isolada está bonita.

const ARQUIVOS = ['styles.css', 'editor-shell.css', 'forms.css', 'owner.css'];

const lerTodos = async () => Object.fromEntries(await Promise.all(
  ARQUIVOS.map(async (nome) => [nome, await readFile(new URL(`../public/${nome}`, import.meta.url), 'utf8')]),
));

const declaracoes = (css, propriedade) => [...css.matchAll(new RegExp(`${propriedade}:([^;}]+)`, 'g'))].map((m) => m[1].trim());

test('nenhuma folha inventa raio próprio: todo canto vem da escala', async () => {
  const arquivos = await lerTodos();
  const foraDaEscala = [];
  for (const [nome, css] of Object.entries(arquivos)) {
    for (const valor of declaracoes(css, 'border-radius')) {
      // 50% é círculo, não um degrau da escala; 0 é a ausência de canto
      if (/var\(--radius/.test(valor) || valor === '0' || valor === 'inherit' || valor === '50%') continue;
      foraDaEscala.push(`${nome}: border-radius: ${valor}`);
    }
  }
  assert.deepEqual(foraDaEscala, [], 'raio fixo em px é degrau novo que ninguém combinou');
});

test('a escala de raio é curta o bastante para ser reconhecível', async () => {
  const { 'styles.css': css } = await lerTodos();
  const raiz = css.match(/^:root \{[^}]*\}/m)[0];
  const degraus = [...raiz.matchAll(/--radius-([a-z]+):/g)].map((m) => m[1]);
  assert.ok(degraus.length <= 6, `${degraus.length} degraus de raio: escala longa demais para alguém decorar`);
  assert.ok(degraus.length >= 3, 'sem degraus não há escala');
});

test('elevação tem degraus de verdade, não o mesmo valor com dois nomes', async () => {
  const { 'styles.css': css } = await lerTodos();
  const raiz = css.match(/^:root \{[^}]*\}/m)[0];
  const sombras = Object.fromEntries([...raiz.matchAll(/--shadow-([a-z]+): *([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const valores = Object.values(sombras).filter((valor) => valor !== 'none');
  assert.equal(new Set(valores).size, valores.length, `dois nomes para a mesma sombra não são dois níveis: ${JSON.stringify(sombras)}`);
  assert.ok(Object.keys(sombras).length >= 3, 'sem três níveis não dá para dizer o que está por cima do quê');
});

test('nenhuma folha inventa sombra própria: toda elevação vem da escala', async () => {
  const arquivos = await lerTodos();
  const foraDaEscala = [];
  for (const [nome, css] of Object.entries(arquivos)) {
    for (const valor of declaracoes(css, 'box-shadow')) {
      // inset desenha borda, não elevação: é outro assunto
      if (/var\(--shadow|var\(--ring/.test(valor) || valor === 'none' || valor.startsWith('inset')) continue;
      foraDaEscala.push(`${nome}: box-shadow: ${valor}`);
    }
  }
  assert.deepEqual(foraDaEscala, [], 'sombra solta cria um nível de profundidade que o resto da tela desconhece');
});

test('o foco é o mesmo anel em toda a interface', async () => {
  const { 'styles.css': css } = await lerTodos();
  const raiz = css.match(/^:root \{[^}]*\}/m)[0];
  assert.match(raiz, /--ring-width:/);
  assert.match(raiz, /--ring-color:/);
  assert.match(raiz, /--ring-offset:/);
});

test('nenhuma folha apaga o anel de foco herdado', async () => {
  const arquivos = await lerTodos();
  const apagados = [];
  for (const [nome, css] of Object.entries(arquivos)) {
    for (const [, seletor] of css.matchAll(/([^}]*)\{[^}]*outline: *none/g)) {
      apagados.push(`${nome}: ${seletor.trim().split('\n').at(-1)}`);
    }
  }
  assert.deepEqual(apagados, [], 'apagar o outline sem repor deixa quem usa teclado sem saber onde está');
});

test('o estado base cobre controle e campo desligados', async () => {
  const { 'styles.css': css } = await lerTodos();
  assert.match(css, /button:disabled,\n *button\[aria-disabled='true'\] \{/, 'botão desligado precisa de aparência própria');
  assert.match(css, /input:disabled,\n *select:disabled,\n *textarea:disabled \{/, 'campo desligado precisa de aparência própria');
});

test('o cursor de espera não é usado para o que está apenas desligado', async () => {
  const arquivos = await lerTodos();
  for (const [nome, css] of Object.entries(arquivos)) {
    // "wait" promete que algo está em andamento; desligado por regra não está processando nada
    assert.doesNotMatch(css, /cursor: *wait/, `${nome} confunde desligado com carregando`);
  }
});

test('o hover não levanta o que não pode ser clicado', async () => {
  const { 'styles.css': css } = await lerTodos();
  assert.doesNotMatch(css, /^button:hover \{/m, 'o hover genérico precisa excluir o botão desligado');
  assert.match(css, /button:hover:not\(:disabled\)/);
});

test('os pesos de fonte são os que a tipografia distingue', async () => {
  const arquivos = await lerTodos();
  const intermediarios = [];
  for (const [nome, css] of Object.entries(arquivos)) {
    for (const valor of declaracoes(css, 'font-weight')) {
      // 550, 650 e 750 desenham quase-negritos que ninguém distingue de 500/600/700,
      // mas que aparecem diferentes quando dois deles ficam lado a lado
      if (/^(400|500|600|700|800|bold|normal|inherit)$/.test(valor.trim())) continue;
      intermediarios.push(`${nome}: font-weight: ${valor.trim()}`);
    }
  }
  assert.deepEqual(intermediarios, []);
});

test('quem pediu menos movimento no sistema recebe menos movimento', async () => {
  const { 'styles.css': css } = await lerTodos();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'a preferência do sistema operacional precisa valer aqui');
});
