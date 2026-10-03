import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MARCA_ALVA } from '../editor/marca-alva.js';

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), 'utf8');

// Pedido do dono (02/10/2026): logo da Alva à esquerda; voltar + nome da página onde ficavam os
// botões de esconder menu; esses botões sobem para as pontas da faixa de ícones acima da página.
test('a marca do editor é o mesmo símbolo de public/index.html', async () => {
  const html = await ler('../public/index.html');
  const d = html.match(/<symbol id="alva-symbol"[^>]*>\s*<path\s+fill="currentColor"\s+fill-rule="evenodd"\s+d="([^"]+)"/)?.[1];
  assert.ok(d, 'símbolo encontrado em index.html');
  assert.equal(MARCA_ALVA, d);
});

test('o cabeçalho próprio substitui o do Puck e traz marca, voltar e nome da página', async () => {
  const topo = await ler('../editor/topo.jsx');
  assert.match(topo, /export function Cabecalho/);
  assert.match(topo, /<Marca \/>/);
  assert.match(topo, /aria-label="Voltar para as páginas"/);
  assert.match(topo, /alva-topo-nome/);
  const principal = await ler('../editor/main.jsx');
  assert.match(principal, /header: Topo,/);
  assert.doesNotMatch(principal, /aria-label="Voltar para as páginas"/, 'o voltar mora só no cabeçalho');
});

test('desfazer e refazer continuam no topo (o cabeçalho do Puck, que os trazia, foi trocado)', async () => {
  const topo = await ler('../editor/topo.jsx');
  assert.match(topo, /historico\.back\(\)/);
  assert.match(topo, /historico\.forward\(\)/);
  assert.match(topo, /disabled=\{!historico\.hasPast\}/);
  assert.match(topo, /disabled=\{!historico\.hasFuture\}/);
});

test('as duas alças de menu vão para a faixa de ícones acima da página, uma de cada lado', async () => {
  const topo = await ler('../editor/topo.jsx');
  assert.match(topo, /PuckCanvas-controls/);
  assert.match(topo, /createPortal\(/);
  assert.match(topo, /alva-alca-menu-esquerda/);
  assert.match(topo, /alva-alca-menu-direita/);
  assert.match(topo, /alternar\('left'\)/);
  assert.match(topo, /alternar\('right'\)/);
  const html = await ler('../public/editor.html');
  assert.match(html, /\.alva-alca-menu-esquerda \{ left: 12px; \}/);
  assert.match(html, /\.alva-alca-menu-direita \{ right: 12px; \}/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*\.alva-alca-menu \{ display: none; \}/, 'no celular valem as abas de baixo do Puck');
});

test('o CSS da barra só usa tokens: nenhuma cor literal', async () => {
  const html = await ler('../public/editor.html');
  const regras = html.split('\n').filter((linha) => /\.alva-(topo|marca|voltar|historico|alca-menu)/.test(linha)).join('\n');
  assert.ok(regras.length > 400);
  assert.doesNotMatch(regras, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  for (const peso of regras.match(/font-weight:\s*\d+/g) ?? []) assert.match(peso, /:\s*(400|500|600|700|800)$/);
});
