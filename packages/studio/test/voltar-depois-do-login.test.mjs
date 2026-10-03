import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { destinoDeVolta, enderecoDeLogin } from '../public/voltar-depois-do-login.js';

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), 'utf8');

// Achado do dono (03/10/2026): com a sessão vencida, recarregar o editor mostrava só a frase
// vermelha "Entre na sua conta para continuar." Quem não está logado vai para o login e, depois
// de entrar, volta para onde estava.
test('o endereço de login guarda para onde voltar', () => {
  assert.equal(enderecoDeLogin({ pathname: '/editor.html', search: '?pagina=abc-123' }), '/?voltar=%2Feditor.html%3Fpagina%3Dabc-123');
  assert.equal(enderecoDeLogin({ pathname: '/funil.html', search: '?funil=1&projeto=2' }), '/?voltar=%2Ffunil.html%3Ffunil%3D1%26projeto%3D2');
});

test('depois do login volta para o editor ou o funil de onde a pessoa saiu', () => {
  assert.equal(destinoDeVolta('?voltar=%2Feditor.html%3Fpagina%3Dabc-123'), '/editor.html?pagina=abc-123');
  assert.equal(destinoDeVolta('?voltar=%2Ffunil.html%3Ffunil%3D1%26projeto%3D2'), '/funil.html?funil=1&projeto=2');
});

test('só volta para páginas do próprio Studio da lista: nada de outro site nem de endereço estranho', () => {
  for (const mal of [
    'https://outro.site/editor.html', '//outro.site/editor.html', '/\\outro.site', 'javascript:alert(1)',
    '/api/session', '/../editor.html', '/editor.html/../../api', '/outra-pagina.html', '', 'editor.html',
  ]) assert.equal(destinoDeVolta(`?voltar=${encodeURIComponent(mal)}`), null, mal);
  assert.equal(destinoDeVolta(''), null);
  assert.equal(destinoDeVolta('?outra=1'), null);
});

test('os dois editores mandam para o login quando a API responde 401', async () => {
  for (const arquivo of ['../editor/main.jsx', '../editor/funil.jsx']) {
    const fonte = await ler(arquivo);
    assert.match(fonte, /resposta\.status === 401/, arquivo);
    assert.match(fonte, /enderecoDeLogin\(location\)/, arquivo);
  }
});

test('o Studio principal volta para a página de origem depois de entrar', async () => {
  const owner = await ler('../public/owner.js');
  assert.match(owner, /destinoDeVolta\(location\.search\)/);
  const servidor = await ler('../server/index.mjs');
  assert.match(servidor, /'\/voltar-depois-do-login\.js'/);
});
