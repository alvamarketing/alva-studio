import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDashboardNavigation, canCreateProject, createDashboardContextFlow, createMobileDrawerController, createProjectSubmission, dashboardModel, filterProjectContent, isProjectSlug, projectContentAction, projectOverviewModel } from '../public/studio-dashboard.js';

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

test('visão do projeto mostra somente o overview autorizado, estados e contagens reais', () => {
  const overview = {
    project: { id: 'project-a', name: 'Campanha real', slug: 'campanha-real' },
    counts: { pages: 2, forms: 1, publishedPages: 1, publishedForms: 0, submissions: 7 },
    content: [
      { id: 'page-a', kind: 'page', name: 'Página real', route: '/', published: true, updatedAt: '2026-09-04T12:00:00.000Z', submissionCount: 0 },
      { id: 'form-a', kind: 'form', name: 'Formulário real', route: '/diagnostico', published: false, updatedAt: '2026-09-04T11:00:00.000Z', submissionCount: 7 },
    ],
    domain: { domain: 'exemplo.com.br', verificationStatus: 'verified' },
    integrations: { vercel: 'configured', analytics: 'pending', agents: 'pending' },
  };

  const model = projectOverviewModel(overview);

  assert.equal(model.status, 'ready');
  assert.equal(model.title, 'Campanha real');
  assert.equal(model.domain.label, 'exemplo.com.br');
  assert.deepEqual(model.metrics, [
    ['Landing pages', 2], ['Formulários', 1], ['Publicados', 1], ['Respostas', 7],
  ]);
  assert.equal(model.content[0].status, 'Publicado');
  assert.equal(model.content[1].status, 'Rascunho');
  assert.equal(model.content[1].responses, 7);
  assert.deepEqual(filterProjectContent(model.content, 'pages').map((item) => item.id), ['page-a']);
  assert.deepEqual(filterProjectContent(model.content, 'forms').map((item) => item.id), ['form-a']);
  assert.deepEqual(model.modules, [
    ['Analytics', 'Ainda não configurado'], ['Rastreamento', 'Em breve'], ['Publicação', 'Configurado'], ['Agentes', 'Ainda não configurado'],
  ]);
});

test('visão do projeto separa carregamento, erro e projeto vazio', () => {
  assert.equal(projectOverviewModel(null, { phase: 'loading' }).status, 'loading');
  assert.equal(projectOverviewModel(null, { phase: 'error', error: 'Sem acesso' }).message, 'Sem acesso');
  const empty = projectOverviewModel({
    project: { id: 'project-empty', name: 'Vazio', slug: 'vazio' },
    counts: { pages: 0, forms: 0, publishedPages: 0, publishedForms: 0, submissions: 0 }, content: [], domain: null,
    integrations: { vercel: 'pending', analytics: 'pending', agents: 'pending' },
  });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.domain.label, 'Domínio ainda não verificado');
});

test('Projeto possui destinos, filtros, estado assíncrono e controles responsivos acessíveis', async () => {
  const [html, css, app] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(new URL('../public/styles.css', import.meta.url), 'utf8'), readFile(appPath, 'utf8')]);

  assert.match(html, /<section id="project-view"[^>]*aria-labelledby="project-view-title"/);
  assert.match(html, /id="project-content-filter"/);
  assert.match(html, /id="project-content-list"[^>]*aria-live="polite"/);
  assert.match(html, /id="mobile-menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="project-status"[^>]*role="status"/);
  assert.match(app, /api\(`\/projects\/\$\{state\.currentProject\.id\}\/overview`\)/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /#dashboard > aside\.is-open/);
  assert.match(css, /min-height:\s*44px/);
});

test('ações de conteúdo respeitam as capacidades de escrita por tipo', () => {
  const denied = { can: () => false };
  const page = { kind: 'page' };
  const form = { kind: 'form' };

  assert.equal(projectContentAction(denied, page), 'read');
  assert.equal(projectContentAction(denied, form), 'read');
  assert.equal(projectContentAction({ can: (capability) => capability === 'page.write' }, page), 'edit');
  assert.equal(projectContentAction({ can: (capability) => capability === 'form.write' }, form), 'edit');
});

test('drawer móvel remove controles fechados da navegação e prende Tab com retorno de foco', () => {
  const attributes = new Map();
  const classes = new Set();
  const drawer = {
    inert: false,
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const trigger = { focusCalls: 0, setAttribute: (name, value) => attributes.set(name, value), focus() { this.focusCalls++; } };
  const first = { focusCalls: 0, focus() { this.focusCalls++; } };
  const last = { focusCalls: 0, focus() { this.focusCalls++; } };
  let active = first;
  const controller = createMobileDrawerController({ drawer, trigger, focusable: () => [first, last], activeElement: () => active });

  controller.close({ returnFocus: false });
  assert.equal(drawer.inert, true);
  assert.equal(attributes.get('aria-hidden'), 'true');
  controller.open();
  assert.equal(drawer.inert, false);
  assert.equal(attributes.get('aria-hidden'), 'false');
  assert.equal(classes.has('is-open'), true);
  assert.equal(first.focusCalls, 1);
  const tab = { key: 'Tab', shiftKey: false, preventDefaultCalls: 0, preventDefault() { this.preventDefaultCalls++; } };
  active = last;
  controller.handleKeydown(tab);
  assert.equal(tab.preventDefaultCalls, 1);
  assert.equal(first.focusCalls, 2);
  active = first;
  const shiftTab = { key: 'Tab', shiftKey: true, preventDefaultCalls: 0, preventDefault() { this.preventDefaultCalls++; } };
  controller.handleKeydown(shiftTab);
  assert.equal(shiftTab.preventDefaultCalls, 1);
  assert.equal(last.focusCalls, 1);
  controller.handleKeydown({ key: 'Escape', preventDefault() {} });
  assert.equal(drawer.inert, true);
  assert.equal(classes.has('is-open'), false);
  assert.equal(trigger.focusCalls, 1);
});
