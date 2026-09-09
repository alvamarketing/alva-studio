import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ler = (nome) => readFile(new URL(`../public/${nome}`, import.meta.url), 'utf8');

// O cabeçalho do editor já usa ícone com rótulo ao passar o mouse. Os cartões de página
// e de formulário continuavam com três botões de texto, cada um com uma largura, o que
// fazia a mesma ação parecer coisas diferentes em telas diferentes.

const acoesDoCartao = (fonte) => {
  const inicio = fonte.indexOf('<div class="card-actions">');
  return fonte.slice(inicio, fonte.indexOf('</div>', inicio) + 6);
};

for (const [arquivo, itens] of [['app.js', 'página']]) {
  test(`as ações do cartão de ${itens} são ícone com rótulo ao passar o mouse`, async () => {
    const acoes = acoesDoCartao(await ler(arquivo));
    for (const classe of ['edit', 'duplicate', 'delete']) {
      const botao = acoes.match(new RegExp(`<button[^>]*class="[^"]*\\b${classe}\\b[^"]*"[^>]*>.*?</button>`));
      assert.ok(botao, `sem botão ${classe} em ${arquivo}`);
      assert.match(botao[0], /material-symbols-outlined/, `${classe} precisa de ícone`);
      assert.match(botao[0], /data-tooltip="[^"]+"/, `${classe} precisa do rótulo que aparece ao passar o mouse`);
      assert.match(botao[0], /aria-label="[^"]+"/, `${classe} precisa de nome para leitor de tela`);
    }
  });
}

test('o rótulo ao passar o mouse funciona fora do cabeçalho do editor', async () => {
  const css = await ler('styles.css');
  // a regra existia só dentro de .editor-header: em qualquer outro lugar o balão
  // simplesmente não aparecia
  assert.match(css, /^\.alva-tooltip\[data-tooltip\]::after/m);
  assert.match(css, /\.alva-tooltip\[data-tooltip\]:hover::after,\s*\.alva-tooltip\[data-tooltip\]:focus-visible::after/);
});

test('o ícone sozinho não deixa a ação sem nome', async () => {
  for (const arquivo of ['app.js']) {
    const acoes = acoesDoCartao(await ler(arquivo));
    const rotulos = [...acoes.matchAll(/aria-label="([^"]+)"/g)].map((achado) => achado[1]);
    assert.equal(rotulos.length, 3, `${arquivo}: as três ações precisam de nome`);
    assert.equal(new Set(rotulos).size, 3, `${arquivo}: nomes repetidos deixam a ação ambígua`);
  }
});
