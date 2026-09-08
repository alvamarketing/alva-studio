import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtimeCss } from '../public/templates.js';
import { chartPalette } from '../public/editor-shell.js';

test('as barras leem cor e altura de variáveis, para poderem ser ajustadas', () => {
  assert.match(runtimeCss, /\.alva-chart-bars\{[^}]*height:var\(--alva-chart-height,230px\)/);
  assert.match(runtimeCss, /\.alva-chart-bars i\{[^}]*var\(--alva-bar-from,#286eea\)/);
  assert.match(runtimeCss, /var\(--alva-bar-to,#80d6c2\)/);
});

test('a paleta do gráfico circular sai das cores escolhidas, com o padrão de sempre', () => {
  assert.deepEqual(chartPalette([]), ['#286eea', '#80d6c2', '#ffc76b']);
  assert.deepEqual(chartPalette(['#ff0000']), ['#ff0000', '#80d6c2', '#ffc76b']);
  assert.deepEqual(chartPalette(['#ff0000', '#00ff00', '#0000ff']), ['#ff0000', '#00ff00', '#0000ff']);
  assert.deepEqual(chartPalette(null), ['#286eea', '#80d6c2', '#ffc76b']);
});

test('o inspetor do gráfico traz cor e altura', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /Cor das barras/);
  assert.match(fonte, /Altura do gráfico/);
  assert.match(fonte, /Cor das fatias/);
});

test('a cor entra em cada barra, não só na variável', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('const pintarBarras'), fonte.indexOf('const pintarBarras') + 400);
  assert.match(corpo, /componentsByTag\(barChart, 'i'\)/);
  assert.match(corpo, /background: `linear-gradient/);
});
