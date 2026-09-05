import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_WORKSPACE_PANELS,
  normalizeWorkspacePanel,
  workspaceKeyAction,
  workspaceState,
} from '../public/editor-workspace.js';

test('expõe as três regiões do editor com somente o canvas selecionado por padrão', () => {
  assert.deepEqual(EDITOR_WORKSPACE_PANELS, ['structure', 'canvas', 'inspector']);
  assert.deepEqual(workspaceState(), {
    activePanel: 'canvas',
    panels: [
      { id: 'structure', label: 'Estrutura', selected: false },
      { id: 'canvas', label: 'Canvas', selected: true },
      { id: 'inspector', label: 'Editar', selected: false },
    ],
  });
});

test('normaliza painéis ausentes ou desconhecidos para o canvas', () => {
  assert.equal(normalizeWorkspacePanel(), 'canvas');
  assert.equal(normalizeWorkspacePanel('unknown'), 'canvas');
  assert.deepEqual(
    workspaceState('inspector').panels.map((panel) => [panel.id, panel.selected]),
    [
      ['structure', false],
      ['canvas', false],
      ['inspector', true],
    ],
  );
});

test('navega entre abas somente pelas teclas de navegação', () => {
  const cases = [
    ['ArrowRight', 'canvas', 'inspector'],
    ['ArrowRight', 'inspector', 'structure'],
    ['ArrowLeft', 'canvas', 'structure'],
    ['ArrowLeft', 'structure', 'inspector'],
    ['Home', 'inspector', 'structure'],
    ['End', 'structure', 'inspector'],
  ];

  for (const [key, activePanel, expected] of cases)
    assert.equal(workspaceKeyAction({ key }, activePanel), expected, key + ' a partir de ' + activePanel);

  assert.equal(workspaceKeyAction({ key: 'Enter' }, 'canvas'), null);
  assert.equal(workspaceKeyAction({ key: ' ' }, 'canvas'), null);
  assert.equal(workspaceKeyAction({ key: 'Delete' }, 'canvas'), null);
});
