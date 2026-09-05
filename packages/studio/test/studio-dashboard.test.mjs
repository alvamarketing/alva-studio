import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardModel, isProjectSlug } from '../public/studio-dashboard.js';

const htmlPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

test('Home e Empresa expõem landmarks e navegação principal acessível', async () => {
  const html = await readFile(htmlPath, 'utf8');

  assert.match(html, /<section id="studio-home"[^>]*aria-labelledby="studio-home-title"/);
  assert.match(html, /<section id="company-view"[^>]*aria-labelledby="company-view-title"/);
  assert.match(html, /id="nav-home"[^>]*aria-current="page"/);
  assert.match(html, /id="nav-company"/);
  assert.match(html, /id="company-switcher"/);
  assert.match(html, /id="new-project-dialog"/);
});

test('modelo da Home cria cartões somente com as empresas e projetos recebidos', () => {
  const companies = [{ id: 'company-a', name: 'Empresa real', role: 'owner' }];
  const projects = [{ id: 'project-a', name: 'Projeto real', updatedAt: '2026-09-04T12:00:00.000Z' }];
  const model = dashboardModel({ phase: 'ready', companies, projects });

  assert.deepEqual(model.companies, companies);
  assert.deepEqual(model.projects, projects);
  assert.deepEqual(model.activity, projects);
  assert.equal(model.status, 'ready');
  assert.equal(dashboardModel({ phase: 'loading' }).status, 'loading');
  assert.equal(dashboardModel({ phase: 'error', error: 'Falhou' }).message, 'Falhou');
  assert.equal(dashboardModel({ phase: 'empty' }).status, 'empty');
  assert.equal(isProjectSlug('campanha-de-primavera'), true);
  assert.equal(isProjectSlug('Campanha inválida'), false);
});

test('Home e Empresa usam os dados reais e não os exemplos ilustrativos do wireframe', async () => {
  const [html, app] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(appPath, 'utf8')]);
  const dashboardShell = html.slice(html.indexOf('<section id="studio-home"'), html.indexOf('<section id="pages-view"'));

  assert.match(app, /api\(`\/companies\/\$\{state\.currentCompany\.id\}\/overview`\)/);
  assert.match(app, /relativeDate\(project\.updatedAt\)/);
  assert.match(app, /studioShell\.can\('project\.manage'\)/);
  assert.match(app, /futureText\.textContent = 'Em breve'/);
  assert.doesNotMatch(dashboardShell, /Imobiliárias|Diagnóstico comercial|Projeto CMA|Profissional|2 de 5/);
});
