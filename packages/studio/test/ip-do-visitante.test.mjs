import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipDoVisitante } from '../server/ip-do-visitante.mjs';

const req = (xff) => ({ socket: { remoteAddress: '172.18.0.2' }, headers: xff ? { 'x-forwarded-for': xff } : {} });

test('atrás do proxy, o IP é o último do X-Forwarded-For: o que o proxy acrescentou', () => {
  assert.equal(ipDoVisitante(req('1.1.1.1, 203.0.113.9'), { atrasDeProxy: true }), '203.0.113.9');
  assert.equal(ipDoVisitante(req(''), { atrasDeProxy: true }), '172.18.0.2');
});

test('sem proxy declarado, o cabeçalho é ignorado: qualquer um poderia forjá-lo', () => {
  assert.equal(ipDoVisitante(req('203.0.113.9'), { atrasDeProxy: false }), '172.18.0.2');
});
