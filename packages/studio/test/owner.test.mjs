import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordConfirmation, vercelPayload } from '../public/owner.js';
test('a confirmação evita criar ou trocar senha digitada diferente', () => {
  assert.throws(() => validatePasswordConfirmation('frase-segura-123', 'outra-frase-123'), /não conferem/);
  assert.doesNotThrow(() => validatePasswordConfirmation('frase-segura-123', 'frase-segura-123'));
});
test('campo vazio de token mantém credencial existente, sem enviá-la de volta', () => {
  assert.deepEqual(vercelPayload({ token: '', teamId: ' team_example ' }), { teamId: 'team_example' });
  assert.deepEqual(vercelPayload({ token: ' new-token ', teamId: '' }), { token: 'new-token', teamId: '' });
});
