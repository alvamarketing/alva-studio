import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nextCanvasDevice, panelToggleState } from '../public/editor-shell.js';

test('o canvas alterna entre computador, tablet e celular', () => {
  assert.equal(nextCanvasDevice('Desktop'), 'Tablet');
  assert.equal(nextCanvasDevice('Tablet'), 'Mobile');
  assert.equal(nextCanvasDevice('Mobile'), 'Desktop');
  assert.equal(nextCanvasDevice('qualquer-coisa'), 'Desktop');
});

test('recolher o painel da estrutura alterna e nada mais', () => {
  assert.deepEqual(panelToggleState({}), { left: false });
  assert.deepEqual(panelToggleState({ left: false }, 'left'), { left: true });
  assert.deepEqual(panelToggleState({ left: true }, 'left'), { left: false });
});

test('a barra do canvas traz os controles de dispositivo e de recolher', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const barra = fonte.slice(fonte.indexOf('class="fe-canvas-bar"'), fonte.indexOf('class="fe-canvas-bar"') + 1600);
  assert.match(barra, /data-device="Desktop"/);
  assert.match(barra, /data-device="Tablet"/);
  assert.match(barra, /data-device="Mobile"/);
  assert.match(barra, /data-toggle-panel="left"/);
});

test('trocar de dispositivo fala com o GrapesJS, não só com o rótulo', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /editor\.setDevice\(/);
});

test('o estado de recolhido é marcado no próprio editor, não num filho', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('const syncPainelRecolhido'), fonte.indexOf('const syncPainelRecolhido') + 420);
  assert.match(corpo, /host\.setAttribute\('data-collapsed'/);
  assert.doesNotMatch(corpo, /host\.querySelector\('\.friendly-editor'\)/);
});

test('em computador a página ocupa a largura toda; tablet e celular é que simulam', async () => {
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  const quadro = css.slice(css.indexOf('.fe-canvas-frame {'), css.indexOf('.fe-canvas-frame {') + 300);
  assert.doesNotMatch(quadro, /width:\s*min\(790px/);
  assert.match(quadro, /width:\s*100%/);
  // as larguras simuladas continuam presas ao dispositivo escolhido
  assert.match(css, /\.fe-canvas-frame\[data-device='Tablet'\][^}]*width:\s*768px/);
  assert.match(css, /\.fe-canvas-frame\[data-device='Mobile'\][^}]*width:\s*375px/);
});
