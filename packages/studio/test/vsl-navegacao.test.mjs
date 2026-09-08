import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = () => readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = () => readFile(new URL('../public/app.js', import.meta.url), 'utf8');

// A tela de VSL existia e funcionava, mas não havia como chegar nela pela interface: só
// digitando #/vsl na barra de endereço. Quem usa o Studio nunca a encontraria.

test('o menu do projeto leva às VSLs', async () => {
  const fonte = await html();
  const navegacao = fonte.slice(fonte.indexOf('data-sidebar-context="project"'), fonte.indexOf('</nav>', fonte.indexOf('data-sidebar-context="project"')));
  assert.match(navegacao, /id="nav-vsl"/, 'sem item de menu a tela fica inalcançável');
  assert.match(navegacao, /VSL/);
});

test('o item só aparece quando o recurso de vídeo está ligado', async () => {
  const fonte = await app();
  const sincronia = fonte.slice(fonte.indexOf('function updateVslNavigation'), fonte.indexOf('function updateVslNavigation') + 600);
  assert.match(sincronia, /nav-vsl/, 'com o recurso desligado o item precisa sumir, não levar a lugar nenhum');
  assert.match(sincronia, /mediaPipelineEnabled/);
});

test('clicar no item abre a tela de VSLs', async () => {
  const fonte = await app();
  assert.match(fonte, /\$\('#nav-vsl'\)/);
  assert.match(fonte, /setDashboardView\('vsl'\)/);
});
