import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioContextBoundary } from '../public/studio-context-boundary.js';

test('salva e remove os dois editores antes de limpar as listas do contexto', async () => {
  const events = [];
  const boundary = createStudioContextBoundary({
    savePage: async () => events.push('salvar-página'),
    closePageEditor: () => events.push('destruir-grapesjs'),
    clearPageList: () => events.push('limpar-páginas'),
    closeFormEditor: async () => events.push('salvar-e-fechar-formulário'),
    resetForms: () => events.push('limpar-formulários'),
  });

  await boundary.close();

  assert.deepEqual(events, [
    'salvar-página',
    'destruir-grapesjs',
    'limpar-páginas',
    'salvar-e-fechar-formulário',
    'limpar-formulários',
  ]);
});
