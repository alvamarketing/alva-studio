import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fonte = () => readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
const css = () => readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');

// A casca simples cobre o dia a dia de quem não é designer, mas escondia o motor inteiro:
// estilo, atributos e camadas do GrapesJS existiam e nunca eram desenhados na tela. Quem
// precisava de um controle fora da lista curada não tinha para onde ir.

test('o painel oferece um caminho para os controles completos do editor', async () => {
  const js = await fonte();
  assert.match(js, /fe-advanced/, 'sem uma área de avançado o motor fica inacessível');
  assert.match(js, /StyleManager/, 'os setores de estilo do GrapesJS precisam ser desenhados');
  assert.match(js, /TraitManager/, 'os atributos do componente também');
});

test('o avançado nasce fechado, para não assustar quem só quer trocar um texto', async () => {
  const js = await fonte();
  const bloco = js.slice(js.indexOf('fe-advanced'), js.indexOf('fe-advanced') + 700);
  assert.doesNotMatch(bloco, /\.open = true/, 'aberto por padrão devolve a poluição que a casca resolveu');
  assert.match(bloco, /details|summary/, 'recolhido é o que deixa os dois públicos convivendo');
});

test('os controles nativos ganham a aparência do editor, não a do GrapesJS cru', async () => {
  const folha = await css();
  assert.match(folha, /\.fe-advanced/);
  assert.match(folha, /\.fe-advanced-native \.gjs-field/, 'sem isto o painel avançado destoa do resto');
});
