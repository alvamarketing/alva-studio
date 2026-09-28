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
