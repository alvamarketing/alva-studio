// Quem enviou o formulário, quando o envio não passa pelo gateway.
//
// O formulário também abre direto no domínio do Studio (o link /f/... entregue ao dono).
// Esse envio chega sem o visitante assinado pelo gateway — mas quem faz a requisição é o
// próprio navegador da pessoa. A Meta exige o navegador (client_user_agent) em todo evento
// de site; sem ele, o lead do link direto não podia ir para a Meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clienteDoEnvio } from '../server/index.mjs';

test('pelo gateway, vale o visitante assinado', () => {
  const pedido = { headers: { 'user-agent': 'undici' }, socket: { remoteAddress: '76.76.21.21' } };
  assert.deepEqual(clienteDoEnvio(pedido, { client: { ip: '189.68.172.6', userAgent: 'Mozilla/5.0 (iPhone)' } }), { ip: '189.68.172.6', userAgent: 'Mozilla/5.0 (iPhone)' });
});

test('direto no Studio, vale o navegador de quem fez a requisição', () => {
  const pedido = { headers: { 'user-agent': 'Mozilla/5.0 (Android)' }, socket: { remoteAddress: '200.150.10.20' } };
  assert.deepEqual(clienteDoEnvio(pedido, null), { ip: '200.150.10.20', userAgent: 'Mozilla/5.0 (Android)' });
});
