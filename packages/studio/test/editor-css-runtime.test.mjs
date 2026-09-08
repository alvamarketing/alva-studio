import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtimeCss, templateCss } from '../public/templates.js';

test('as regras de comportamento vivem separadas do visual da página', () => {
  // movimento, ícone, gráficos e vsl são o que o editor promete e precisa funcionar
  // em qualquer página, inclusive nas salvas antes destas regras existirem
  for (const marca of ['data-alva-motion', 'alva-fade-up', 'material-symbols-outlined', 'alva-chart', 'alva-vsl']) {
    assert.ok(runtimeCss.includes(marca), `faltou ${marca} no css de sistema`);
  }
});

test('o visual do template continua trazendo o comportamento junto', () => {
  assert.ok(templateCss.includes('data-alva-motion'), 'páginas novas nascem completas');
  assert.ok(templateCss.includes('.hero-grid'), 'e com o visual');
});

test('o editor reaplica o css de sistema mesmo em página antiga', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('function blockStyles('), fonte.indexOf('function insertBlock('));
  assert.match(corpo, /runtimeCss/);
  // o retorno antecipado não pode pular o css de sistema
  assert.ok(corpo.indexOf('runtimeCss') < corpo.indexOf('.hero-grid'), 'sistema entra antes da checagem de página antiga');
});

test('a página exportada leva o css de sistema', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('export function buildPageExportHtml('), fonte.indexOf('export function buildPageExportHtml(') + 900);
  assert.match(corpo, /runtimeCss/);
});

test('abrir uma página já existente também traz o css de sistema', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const load = fonte.slice(fonte.indexOf("editor.on('load'"), fonte.indexOf("editor.on('load'") + 420);
  // sem isso o css só entrava ao inserir um bloco, e a página aberta ficava sem movimento
  assert.match(load, /blockStyles\(\)/);
});
