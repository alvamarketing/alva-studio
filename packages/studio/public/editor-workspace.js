export const EDITOR_WORKSPACE_PANELS = Object.freeze(['structure', 'canvas', 'inspector']);

const PANEL_LABELS = Object.freeze({
  structure: 'Estrutura',
  canvas: 'Canvas',
  inspector: 'Editar',
});

export function normalizeWorkspacePanel(panel) {
  return EDITOR_WORKSPACE_PANELS.includes(panel) ? panel : 'canvas';
}

export function workspaceState(panel) {
  const activePanel = normalizeWorkspacePanel(panel);
  return {
    activePanel,
    panels: EDITOR_WORKSPACE_PANELS.map((id) => ({
      id,
      label: PANEL_LABELS[id],
      selected: id === activePanel,
    })),
  };
}

export function workspaceKeyAction(event, activePanel) {
  const index = EDITOR_WORKSPACE_PANELS.indexOf(normalizeWorkspacePanel(activePanel));

  if (event?.key === 'Home') return EDITOR_WORKSPACE_PANELS[0];
  if (event?.key === 'End') return EDITOR_WORKSPACE_PANELS.at(-1);
  if (event?.key === 'ArrowLeft') return EDITOR_WORKSPACE_PANELS[(index - 1 + EDITOR_WORKSPACE_PANELS.length) % EDITOR_WORKSPACE_PANELS.length];
  if (event?.key === 'ArrowRight') return EDITOR_WORKSPACE_PANELS[(index + 1) % EDITOR_WORKSPACE_PANELS.length];
  return null;
}
