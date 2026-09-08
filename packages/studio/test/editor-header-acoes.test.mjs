import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');

test('o cabeçalho não esconde ações atrás de um menu de três pontos', () => {
  assert.doesNotMatch(fonte, /more_horiz/);
  assert.doesNotMatch(fonte, /fe-header-more/);
});

test('o seletor de dispositivo sai do cabeçalho: ele vive na barra do canvas', () => {
  assert.match(fonte, /querySelector\('\.device-control'\)\?\.remove\(\)/);
});

test('prévia e publicar viram ícones com rótulo no hover', () => {
  assert.match(fonte, /pagePreview:\s*\{ label: 'Prévia'/);
  assert.match(fonte, /pagePublish:\s*\{ label: 'Publicar'/);
  assert.match(fonte, /\['#preview', 'pagePreview'\]/);
  assert.match(fonte, /\['#publish', 'pagePublish'\]/);
  assert.match(fonte, /botao\.classList\.add\('fe-header-icon'\)/);
});

test('o estado de salvamento acompanha as ações, no fim do cabeçalho', () => {
  assert.match(fonte, /actions\?\.prepend\(savedGroup\)|savedGroup/);
});

test('nada mais tenta controlar o seletor de dispositivo que saiu do cabeçalho', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  // com o select removido, `$('#device').value = ...` quebrava a abertura da página
  assert.doesNotMatch(app, /\$\('#device'\)/);
});

test('o cabeçalho tem uma única regra de tooltip, para as posições não brigarem', async () => {
  const editorCss = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  // styles.css já posiciona .editor-header [data-tooltip]; uma segunda regra com `right`
  // conflitava com o `left: 50%` dela e espremia a caixa
  assert.doesNotMatch(editorCss, /\.editor-header \.fe-header-icon\[data-tooltip\]::after/);
});
