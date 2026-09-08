import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const owner = () => readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
const css = () => readFile(new URL('../public/owner.css', import.meta.url), 'utf8');

// Quatro áreas de configuração com pouco conteúdo cada não sustentam uma barra lateral
// própria: sobrava meia tela vazia à direita e a leitura ficava espremida numa coluna.
// Viram abas no topo, como as do editor, e o conteúdo recebe a largura toda.

test('as áreas de configuração são abas no topo, não uma coluna à esquerda', async () => {
  const fonte = await owner();
  assert.match(fonte, /settings-tabs/, 'a navegação passa a ser a faixa de abas');
  assert.doesNotMatch(fonte, /settings-sidebar-nav/, 'a coluna de navegação sai junto com a barra lateral');
  assert.match(fonte, /aria-orientation', 'horizontal'/, 'abas no topo se percorrem para os lados');
});

test('a seta do teclado acompanha a direção das abas', async () => {
  const fonte = await owner();
  const teclas = fonte.slice(fonte.indexOf("button.onkeydown"), fonte.indexOf("button.onkeydown") + 420);
  assert.match(teclas, /ArrowRight/);
  assert.match(teclas, /ArrowLeft/);
  assert.doesNotMatch(teclas, /ArrowDown/, 'seta para baixo é de lista vertical');
});

test('o conteúdo ocupa a largura que a barra lateral tomava', async () => {
  const folha = await css();
  assert.match(folha, /\.settings-tabs \{/);
  assert.match(folha, /\.settings-tabs \{[^}]*display:\s*flex/s, 'as abas ficam lado a lado');
  assert.match(folha, /\.settings-tab\[aria-selected='true'\]/, 'a aba escolhida precisa se distinguir');
});
