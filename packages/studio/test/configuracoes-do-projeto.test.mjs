// As configurações do projeto num lugar só. Antes estavam espalhadas: o projeto na Vercel e
// o domínio dentro de um "details" na tela de Publicação, os pixels no meio do Rastreamento,
// o nome do projeto num diálogo escondido no cabeçalho da Visão geral — e o token da Vercel
// numa aba das configurações da conta que a engrenagem nunca abria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { ABAS_DO_PROJETO, montarConfiguracoesDoProjeto, abaDoAssunto } from '../public/projeto-configuracoes.js';

test('as configurações do projeto cobrem publicação, rastreamento e o projeto em si', () => {
  assert.deepEqual(ABAS_DO_PROJETO.map(([chave]) => chave), ['geral', 'publicacao', 'rastreamento']);
});

test('cada assunto sabe a aba onde mora, para quem chega de outra tela', () => {
  assert.equal(abaDoAssunto('dominio'), 'publicacao');
  assert.equal(abaDoAssunto('vercel'), 'publicacao');
  assert.equal(abaDoAssunto('pixel'), 'rastreamento');
  assert.equal(abaDoAssunto('qualquer-outra'), 'geral');
});

test('a tela reúne os blocos que já existem, sem duplicá-los', () => {
  const { window } = new JSDOM(`<body>
    <section id="project-settings-view" hidden></section>
    <section id="publication-view"><details class="publication-details"><summary>Projeto na Vercel e domínio</summary><form id="publication-connection-form"></form></details></section>
    <section id="tracking-view"><section class="page-block" id="bloco-destinos"><div id="tracking-destinations"></div></section></section>
    <dialog id="project-settings-dialog"><form id="project-settings-form"></form></dialog>
  </body>`);
  const doc = window.document;
  montarConfiguracoesDoProjeto(doc);
  const tela = doc.querySelector('#project-settings-view');
  // Os mesmos nós, agora dentro das configurações: os handlers de sempre continuam valendo.
  assert.equal(tela.querySelector('#publication-connection-form') !== null, true);
  assert.equal(tela.querySelector('#tracking-destinations') !== null, true);
  assert.equal(tela.querySelector('#project-settings-form') !== null, true);
  assert.equal(doc.querySelectorAll('#tracking-destinations').length, 1, 'o bloco foi movido, não copiado');
  assert.equal(doc.querySelector('#publication-view .publication-details'), null);
  // O "details" vira seção aberta: dentro das configurações não há o que esconder.
  assert.equal(tela.querySelector('details'), null);
  // Montar duas vezes não duplica nada.
  montarConfiguracoesDoProjeto(doc);
  assert.equal(doc.querySelectorAll('#project-settings-form').length, 1);
  assert.equal(tela.querySelectorAll('[role="tab"]').length, 3);
  window.close();
});

test('a tela de publicação aponta para onde a configuração foi parar', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="nav-project-settings"/, 'a navegação do projeto tem Configurações');
  assert.match(html, /id="project-settings-view"/);
  const publicacao = html.slice(html.indexOf('id="publication-view"'), html.indexOf('id="project-settings-view"'));
  assert.doesNotMatch(publicacao, /Configurações · Preferências/, 'some o texto que mandava para uma aba inexistente');
});

test('o item Configurações da navegação abre a tela', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$\('#nav-project-settings'\)\.onclick/);
});

// O contrato visual do Studio é docs/wireframes/alva-studio-ui-reference.html. A tela de
// configurações de lá ("Empresa e equipe", #view-workspace) monta o conteúdo em cartões
// `.surface` com `.surface-head`, e os campos em `.field` + `.control`. A primeira versão
// desta tela saiu com os blocos soltos sobre o fundo, e os que vieram de outras telas
// perderam o estilo: o CSS deles estava preso ao seletor da tela de origem (.tracking-view,
// .analytics-view).
test('cada bloco da tela é um cartão do contrato visual', () => {
  const { window } = new JSDOM(`<body>
    <section id="project-settings-view" hidden></section>
    <section id="publication-view"><details class="publication-details"><summary>Projeto na Vercel e domínio</summary><form id="publication-connection-form"></form></details></section>
    <section id="tracking-view"><section class="page-block" id="bloco-destinos"><div class="block-head"><h2>Destinos</h2><p class="helper">Para onde vão.</p></div><div id="tracking-destinations"></div></section></section>
    <dialog id="project-settings-dialog"><form id="project-settings-form"></form></dialog>
  </body>`);
  const doc = window.document;
  montarConfiguracoesDoProjeto(doc);
  for (const bloco of doc.querySelectorAll('#project-settings-view .project-settings-panel > :not(.helper)')) {
    assert.equal(bloco.classList.contains('surface'), true, `bloco "${bloco.textContent.slice(0, 20)}" precisa ser cartão`);
    assert.equal(bloco.classList.contains('page-block'), false, 'sem a borda inferior de bloco de relatório');
  }
  // O título de cada cartão usa o cabeçalho do contrato.
  assert.ok(doc.querySelector('#project-settings-view .surface-head h2'));
  window.close();
});

test('a explicação da aba não repete a do cartão', () => {
  const { window } = new JSDOM(`<body>
    <section id="project-settings-view" hidden></section>
    <section id="tracking-view"><section class="page-block"><div class="block-head"><h2>Destinos</h2><p class="helper">Para onde as conversões vão.</p></div><div id="tracking-destinations"></div></section></section>
  </body>`);
  const doc = window.document;
  montarConfiguracoesDoProjeto(doc);
  const painel = doc.querySelector('#project-settings-panel-rastreamento');
  assert.equal(painel.querySelectorAll('.helper').length, 1);
  window.close();
});

test('o estilo dos destinos e dos campos vale onde o bloco estiver', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const seletor of ['.providers', '.provider-config', '.provider-form']) {
    const linha = css.split('\n').find((l) => l.includes(seletor + ' {') || l.includes(seletor + ' >'));
    assert.ok(linha, `sem regra para ${seletor}`);
    assert.match(linha, /\.project-settings-panel/, `${seletor} precisa valer também nas configurações do projeto`);
  }
});

test('o cartão das configurações não inventa cor, raio ou sombra', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const bloco = css.slice(css.indexOf('/* Configurações do projeto'));
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}\b/, 'só token, nenhuma cor escrita à mão');
  assert.doesNotMatch(bloco, /border-radius: *\d/, 'raio vem de var(--radius-*)');
});

test('o cartão de configuração tem medida de leitura, não a largura da tela', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const painel = css.slice(css.indexOf('.project-settings-panel {'));
  assert.match(painel.slice(0, painel.indexOf('}')), /max-width/);
});
