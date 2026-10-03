import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enderecoDeRedirecionamento } from '../public/page-schema.js';
import { renderCompletion } from '../server/pagina-de-obrigado.mjs';

// Conferência do pacote A1 (03/10/2026): "https://banco.com@outro.site/" parece o banco e leva a
// outro site. O endereço de redirecionamento não aceita usuário nem senha, no editor nem no servidor.
const COM_CREDENCIAIS = ['https://banco.com@evil.test/', 'https://usuario:senha@exemplo.com/', 'http://a@b.c/x'];
const VALIDOS = ['https://exemplo.com/obrigado', 'http://exemplo.com.br/a?b=1#c', 'https://sub.exemplo.com:8443/x'];

test('o editor não aceita endereço com usuário ou senha', () => {
  for (const url of COM_CREDENCIAIS) assert.equal(enderecoDeRedirecionamento(url), '', url);
  for (const url of VALIDOS) assert.equal(enderecoDeRedirecionamento(url), url, url);
});

test('a página de obrigado do servidor também recusa e não monta o refresh nem o link', () => {
  for (const url of COM_CREDENCIAIS) {
    const html = renderCompletion('Obrigado', 'Recebemos.', { redirecionar: url });
    assert.doesNotMatch(html, /http-equiv="refresh"/, url);
    assert.doesNotMatch(html, /Continuar/, url);
  }
  const bom = renderCompletion('Obrigado', 'Recebemos.', { redirecionar: 'https://exemplo.com/obrigado' });
  assert.match(bom, /http-equiv="refresh" content="0;url=https:\/\/exemplo\.com\/obrigado"/);
});
