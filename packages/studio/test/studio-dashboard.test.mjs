import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDashboardNavigation, canCreateProject, createDashboardContextFlow, createProjectSubmission, dashboardModel, isProjectSlug } from '../public/studio-dashboard.js';

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
  assert.match(app, /canCreateProject\(studioShell\)/);
  assert.match(app, /await studioShell\.initialize\(\);\s*dashboardContextFlow\.bootstrap\(\);/);
  assert.match(app, /futureText\.textContent = 'Em breve'/);
  assert.doesNotMatch(dashboardShell, /Imobiliárias|Diagnóstico comercial|Projeto CMA|Profissional|2 de 5/);
});

test('troca de empresa limpa a superfície imediatamente e restaura o seletor confirmado quando falha', async () => {
  const confirmed = {
    phase: 'ready', session: { user: { displayName: 'Ana' } }, companies: [{ id: 'company-a', name: 'Empresa A' }],
    projects: [{ id: 'project-a', name: 'Projeto A' }], currentCompany: { id: 'company-a' }, currentProject: { id: 'project-a' }, error: '',
  };
  const rendered = [];
  const switchers = [];
  const shell = { state: () => confirmed, selectCompany: async () => { throw new Error('Sessão expirada'); } };
  const flow = createDashboardContextFlow({
    shell,
    renderState: (state) => rendered.push(state),
    renderSwitcher: (state, options) => switchers.push({ state, options }),
  });

  await assert.rejects(() => flow.selectCompany('company-b'), /Sessão expirada/);

  assert.equal(rendered[0].phase, 'loading');
  assert.deepEqual(rendered[0].projects, []);
  assert.equal(rendered[1].phase, 'error');
  assert.deepEqual(rendered[1].companies, []);
  assert.equal(switchers[0].options.selectedCompanyId, 'company-b');
  assert.equal(switchers[0].options.disabled, true);
  assert.equal(switchers[1].options.selectedCompanyId, 'company-a');
  assert.equal(switchers[1].options.disabled, false);
});

test('primeira troca falha restaura o contexto carregado depois que o fluxo foi criado', async () => {
  let active = { phase: 'empty', session: null, companies: [], projects: [], currentCompany: null, currentProject: null, error: '' };
  const switchers = [];
  const shell = {
    state: () => active,
    async initialize() {
      active = {
        phase: 'ready', session: { user: { displayName: 'Ana' } }, companies: [{ id: 'company-a', name: 'Empresa A' }, { id: 'company-b', name: 'Empresa B' }],
        projects: [{ id: 'project-a', name: 'Projeto A' }], currentCompany: { id: 'company-a' }, currentProject: { id: 'project-a' }, error: '',
      };
    },
    async selectCompany() { throw new Error('Sessão expirada'); },
  };
  const flow = createDashboardContextFlow({ shell, renderState: () => {}, renderSwitcher: (state, options) => switchers.push({ state, options }) });

  await shell.initialize();
  flow.bootstrap();
  await assert.rejects(() => flow.selectCompany('company-b'), /Sessão expirada/);

  assert.equal(switchers.at(-1).options.selectedCompanyId, 'company-a');
  assert.equal(switchers.at(-1).state.currentProject.id, 'project-a');
});

test('troca de empresa confirma o novo contexto após a API concluir', async () => {
  let active = {
    phase: 'ready', session: { user: { displayName: 'Ana' } }, companies: [{ id: 'company-a' }, { id: 'company-b' }],
    projects: [{ id: 'project-a' }], currentCompany: { id: 'company-a' }, currentProject: { id: 'project-a' }, error: '',
  };
  const rendered = [];
  const shell = {
    state: () => active,
    selectCompany: async () => {
      active = { ...active, companies: [{ id: 'company-a' }, { id: 'company-b' }], projects: [{ id: 'project-b' }], currentCompany: { id: 'company-b' }, currentProject: { id: 'project-b' } };
    },
  };
  const flow = createDashboardContextFlow({ shell, renderState: (state) => rendered.push(state), renderSwitcher: () => {} });

  await flow.selectCompany('company-b');
  const result = flow.confirm();

  assert.equal(rendered[0].phase, 'loading');
  assert.equal(result.currentCompany.id, 'company-b');
  assert.equal(result.currentProject.id, 'project-b');
});

test('criação mantém o diálogo aberto até selecionar o projeto e mostra falha de seleção', async () => {
  let closeCalls = 0;
  let message = '';
  let resolveSelection;
  const pending = createProjectSubmission({
    createProject: async () => ({ id: 'project-a', name: 'Projeto novo' }),
    selectProject: () => new Promise((resolve) => (resolveSelection = resolve)),
    closeDialog: () => closeCalls++,
    showError: (next) => (message = next),
  });
  const completion = pending.submit({ name: 'Projeto novo', slug: 'projeto-novo' });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCalls, 0);
  resolveSelection();
  await completion;
  assert.equal(closeCalls, 1);
  assert.equal(message, '');

  const failed = createProjectSubmission({
    createProject: async () => ({ id: 'project-b', name: 'Projeto criado' }),
    selectProject: async () => { throw new Error('Não foi possível atualizar a sessão'); },
    closeDialog: () => closeCalls++,
    showError: (next) => (message = next),
  });
  await assert.rejects(() => failed.submit({ name: 'Projeto criado', slug: 'projeto-criado' }), /Projeto criado/);
  assert.equal(closeCalls, 1);
  assert.match(message, /foi criado, mas não foi possível selecioná-lo/);
});

test('navegação atualiza aria-current e a ação de projeto depende da capacidade', () => {
  const element = () => {
    const attributes = new Map();
    const classes = new Set();
    return {
      classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      attribute: (name) => attributes.get(name),
    };
  };
  const navigation = { home: element(), company: element(), pages: element(), forms: element() };

  applyDashboardNavigation(navigation, 'company');

  assert.equal(navigation.company.attribute('aria-current'), 'page');
  assert.equal(navigation.home.attribute('aria-current'), undefined);
  assert.equal(navigation.pages.attribute('aria-current'), undefined);
  assert.equal(canCreateProject({ can: (capability) => capability === 'project.manage' }), true);
  assert.equal(canCreateProject({ can: () => false }), false);
});
