import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nextPanelTab } from '../public/editor-shell.js';

const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');

test('o painel tem três abas: estrutura, elementos e conteúdo', () => {
  assert.deepEqual(nextPanelTab('estrutura').abas, ['estrutura', 'elementos', 'conteudo']);
  assert.equal(nextPanelTab('elementos').ativa, 'elementos');
  assert.equal(nextPanelTab('inexistente').ativa, 'estrutura', 'aba desconhecida cai na estrutura');
});

test('selecionar um elemento leva direto para o conteúdo dele', () => {
  assert.equal(nextPanelTab('estrutura', { selecionou: true }).ativa, 'conteudo');
  assert.equal(nextPanelTab('elementos', { selecionou: true }).ativa, 'conteudo');
  // sem seleção, a aba escolhida à mão é respeitada
  assert.equal(nextPanelTab('elementos', { selecionou: false }).ativa, 'elementos');
});

test('as abas aparecem no topo do painel e o inspetor mora dentro dele', () => {
  assert.match(fonte, /class="fe-panel-tabs"/);
  for (const aba of ['estrutura', 'elementos', 'conteudo']) {
    assert.match(fonte, new RegExp(`data-panel-tab="${aba}"`), `faltou a aba ${aba}`);
  }
  assert.match(fonte, /data-panel-pane="conteudo"/);
});

test('as abas cabem numa linha só, sem quebrar no painel estreito', () => {
  const regra = css.slice(css.indexOf('.fe-panel-tabs {'), css.indexOf('.fe-panel-tabs {') + 220);
  assert.match(regra, /flex-wrap:\s*nowrap/);
  const aba = css.slice(css.indexOf('.fe-panel-tab {'), css.indexOf('.fe-panel-tab {') + 300);
  assert.match(aba, /min-width:\s*0/);
});

test('o editor passa a ter duas colunas: painel e canvas', () => {
  assert.match(css, /\.friendly-editor \{[^}]*grid-template-columns:\s*minmax\(0, 300px\) minmax\(0, 1fr\)/s);
});

test('escolher um elemento na árvore ou no canvas abre a aba Conteúdo', () => {
  // sem isso o inspetor atualiza escondido atrás da aba Estrutura
  assert.match(fonte, /syncAbasDoPainel\(\{ selecionou: true \}\)/);
  const selecao = fonte.slice(fonte.indexOf('function selectTreeItem('), fonte.indexOf('function selectTreeItem(') + 500);
  assert.match(selecao, /syncAbasDoPainel/);
});
