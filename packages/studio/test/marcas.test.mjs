import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fonteDasMarcas, PEDIDAS } from '../scripts/gerar-marcas.mjs';
import { MARCAS, SEM_LOGO, svgDaMarca } from '../public/marcas.js';

// Os logos vêm do simple-icons, não de desenho à mão: o arquivo servido tem de ser
// exatamente o que o gerador produz com o pacote instalado.
test('public/marcas.js é o gerado por scripts/gerar-marcas.mjs, sem edição à mão', async () => {
  const servido = await readFile(new URL('../public/marcas.js', import.meta.url), 'utf8');
  assert.equal(servido, fonteDasMarcas());
  assert.match(servido, /^\/\/ Gerado por scripts\/gerar-marcas\.mjs .*Não editar à mão\./);
});

test('toda marca pedida tem logo do pacote ou inicial — nunca as duas, nunca nenhuma', () => {
  for (const chave of Object.keys(PEDIDAS)) {
    assert.notEqual(Boolean(MARCAS[chave]), Boolean(SEM_LOGO[chave]), chave);
  }
  for (const marca of Object.values(MARCAS)) {
    assert.match(marca.hex, /^[0-9A-F]{6}$/);
    assert.match(marca.caminho, /^M/);
  }
  // O que o simple-icons 16 não traz: LinkedIn (removido a pedido da empresa) e Taboola.
  assert.deepEqual(SEM_LOGO, { linkedin: { inicial: 'in' }, taboola: { inicial: 'Tb' } });
});

test('o SVG da marca usa a cor do texto (currentColor) e é decorativo', () => {
  const svg = svgDaMarca('facebook');
  assert.match(svg, /fill="currentColor"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.equal(svgDaMarca('linkedin'), '');
});

// A única cor nova autorizada (02/10/2026) é a cor oficial de cada marca, num bloco só de
// owner.css. Ela tem de bater com a do pacote, e não pode aparecer em nenhum outro lugar.
test('as cores --marca-* de owner.css são as do simple-icons, num bloco só', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const inicio = css.indexOf('/* Marcas das plataformas');
  const fim = css.indexOf('/* Fim das marcas */');
  assert.ok(inicio >= 0 && fim > inicio, 'o bloco das marcas existe e está delimitado');
  const bloco = css.slice(inicio, fim);
  // Exceção documentada: o botão do Facebook usa o azul da documentação do Login do Facebook
  // (#1877F2), não o do logo no simple-icons (#0866FF).
  const COR_DO_BOTAO = { facebook: '1877F2' };
  for (const [chave, marca] of Object.entries(MARCAS)) {
    assert.match(bloco, new RegExp(`--marca-${chave}: #${COR_DO_BOTAO[chave] ?? marca.hex};`, 'i'), `--marca-${chave}`);
  }
  const resto = (css.slice(0, inicio) + css.slice(fim)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(resto, /--marca-[a-z]+:/, 'nenhuma cor de marca declarada fora do bloco');
  // Quem usa cor de marca: só o logo da plataforma e o botão oficial do Facebook.
  for (const regra of resto.match(/[^{}]+\{[^}]*var\(--marca-[^}]*\}/g) ?? []) {
    assert.match(regra.trim(), /^(\.plataforma-logo|\.botao-facebook)/, `uso de cor de marca fora do logo/botão: ${regra.trim().slice(0, 80)}`);
  }
});
