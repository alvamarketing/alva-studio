import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushChanges } from '../public/save-cycle.js';
test('aguarda alterações surgidas enquanto uma gravação estava em andamento', async () => {
  let dirty = true;
  const persisted = [];
  let current = 'antes';
  await flushChanges(
    () => dirty,
    async () => {
      const snapshot = current;
      dirty = false;
      await Promise.resolve();
      if (snapshot === 'antes') {
        current = 'depois';
        dirty = true;
      }
      persisted.push(snapshot);
    },
  );
  assert.deepEqual(persisted, ['antes', 'depois']);
  assert.equal(dirty, false);
});
test('falha de salvamento impede concluir saída', async () => {
  await assert.rejects(
    () =>
      flushChanges(
        () => true,
        async () => {
          throw new Error('não salvo');
        },
      ),
    /não salvo/,
  );
});
