import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { panelToggleState } from '../public/editor-shell.js';

// Quando as propriedades viraram a aba "Conteúdo" da barra lateral, o editor passou a
// ter uma coluna só. O botão "Recolher as propriedades" continuou na barra do canvas
// apontando para um painel que não existe mais: clicar nele não fazia nada.

test('o editor tem um painel para recolher, não dois', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /data-toggle-panel="left"/);
  assert.doesNotMatch(fonte, /data-toggle-panel="right"/, 'não há painel à direita desde que as propriedades viraram aba');
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.friendly-editor \{[^}]*grid-template-columns:[^;]*minmax\(0, *1fr\)/s);
});

test('recolher continua sendo um interruptor de um lado só', () => {
  assert.deepEqual(panelToggleState({}), { left: false });
  assert.deepEqual(panelToggleState({ left: false }, 'left'), { left: true });
  assert.deepEqual(panelToggleState({ left: true }, 'left'), { left: false });
  assert.deepEqual(panelToggleState({ left: true }, 'right'), { left: true }, 'lado inexistente não muda nada');
});

test('o rótulo do botão anuncia a próxima ação em todos os lugares que a pessoa lê', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const sync = fonte.slice(fonte.indexOf('const syncPainelRecolhido'), fonte.indexOf('if (!interactionPolicy.canEdit) status'));
  // title, aria-label e data-tooltip mostravam textos diferentes: recolhido, o balão
  // ainda dizia "Recolher", ou seja, a ação contrária à que o clique faria
  for (const atributo of ['title', 'aria-label', 'data-tooltip']) {
    assert.match(sync, new RegExp(atributo.replace('-', '.?')), `${atributo} precisa acompanhar o estado`);
  }
  assert.match(sync, /Mostrar a estrutura/);
  assert.match(sync, /Recolher a estrutura/);
});
