import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = () => readFile(new URL('../public/editor-novo.css', import.meta.url), 'utf8');

// O SDK desenha esses pedaços por conta própria: não há opção de configuração para eles,
// só CSS por cima das classes gs-*. É mais frágil que o resto — se o SDK renomear uma
// classe numa atualização, o ajuste some sem avisar. Cada regra diz o que endereça.

test('o painel de seletores some: tag e classe CSS não são coisa do público daqui', async () => {
  const folha = await css();
  assert.match(folha, /\.gs-cmp-selector-manager__field-selectors/);
  assert.match(folha, /\.gs-cmp-selector-manager__field-components/);
});

test('a barra do componente perde os círculos brancos', async () => {
  const folha = await css();
  assert.match(folha, /\.gs-component-toolbar__item-btn/);
  assert.match(folha, /border-radius:\s*var\(--radius-sm/, 'círculo sobre azul destoa de tudo à volta');
});

test('as camadas ficam com linhas legíveis, não com quadradinhos', async () => {
  const folha = await css();
  assert.match(folha, /\.gs-cmp-layer-item__icon/);
  assert.match(folha, /\.gs-cmp-layer-item--selected/, 'a linha escolhida precisa se destacar');
});

test('cada regra diz a qual pedaço do SDK ela se agarra', async () => {
  const folha = await css();
  const bloco = folha.slice(folha.indexOf('/* Ajustes sobre a interface do SDK'));
  assert.ok(bloco.length > 400, 'o bloco precisa existir e estar comentado');
  assert.match(bloco, /frágil|atualiza/i, 'quem mexer depois precisa saber do risco');
});
