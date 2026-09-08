import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const home = markup.slice(markup.indexOf('id="studio-home"'), markup.indexOf('id="history-view"'));

test('a home anuncia VSLs junto de páginas e quizzes, como na referência visual', () => {
  assert.match(home, /Escolha um projeto para criar páginas, quizzes, VSLs e acompanhar seus leads\./);
});

test('a home não repete o título em um segundo cabeçalho', () => {
  assert.equal(home.match(/Seus projetos/g)?.length, 1);
});

test('o card de projeto usa os rótulos de contagem da referência visual', () => {
  const rotulos = app.slice(app.indexOf('function projectCard('), app.indexOf('function projectCreateCard('));
  for (const rotulo of ['Páginas', 'Quizzes', 'VSL', 'Leads', 'No ar']) {
    assert.match(rotulos, new RegExp(`'${rotulo}'`), `faltou o rótulo ${rotulo}`);
  }
  assert.doesNotMatch(rotulos, /'VSLs'|'Publicados'/);
});

test('clicar em Início ou Projetos abre a home mesmo com projeto atual', () => {
  const corpo = app.slice(app.indexOf('function setDashboardView('), app.indexOf('function mobileDrawerActive('));
  assert.doesNotMatch(corpo, /view === 'home' && studioShell\?\.state\?\.\(\)\.currentProject/);
});

test('o destaque do menu segue a tela aberta, sem trocar home por projeto', () => {
  const corpo = app.slice(app.indexOf('function setActiveNavigation('), app.indexOf('function sidebarContextFor('));
  assert.doesNotMatch(corpo, /view === 'home' && studioShell\?\.state\?\.\(\)\.currentProject \? 'project' : view/);
});

test('na home a barra lateral mostra o grupo do studio, não o do projeto', () => {
  const corpo = app.slice(app.indexOf('function sidebarContextFor('), app.indexOf('function syncSidebarContext('));
  assert.match(corpo, /view === 'home'/);
});
