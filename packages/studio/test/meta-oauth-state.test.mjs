import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { assinarState, lerState, segredoDoState } from '../server/meta-oauth-state.mjs';

const SEGREDO = segredoDoState('a'.repeat(64));
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);
const DADOS = { nonce: 'n'.repeat(43), companyId: 'empresa-1', projectId: 'projeto-1', userId: 'pessoa-1', sessionId: 'sessao-1', expiraEm: AGORA + 10 * 60_000 };

test('o state assinado volta com os mesmos dados, e a sessão só como hash', () => {
  const state = assinarState(DADOS, SEGREDO);
  assert.match(state, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(Buffer.from(state.split('.')[0], 'base64url').toString('utf8'), /sessao-1/);
  const lido = lerState(state, SEGREDO, { agora: AGORA });
  assert.deepEqual(lido, {
    nonce: DADOS.nonce, companyId: 'empresa-1', projectId: 'projeto-1', userId: 'pessoa-1',
    sessionHash: createHash('sha256').update('sessao-1').digest('hex'), expiraEm: Math.floor(DADOS.expiraEm / 1000) * 1000,
  });
  const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['c', 'exp', 'n', 'p', 's', 'u', 'v']);
  assert.equal(payload.v, 1);
});

test('um byte trocado no payload ou na assinatura invalida o state', () => {
  const state = assinarState(DADOS, SEGREDO);
  const [payload, assinatura] = state.split('.');
  const trocar = (texto) => `${texto.slice(0, 5)}${texto[5] === 'A' ? 'B' : 'A'}${texto.slice(6)}`;
  assert.equal(lerState(`${trocar(payload)}.${assinatura}`, SEGREDO, { agora: AGORA }), null);
  assert.equal(lerState(`${payload}.${trocar(assinatura)}`, SEGREDO, { agora: AGORA }), null);
  assert.equal(lerState(`${payload}.${assinatura.slice(0, -2)}`, SEGREDO, { agora: AGORA }), null);
});

test('state vencido é recusado', () => {
  const state = assinarState(DADOS, SEGREDO);
  assert.equal(lerState(state, SEGREDO, { agora: DADOS.expiraEm + 1000 }), null);
});

test('state assinado com outro segredo é recusado', () => {
  const state = assinarState(DADOS, segredoDoState('b'.repeat(64)));
  assert.equal(lerState(state, SEGREDO, { agora: AGORA }), null);
});

test('state de outra versão é recusado mesmo com assinatura válida', () => {
  const payload = Buffer.from(JSON.stringify({ v: 2, n: DADOS.nonce, c: 'empresa-1', p: 'projeto-1', u: 'pessoa-1', s: 'f'.repeat(64), exp: Math.floor(DADOS.expiraEm / 1000) })).toString('base64url');
  const assinatura = createHmac('sha256', SEGREDO).update(payload).digest('base64url');
  assert.equal(lerState(`${payload}.${assinatura}`, SEGREDO, { agora: AGORA }), null);
});

test('lixo, vazio e tamanhos absurdos são recusados sem exceção', () => {
  for (const valor of [undefined, null, '', 'abc', 'a.b.c', '.', 'x'.repeat(5000), 42, {}]) assert.equal(lerState(valor, SEGREDO, { agora: AGORA }), null);
});

test('o segredo do state é derivado da chave-mestra e não é ela', () => {
  assert.equal(SEGREDO.length, 32);
  assert.notDeepEqual(SEGREDO, Buffer.from('a'.repeat(32)));
  assert.deepEqual(segredoDoState('a'.repeat(64)), SEGREDO);
  assert.throws(() => segredoDoState(''), /TRACKING_MASTER_KEY/);
});
