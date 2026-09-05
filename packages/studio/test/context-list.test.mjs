import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextList } from '../public/context-list.js';

function deferred() {
  let resolve;
  return { promise: new Promise((next) => (resolve = next)), resolve };
}

test('resposta pendente de páginas não reaplica o contexto anterior após invalidar', async () => {
  const response = deferred();
  const rendered = [];
  const pages = createContextList({
    load: () => response.promise,
    apply: (items) => rendered.push(...items),
  });

  const pending = pages.refresh();
  pages.invalidate();
  response.resolve([{ id: 'page-old', name: 'Página antiga' }]);

  assert.equal(await pending, false);
  assert.deepEqual(rendered, []);
});

test('resposta pendente de formulários não reaplica o contexto anterior após invalidar', async () => {
  const response = deferred();
  const rendered = [];
  const forms = createContextList({
    load: () => response.promise,
    apply: (items) => rendered.push(...items),
  });

  const pending = forms.refresh();
  forms.invalidate();
  response.resolve([{ id: 'form-old', name: 'Formulário antigo' }]);

  assert.equal(await pending, false);
  assert.deepEqual(rendered, []);
});
