import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioContextBoundary } from '../public/studio-context-boundary.js';

test('salva o editor e o remove antes de limpar a lista do contexto', async () => {
  const events = [];
  const boundary = createStudioContextBoundary({
    savePage: async () => events.push('salvar-página'),
    closePageEditor: () => events.push('destruir-grapesjs'),
    clearPageList: () => events.push('limpar-páginas'),
  });

  await boundary.close();

  assert.deepEqual(events, ['salvar-página', 'destruir-grapesjs', 'limpar-páginas']);
});
