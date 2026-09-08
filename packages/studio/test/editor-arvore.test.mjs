import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { numberRepeatedLabels } from '../public/editor-shell.js';

test('elementos do mesmo tipo na mesma seção ganham número, para não ficarem indistinguíveis', () => {
  assert.deepEqual(
    numberRepeatedLabels(['Gráfico de barras', 'Gráfico de barras', 'Botão', 'Gráfico circular', 'Gráfico circular']),
    ['Gráfico de barras 1', 'Gráfico de barras 2', 'Botão', 'Gráfico circular 1', 'Gráfico circular 2'],
  );
});

test('o que aparece uma vez só continua sem número', () => {
  assert.deepEqual(numberRepeatedLabels(['Título', 'Texto', 'Botão']), ['Título', 'Texto', 'Botão']);
  assert.deepEqual(numberRepeatedLabels([]), []);
});

test('o botão de adicionar elemento aparece só na seção aberta', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const trecho = fonte.slice(fonte.indexOf("add.textContent = '+ Elemento'") - 500, fonte.indexOf("add.textContent = '+ Elemento'") + 200);
  assert.match(trecho, /section\.selected/);
});
