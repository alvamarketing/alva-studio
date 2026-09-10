import { flushChanges } from './save-cycle.js';
import { templates, getTemplate, normalizeForms, syncFormDelivery } from './templates.js';
import { buildPageExportHtml, createFriendlyEditor } from './editor-shell.js';
import { createOwnerUI } from './owner.js';
import { createUIPreferences } from './ui-preferences.js';
import { createStudioShell } from './studio-shell.js';
import { createStudioContextBoundary } from './studio-context-boundary.js';
import { createContextList } from './context-list.js';
import { analyticsMetricsModel, analyticsPanelModel, analyticsRangeParams, analyticsRankModel, journeyConnected, journeyLayout, trackingEventsModel, trackingHealthModel, trackingMetricsModel, trackingPageModel, applyDashboardNavigation, canCreateProject, createAuthenticatedApi, createDashboardProjectFlow, createLatestRequestGuard, createMobileDrawerController, createProjectSubmission, dashboardModel, filterProjectContent, secoesEscondidas, isProjectSlug, previewProjectContent, projectCardCounts, projectContentAction, projectOverviewModel, publicationModel, roleLabel } from './studio-dashboard.js';
import { createVslUI } from './vsl-ui.js';
import { leadsCsvUrl, leadsListModel, normalizeLeadRow } from './leads-ui.js';
import { createViewRouter, viewToRestore } from './view-route.js';
import { confirmarAcao } from './confirm-dialog.js';
import { conteudoDaLista, contagemDaLista, textosDaLista } from './quiz-mecanica.js';
const $ = (s) => document.querySelector(s);
createUIPreferences();
const viewRouter = createViewRouter({ onNavigate: ({ view, settingsTab }) => abrirView(view, { settingsTab, fromHistory: true }) });
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
// Quiz e landing page são a mesma coisa no editor; o que muda é a marca. Esta variável
// diz qual das duas a tela de conteúdo está mostrando agora.
let tipoDeConteudo = 'page';
let editor,
  page,
  pages = [],
  loading = false,
  dirty = false,
  change = 0,
  timer,
  toastTimer,
  saving,
  ownerUI,
  studioShell,
  dashboardContextFlow,
  dashboardStateOverride,
  projectSubmission,
  contextBoundary,
  companyOverviewRequest = 0,
  projectOverviewRequest = 0,
  leadsRequest = 0,
  projectContentFilter = 'all',
  leadsFormId = '',
  leadsSource = null,
  leadSources = [],
  leadForms = [],
  leadsRows = [],
  leadsNextCursor = null,
  mobileMenuTrigger,
  mobileDrawer,
  mediaPipelineEnabled = false,
  config = { vercelConnected: false };
const homeOverviewGuard = createLatestRequestGuard();
const analyticsPanelGuard = createLatestRequestGuard();
const authenticatedApi = createAuthenticatedApi({ request: fetch, onSessionExpired: () => ownerUI?.sessionExpired() });
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 6000);
}
async function api(path, method = 'GET', data) {
  return authenticatedApi.request(path, method, data);
}
function action(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      toast(error.message);
    }
  };
}
function setActiveNavigation(view) {
  const activeView = view;
  const navigation = {
    home: $('#nav-home'),
    projects: $('#nav-projects'),
    project: $('#nav-project'),
    pages: $('#nav-pages'),
    forms: $('#nav-forms'),
    analytics: $('#nav-project-analytics'),
    tracking: $('#nav-project-tracking'),
    publication: $('#nav-project-publication'),
    agents: $('#nav-project-agents'),
    settings: $('#app-settings'),
  };
  applyDashboardNavigation(Object.fromEntries(Object.entries(navigation).filter(([, element]) => element)), activeView);
}
function abrirView(view, options = {}) {
  if (view === 'pages') return void action(abrirPaginas)();
  if (view === 'forms') return void action(abrirFormularios)();
  if (view === 'analytics') return void action(abrirAnalytics)();
  if (view === 'tracking') return void action(abrirRastreamento)();
  if (view === 'agents') return void action(abrirAgentes)();
  if (view === 'publication') return void action(abrirPublicacao)();
  return setDashboardView(view, options);
}
function sidebarContextFor(view, hasProject = false) {
  if (view === 'home') return 'studio';
  return hasProject || ['project', 'pages', 'forms', 'vsl', 'analytics', 'tracking', 'agents', 'publication'].includes(view) ? 'project' : 'studio';
}
function syncSidebarContext(view) {
  const sidebar = $('#studio-sidebar');
  if (!sidebar) return;
  const hasProject = Boolean(studioShell?.state?.().currentProject);
  const context = sidebarContextFor(view, hasProject);
  sidebar.dataset.context = context;
  for (const group of sidebar.querySelectorAll('[data-sidebar-context]')) {
    group.hidden = group.dataset.sidebarContext !== context;
  }
  const canReadAnalytics = Boolean(studioShell?.can?.('analytics.read'));
  const canManageProject = Boolean(studioShell?.can?.('project.manage'));
  const analytics = $('#nav-project-analytics');
  const tracking = $('#nav-project-tracking');
  const publication = $('#nav-project-publication');
  const agents = $('#nav-project-agents');
  if (analytics) analytics.hidden = !hasProject || !canReadAnalytics;
  if (tracking) tracking.hidden = !hasProject || !canReadAnalytics;
  if (publication) publication.hidden = !hasProject;
  if (agents) agents.hidden = !hasProject || !canManageProject;
}
function updateVslNavigation() {
  const videosFilter = $('[data-project-filter="videos"]');
  if (videosFilter) {
    videosFilter.hidden = !mediaPipelineEnabled;
    if (videosFilter.hidden && projectContentFilter === 'videos') projectContentFilter = 'all';
  }
  // A tela de VSL existia sem nenhum caminho até ela: só chegava quem digitasse #/vsl.
  const navVsl = $('#nav-vsl');
  if (navVsl) navVsl.hidden = !mediaPipelineEnabled;
}
// O diálogo trata de dois assuntos. Quem vem do formulário quer o recebimento das
// respostas; quem vem do cabeçalho quer a página inteira.
function abrirConfiguracoesDaPagina(assunto = '') {
  $('#settings').click();
  if (assunto !== 'respostas') return;
  const alvo = $('#settings-respostas');
  alvo?.scrollIntoView({ block: 'start' });
  alvo?.querySelector('input')?.focus();
}
function setDashboardView(view, { settingsTab = 'account', fromHistory = false } = {}) {
  if (view === 'vsl' && !mediaPipelineEnabled) view = 'project';
  if (!fromHistory) viewRouter.commit(view, { settingsTab });
  const sections = {
    home: '#studio-home',
    company: '#company-view',
    history: '#history-view',
    settings: '#settings-view',
    project: '#project-view',
    pages: '#pages-view',
    // Quizzes mora na tela de páginas; a entrada continua separada só para a navegação e o
    // endereço não mudarem para quem já tem o link.
    forms: '#pages-view',
    vsl: '#vsl-view',
    analytics: '#analytics-view',
    tracking: '#tracking-view',
    agents: '#agents-view',
    publication: '#publication-view',
  };
  if (view !== 'settings') ownerUI?.closeSettings({ notify: false });
  for (const [selector, escondida] of Object.entries(secoesEscondidas(sections, view))) $(selector).hidden = escondida;
  closeMobileDrawer();
  syncSidebarContext(view);
  setActiveNavigation(view);
  updateVslNavigation();
  if (view === 'home') renderHome();
  if (view === 'history') renderHistory();
  if (view === 'settings') return ownerUI?.openSettings(settingsTab);
  if (view === 'company') renderCompany();
  if (view === 'project') return renderProject();
  if (view === 'vsl') vslUI.show();
}
function mobileDrawerActive() {
  return window.matchMedia('(max-width: 760px)').matches;
}
function closeMobileDrawer(options = { returnFocus: false }) {
  if (mobileDrawerActive()) {
    $('#studio-sidebar').classList.remove('is-open');
    $('#mobile-drawer-backdrop').hidden = true;
    mobileDrawer?.close(options);
  }
}
function dashboardState() {
  return dashboardStateOverride ?? studioShell.state();
}
function renderDashboardState(state) {
  dashboardStateOverride = state;
  const activeView = Object.entries({ home: '#studio-home', company: '#company-view', history: '#history-view', settings: '#settings-view', project: '#project-view', pages: '#pages-view', vsl: '#vsl-view' }).find(([, selector]) => !$(selector).hidden)?.[0] || 'home';
  syncSidebarContext(activeView);
  setActiveNavigation(activeView);
  updateVslNavigation();
  if (!$('#studio-home').hidden) renderHome();
  if (!$('#history-view').hidden) renderHistory();
  if (!$('#company-view').hidden) renderCompany();
  if (!$('#project-view').hidden) renderProject();
}
function clear(node) {
  node.replaceChildren();
  return node;
}
function emptyCard(title, text) {
  const element = document.createElement('div');
  element.className = 'dashboard-empty';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = text;
  element.append(heading, description);
  return element;
}
function relativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Atualização sem data';
  const minutes = Math.max(0, Math.round((Date.now() - date.valueOf()) / 60_000));
  if (minutes < 1) return 'Atualizado agora';
  if (minutes < 60) return `Atualizado há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Atualizado há ${hours} h`;
  return `Atualizado em ${date.toLocaleDateString('pt-BR')}`;
}
function renderHome() {
  if (!studioShell) return;
  updateVslNavigation();
  const state = dashboardState();
  const request = homeOverviewGuard.next();
  const context = state.currentCompany?.id || '';
  const model = dashboardModel(state);
  const displayName = $('#home-display-name');
  if (displayName) displayName.textContent = state.session?.user?.displayName || 'seja bem-vindo';
  const status = $('#studio-dashboard-status');
  status.textContent = model.message;
  status.dataset.state = model.status;
  $('#new-project').hidden = !canCreateProject(studioShell);
  const projects = clear($('#home-projects'));
  const activity = clear($('#home-activity'));
  if (model.status === 'loading') return;
  if (model.status === 'error') return;
  if (!model.projects.length && !canCreateProject(studioShell)) projects.append(emptyCard('Nenhum projeto disponível.', 'Peça acesso a um projeto da empresa atual.'));
  for (const project of model.projects) projects.append(projectCard(project));
  if (canCreateProject(studioShell)) projects.append(projectCreateCard());
  void Promise.all(model.projects.map(async (project) => {
    try {
      const overview = await api(`/projects/${project.id}/overview`);
      if (!homeOverviewGuard.isCurrent(request, context, studioShell.state().currentCompany?.id || '') || $('#studio-home').hidden) return;
      mediaPipelineEnabled = overview.runtime?.media === true;
      updateVslNavigation();
      project.counts = projectCardCounts(overview);
      const card = projects.querySelector(`[data-project-id="${project.id}"]`);
      updateProjectCardFromOverview(card, overview);
      if (card) for (const [key] of [['pages'], ['forms'], ['videos'], ['submissions'], ['published']]) {
        const amount = card.querySelector(`[data-count-key="${key}"]`);
        if (amount) amount.textContent = project.counts[key] === undefined ? '—' : String(project.counts[key]);
        const count = card.querySelector(`[data-count-key="${key}"]`)?.parentElement;
        if (count && key === 'videos') count.hidden = !mediaPipelineEnabled;
      }
    } catch {
      if (!homeOverviewGuard.isCurrent(request, context, studioShell.state().currentCompany?.id || '') || $('#studio-home').hidden) return;
      const card = projects.querySelector(`[data-project-id="${project.id}"]`);
      const unavailable = card?.querySelector('.project-card-counts-status');
      if (unavailable) {
        unavailable.hidden = false;
        unavailable.textContent = 'Contagens indisponíveis';
      }
    }
  }));
  if (!model.activity.length) activity.append(emptyCard('Ainda não há atividade.', 'As atualizações dos seus projetos aparecerão aqui.'));
  for (const project of model.activity) activity.append(activityItem(project));
}
async function renderHistory() {
  if (!studioShell) return;
  const model = dashboardModel(dashboardState());
  const status = $('#history-status');
  const list = clear($('#history-list'));
  status.textContent = model.message;
  status.dataset.state = model.status;
  if (model.status === 'loading' || model.status === 'error') return;
  const projects = model.activity;
  if (!projects.length) {
    list.append(emptyCard('Ainda não há histórico.', 'As atualizações dos seus projetos aparecerão aqui.'));
    return;
  }
  for (const project of projects) {
    list.append(activityItem(project));
  }
}
function projectCard(project) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'studio-project-card';
  button.dataset.projectId = project.id;
  const identity = document.createElement('div');
  identity.className = 'project-card-identity';
  const icon = document.createElement('span');
  icon.className = 'project-icon material-symbols-outlined';
  icon.textContent = 'folder_special';
  const name = document.createElement('strong');
  name.textContent = project.name;
  const domain = document.createElement('span');
  domain.className = 'project-card-domain';
  domain.textContent = project.domain || 'Domínio pendente';
  const state = document.createElement('span');
  state.className = 'project-card-state';
  state.textContent = 'Carregando estado';
  identity.append(icon, name, domain, state);
  const counts = document.createElement('div');
  counts.className = 'project-card-counts';
  for (const [key, label] of [['pages', 'Páginas'], ['forms', 'Quizzes'], ['videos', 'VSL'], ['submissions', 'Leads'], ['published', 'No ar']]) {
    const value = document.createElement('span');
    const amount = document.createElement('strong');
    amount.dataset.countKey = key;
    amount.textContent = project.counts?.[key] === undefined ? '—' : String(project.counts[key]);
    value.append(amount, label);
    if (key === 'videos' && mediaPipelineEnabled === false) value.hidden = true;
    counts.append(value);
  }
  const unavailable = document.createElement('span');
  unavailable.className = 'project-card-counts-status';
  unavailable.hidden = true;
  unavailable.setAttribute('role', 'status');
  counts.append(unavailable);
  button.append(identity, counts);
  button.onclick = action(() => selectProject(project.id));
  return button;
}
function projectCreateCard() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'studio-project-card project-create-card';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined project-icon';
  icon.textContent = 'add';
  const title = document.createElement('strong');
  title.textContent = 'Criar projeto';
  const detail = document.createElement('span');
  detail.textContent = 'Comece uma nova experiência';
  button.append(icon, title, detail);
  button.onclick = () => $('#new-project').click();
  return button;
}
function updateProjectCardFromOverview(card, overview) {
  if (!card) return;
  const domain = card.querySelector('.project-card-domain');
  const state = card.querySelector('.project-card-state');
  if (domain) domain.textContent = overview.domain?.domain || 'Domínio pendente';
  const published = projectCardCounts(overview).published;
  if (state) {
    state.textContent = published > 0 ? 'No ar' : 'Em rascunho';
    state.dataset.state = published > 0 ? 'published' : 'draft';
  }
}
function activityItem(project) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'activity-item';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined activity-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'history';
  const details = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = project.name;
  const context = document.createElement('span');
  context.textContent = 'Atualização do projeto';
  details.append(name, context);
  const date = document.createElement('span');
  date.className = 'activity-date';
  date.textContent = relativeDate(project.updatedAt);
  item.append(icon, details, date);
  item.onclick = action(() => selectProject(project.id));
  return item;
}
async function selectProject(projectId) {
  await studioShell.selectProject(projectId);
  projectContentFilter = 'all';
  await setDashboardView('project');
}
function renderCompanyOverview(overview, { content = $('#company-content'), title = $('#company-view-title'), role = $('#company-role'), billing = null } = {}) {
  clear(content);
  if (title) title.textContent = overview.company.name;
  if (role) role.textContent = `Seu papel: ${roleLabel(overview.role)}`;
  const details = document.createElement('section');
  details.className = 'company-overview-section';
  const detailsTitle = document.createElement('h2');
  detailsTitle.textContent = 'Visão geral';
  const counts = document.createElement('div');
  counts.className = 'company-counts';
  for (const [label, value] of [['Projetos', overview.counts.projects], ['Páginas', overview.counts.pages], ['Formulários', overview.counts.forms], ['Respostas', overview.counts.submissions]]) {
    const count = document.createElement('div');
    const amount = document.createElement('strong');
    amount.textContent = String(value ?? 0);
    const caption = document.createElement('span');
    caption.textContent = label;
    count.append(amount, caption);
    counts.append(count);
  }
  details.append(detailsTitle, counts);
  const projects = document.createElement('section');
  projects.className = 'company-overview-section';
  const projectsTitle = document.createElement('h2');
  projectsTitle.textContent = 'Projetos';
  const projectsList = document.createElement('div');
  projectsList.className = 'project-grid';
  if (!overview.projects.length) projectsList.append(emptyCard('Nenhum projeto disponível.', 'Os projetos autorizados aparecerão aqui.'));
  for (const project of overview.projects) projectsList.append(projectCard(project));
  projects.append(projectsTitle, projectsList);
  content.append(details, projects);
  if (overview.members) {
    const team = document.createElement('section');
    team.className = 'company-overview-section';
    const teamTitle = document.createElement('h2');
    teamTitle.textContent = 'Equipe';
    const list = document.createElement('div');
    list.className = 'member-list';
    if (!overview.members.length) list.append(emptyCard('Nenhuma pessoa na equipe.', 'Os membros ativos aparecerão aqui.'));
    for (const member of overview.members) {
      const item = document.createElement('div');
      item.className = 'member-item';
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.displayName || member.email;
      const email = document.createElement('span');
      email.textContent = member.email;
      identity.append(name, email);
      const role = document.createElement('span');
      role.className = 'role-chip';
      role.textContent = roleLabel(member.role);
      item.append(identity, role);
      list.append(item);
    }
    team.append(teamTitle, list);
    content.append(team);
  }
  const billingCard = document.createElement('section');
  billingCard.className = 'company-overview-section company-future';
  const billingTitle = document.createElement('h2');
  billingTitle.textContent = 'Plano e cobrança';
  const billingText = document.createElement('p');
  const entitlement = billing?.entitlement;
  const limits = entitlement?.limits || { projects: 5, members: 10, domains: 5 };
  const period = entitlement?.currentPeriodEnd ? new Date(entitlement.currentPeriodEnd).toLocaleDateString('pt-BR') : '';
  billingText.textContent = entitlement?.status === 'active'
    ? `Plano ativo · renova até ${period}`
    : entitlement?.status === 'cancel_at_period_end'
      ? `Cancelamento agendado · acesso até ${period}`
      : 'Plano mensal para publicar e crescer com a equipe.';
  const billingLimits = document.createElement('div');
  billingLimits.className = 'company-counts';
  for (const [label, value] of [['Projetos', limits.projects], ['Membros', limits.members], ['Domínios', limits.domains]]) {
    const item = document.createElement('div');
    const amount = document.createElement('strong');
    amount.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    item.append(amount, caption);
    billingLimits.append(item);
  }
  billingCard.append(billingTitle, billingText, billingLimits);
  if (studioShell?.can?.('billing.manage')) {
    const checkout = document.createElement('button');
    checkout.type = 'button';
    checkout.className = 'primary';
    checkout.textContent = 'Abrir checkout';
    checkout.onclick = action(async () => {
      checkout.disabled = true;
      const companyId = studioShell.state().currentCompany?.id || 'current';
      const storageKey = `alva.billing.checkout.${companyId}.${billing?.environment || 'sandbox'}`;
      const stored = (() => {
        try {
          const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
          return value?.key && value.createdAt > Date.now() - 65 * 60_000 ? value.key : null;
        } catch { return null; }
      })();
      const idempotencyKey = stored || globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}`;
      try { localStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, createdAt: Date.now() })); } catch {}
      const result = await api('/billing/checkout', 'POST', { idempotencyKey });
      if (!result.checkoutUrl) throw new Error('O checkout ainda está sendo preparado. Tente novamente em instantes.');
      window.location.assign(result.checkoutUrl);
    });
    billingCard.append(checkout);
    if (entitlement?.status === 'active') {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancelar renovação';
      cancel.onclick = action(async () => {
        if (!await confirmarAcao({ titulo: 'Cancelar a renovação?', descricao: 'O acesso continua até o fim do período já pago.', confirmar: 'Cancelar renovação', cancelar: 'Manter assinatura', perigo: true })) return;
        await api('/billing/cancel', 'POST');
        await renderCompany();
      });
      billingCard.append(cancel);
    }
  }
  content.append(billingCard);
}
async function renderCompany() {
  if (!studioShell) return;
  const state = dashboardState();
  const status = $('#company-status');
  const content = clear($('#company-content'));
  if (state.phase === 'loading') {
    $('#company-view-title').textContent = 'Empresa';
    $('#company-role').textContent = 'Carregando empresa…';
    status.textContent = 'Carregando empresa…';
    status.dataset.state = 'loading';
    return;
  }
  if (state.phase === 'error' || !state.currentCompany) {
    $('#company-view-title').textContent = 'Empresa';
    $('#company-role').textContent = '';
    status.textContent = state.error || 'Não foi possível carregar a empresa atual.';
    status.dataset.state = 'error';
    return;
  }
  const request = ++companyOverviewRequest;
  status.textContent = 'Carregando empresa…';
  status.dataset.state = 'loading';
  try {
    const [overview, billing] = await Promise.all([
      api(`/companies/${state.currentCompany.id}/overview`),
      api('/billing').catch(() => null),
    ]);
    if (request !== companyOverviewRequest || state.currentCompany.id !== studioShell.state().currentCompany?.id) return;
    status.textContent = '';
    status.dataset.state = overview.projects.length ? 'ready' : 'empty';
    renderCompanyOverview(overview, { billing });
  } catch (error) {
    if (request !== companyOverviewRequest) return;
    status.textContent = error.message || 'Não foi possível carregar a empresa.';
    status.dataset.state = 'error';
    content.append(emptyCard('Não foi possível carregar a empresa.', 'Tente novamente em instantes.'));
  }
}
function markDirty() {
  if (loading) return;
  dirty = true;
  change++;
  $('#save-state').textContent = 'Alterações por salvar';
  clearTimeout(timer);
  timer = setTimeout(() => save().catch((e) => toast(e.message)), 1500);
}
function exportHtml() {
  return buildPageExportHtml({
    title: $('#page-name').value.trim(),
    css: editor.getCss(),
    html: editor.getHtml(),
    js: editor.getJs(),
    publicOrigin: window.location.origin,
    // O que separa o quiz da landing na publicação é esta marca: com ela o HTML sai com o
    // script que mostra uma etapa por vez.
    quiz: page?.kind === 'quiz',
  });
}
function projectEmpty(title, text) {
  const element = document.createElement('div');
  element.className = 'dashboard-empty';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = text;
  element.append(heading, detail);
  return element;
}
function updateLeadsFilter() {
  const leadsFilter = $('[data-project-filter="leads"]');
  if (!leadsFilter) return;
  leadsFilter.hidden = !studioShell?.can?.('submission.read');
  if (leadsFilter.hidden && projectContentFilter === 'leads') projectContentFilter = 'all';
}
function updateConversionsFilter() {
  const conversionsFilter = $('[data-project-filter="conversions"]');
  if (!conversionsFilter) return;
  conversionsFilter.hidden = !studioShell?.can?.('analytics.read');
  if (conversionsFilter.hidden && projectContentFilter === 'conversions') projectContentFilter = 'all';
}
async function renderProjectConversions(state) {
  const list = clear($('#project-content-list'));
  $('#project-leads-controls').hidden = true;
  if (!state.currentProject || !studioShell?.can?.('analytics.read')) return;
  list.append(projectEmpty('Carregando conversões…', 'Aguarde enquanto buscamos o status das entregas.'));
  try {
    const rows = await api(`/projects/${state.currentProject.id}/conversions`);
    if (projectContentFilter !== 'conversions' || state.currentProject.id !== dashboardState().currentProject?.id) return;
    clear(list);
    if (!rows.length) return list.append(projectEmpty('Nenhuma conversão enviada.', 'As conversões confirmadas aparecerão aqui.'));
    for (const row of rows) {
      const status = String(row.status || '').toLowerCase();
      const statusLabel = { delivered: 'Entregue', retry: 'Nova tentativa', dead: 'Encerrada' }[status] || 'Processando';
      const item = document.createElement('article'); item.className = `project-content-row conversion-row conversion-status-${status || 'pending'}`;
      item.setAttribute('aria-label', `Conversão ${row.eventName || 'evento'} · ${row.environment || 'ambiente'} · ${statusLabel}`);
      const icon = document.createElement('span'); icon.className = 'project-content-icon'; icon.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('i'); glyph.className = 'material-symbols-outlined'; glyph.textContent = 'conversion_path'; icon.append(glyph);
      const content = document.createElement('div'); content.className = 'conversion-content';
      const title = document.createElement('strong'); title.textContent = row.eventName || 'Evento';
      const detail = document.createElement('span'); detail.textContent = row.environment === 'production' ? 'Produção' : 'Prévia';
      content.append(title, detail);
      const state = document.createElement('span'); state.className = 'conversion-state'; state.textContent = `${statusLabel} · tentativa ${row.attemptCount ?? 0}`;
      item.append(icon, content, state);
      if (row.lastError) { const error = document.createElement('small'); error.className = 'conversion-error'; error.textContent = row.lastError; item.append(error); }
      list.append(item);
    }
  } catch (error) { clear(list); list.append(projectEmpty('Não foi possível carregar conversões.', error.message)); }
}
function renderLeadsControls(projectId) {
  const controls = $('#project-leads-controls');
  const form = $('#project-leads-form');
  const knownSources = new Map();
  const addSource = (source) => {
    const sourceKind = source?.sourceKind || 'form';
    const sourceId = source?.sourceId || source?.formId || '';
    if (!sourceId) return;
    const captureId = source?.captureId || '';
    const key = JSON.stringify({ sourceKind, sourceId, captureId });
    if (!knownSources.has(key)) knownSources.set(key, {
      sourceKind, sourceId, captureId,
      sourceName: source?.sourceName || source?.formName || '',
      sourcePath: source?.sourcePath || '', captureName: source?.captureName || '',
    });
  };
  for (const source of leadSources) addSource(source);
  for (const source of leadForms) addSource({ sourceKind: 'form', sourceId: source.id, sourceName: source.name });
  for (const row of leadsRows) addSource(row);
  const pageSourceCounts = new Map();
  for (const source of knownSources.values()) {
    if (source.sourceKind === 'page' && !source.captureName) pageSourceCounts.set(source.sourceId, (pageSourceCounts.get(source.sourceId) || 0) + 1);
  }
  const pageSourceIndexes = new Map();
  form.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Todas as origens';
  form.append(all);
  for (const [key, source] of knownSources) {
    const option = document.createElement('option');
    option.value = key;
    const kind = source.sourceKind === 'page' ? 'Landing page' : 'Quiz';
    const name = source.sourceName || (source.sourceKind === 'page' ? 'Página sem nome' : 'Quiz sem nome');
    let capture = source.captureName || '';
    if (!capture && source.sourceKind === 'page') {
      const index = (pageSourceIndexes.get(source.sourceId) || 0) + 1;
      pageSourceIndexes.set(source.sourceId, index);
      capture = pageSourceCounts.get(source.sourceId) > 1 ? `Formulário da página ${index}` : 'Formulário da página';
    }
    option.textContent = [kind, name, source.sourcePath, capture].filter(Boolean).join(' · ');
    form.append(option);
  }
  form.value = leadsSource ? JSON.stringify(leadsSource) : (leadsFormId ? JSON.stringify({ sourceKind: 'form', sourceId: leadsFormId, captureId: '' }) : '');
  const exportLink = $('#project-leads-export');
  const selectedSource = leadsSource || (leadsFormId ? { sourceKind: 'form', sourceId: leadsFormId } : null);
  exportLink.href = leadsCsvUrl(projectId, selectedSource);
  exportLink.hidden = !selectedSource?.sourceId;
  $('#project-leads-next').hidden = !leadsNextCursor;
  controls.hidden = false;
}
function renderLeadRows(projectId) {
  const list = clear($('#project-content-list'));
  renderLeadsControls(projectId);
  if (!leadsRows.length) {
    list.append(projectEmpty('Nenhum lead encontrado.', leadsSource || leadsFormId ? 'Esta origem ainda não recebeu respostas.' : 'As respostas dos seus formulários e landing pages aparecerão aqui.'));
    return;
  }
  for (const row of leadsRows) list.append(createLeadRow(row));
}
function leadsResponseIsCurrent(request, state) {
  const current = studioShell.state();
  return request === leadsRequest
    && projectContentFilter === 'leads'
    && state.currentProject?.id === current.currentProject?.id
    && state.currentCompany?.id === current.currentCompany?.id;
}
function legacyLeadSources(overview, rows) {
  const sources = [];
  for (const item of overview?.content || []) if (item.kind === 'form') sources.push({ sourceKind: 'form', sourceId: item.id, sourceName: item.name });
  for (const row of rows) if (row.formId) sources.push({ sourceKind: 'form', sourceId: row.formId, sourceName: row.formName });
  return sources;
}
async function loadProjectLeads({ append = false } = {}) {
  const state = dashboardState();
  if (!state.currentProject || !studioShell?.can?.('submission.read')) return;
  const request = ++leadsRequest;
  const cursor = append ? leadsNextCursor : null;
  const params = new URLSearchParams({ limit: '25' });
  if (leadsSource?.sourceKind && leadsSource.sourceId) {
    params.set('sourceKind', leadsSource.sourceKind);
    params.set('sourceId', leadsSource.sourceId);
    if (leadsSource.captureId) params.set('captureId', leadsSource.captureId);
  } else if (leadsFormId) params.set('formId', leadsFormId);
  if (cursor) params.set('cursor', cursor);
  const list = clear($('#project-content-list'));
  if (append) for (const row of leadsRows) list.append(createLeadRow(row));
  else list.append(projectEmpty('Carregando leads…', 'Aguarde enquanto buscamos as respostas do projeto.'));
  $('#project-leads-controls').hidden = false;
  try {
    const [result, overview] = await Promise.all([
      api(`/projects/${state.currentProject.id}/leads?${params}`),
      api(`/projects/${state.currentProject.id}/overview`).catch(() => null),
    ]);
    if (!leadsResponseIsCurrent(request, state)) return;
    const payload = result.projectSubmissions || result;
    const rows = (payload.items || []).map(normalizeLeadRow);
    leadsRows = append ? [...leadsRows, ...rows] : rows;
    leadForms = (overview?.content || []).filter((item) => item.kind === 'form');
    if (Array.isArray(payload.sources) && payload.sources.length) leadSources = payload.sources;
    else if (!leadSources.length) leadSources = legacyLeadSources(overview, rows);
    leadsNextCursor = payload.nextCursor || null;
    renderLeadRows(state.currentProject.id);
    const model = leadsListModel({ rows: leadsRows });
    $('#project-status').dataset.state = model.status;
    $('#project-status').textContent = model.message;
  } catch (error) {
    if (!leadsResponseIsCurrent(request, state)) return;
    leadsRows = [];
    leadsNextCursor = null;
    clear($('#project-content-list')).append(projectEmpty('Não foi possível carregar os leads.', error.message));
    const model = leadsListModel({ phase: 'error', error: error.message });
    $('#project-status').dataset.state = model.status;
    $('#project-status').textContent = model.message;
    renderLeadsControls(state.currentProject.id);
  }
}
function createLeadRow(row) {
  const item = document.createElement('article');
  item.className = 'project-lead-row';
  const header = document.createElement('header');
  const source = document.createElement('strong');
  const sourceName = row.sourceName || row.formName || (row.sourceKind === 'page' ? 'Landing page' : 'Quiz');
  source.textContent = row.sourcePath ? `${sourceName} · ${row.sourcePath}` : sourceName;
  const context = document.createElement('span');
  context.textContent = row.captureName || (row.sourceKind === 'page' ? 'Formulário da página' : 'Quiz');
  const submittedAt = document.createElement('span');
  const parsedDate = row.submittedAt ? new Date(row.submittedAt) : null;
  submittedAt.textContent = parsedDate && !Number.isNaN(parsedDate.valueOf())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(parsedDate)
    : 'Data não informada';
  const delivery = document.createElement('span');
  delivery.textContent = row.deliveryLabel;
  header.append(source, context, submittedAt, delivery);
  const answers = document.createElement('dl');
  for (const answer of row.answers) {
    const field = document.createElement('dt');
    field.textContent = answer.field;
    const value = document.createElement('dd');
    value.textContent = answer.value;
    answers.append(field, value);
  }
  item.append(header, answers);
  return item;
}
function renderProjectLeads(state) {
  const status = $('#project-status');
  const list = clear($('#project-content-list'));
  clear($('#project-metrics'));
  clear($('#project-modules'));
  if (!studioShell?.can?.('submission.read')) {
    $('#project-leads-controls').hidden = true;
    status.dataset.state = 'error';
    status.textContent = 'Você não tem permissão para visualizar leads.';
    list.append(projectEmpty('Leads indisponíveis.', status.textContent));
    return;
  }
  if (!state.currentProject) {
    $('#project-leads-controls').hidden = true;
    status.dataset.state = 'empty';
    status.textContent = 'Escolha ou crie um projeto para continuar.';
    list.append(projectEmpty('Nenhum projeto selecionado.', status.textContent));
    return;
  }
  const model = leadsListModel({ phase: 'loading' });
  status.dataset.state = model.status;
  status.textContent = model.message;
  $('#project-view-title').textContent = state.currentProject.name || 'Projeto';
  $('#project-slug').textContent = '';
  void loadProjectLeads();
}
function renderProjectContent(model) {
  const list = clear($('#project-content-list'));
  const content = previewProjectContent(filterProjectContent(model.content, projectContentFilter));
  if (!content.length) {
    const label = projectContentFilter === 'pages' ? 'página' : projectContentFilter === 'forms' ? 'quiz' : projectContentFilter === 'videos' ? 'VSL' : 'conteúdo';
    list.append(projectEmpty(`Nenhum ${label} disponível.`, projectContentFilter === 'all' ? 'Crie uma página ou quiz para começar.' : 'Mude o filtro ou crie um novo conteúdo.'));
    return;
  }
  for (const item of content) {
    const row = document.createElement('article');
    row.className = 'project-content-row';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined project-content-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.kind === 'page' ? 'web' : item.kind === 'video' ? 'play_circle' : 'dynamic_form';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.textContent = `${item.route || '/'} · ${item.status}${item.kind === 'form' ? ` · ${item.responses} ${item.responses === 1 ? 'resposta' : 'respostas'}` : ''}`;
    details.append(name, meta);
    if (item.published) {
      const live = document.createElement('span');
      live.className = 'status-pill project-content-live';
      const liveIcon = document.createElement('span');
      liveIcon.className = 'material-symbols-outlined';
      liveIcon.setAttribute('aria-hidden', 'true');
      liveIcon.textContent = 'check_circle';
      live.append(liveIcon, 'No ar');
      row.append(icon, details, live);
    } else if (projectContentAction(studioShell, item) === 'edit') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'project-content-open';
      edit.textContent = 'Continuar';
      edit.onclick = action(() => {
        if (item.kind === 'video') { setDashboardView('vsl'); return vslUI.editById(item.id); }
        // Quiz e página abrem o mesmo editor; a marca só decide de qual lista ele veio.
        tipoDeConteudo = item.kind === 'form' ? 'quiz' : 'page';
        return openPage(item.id);
      });
      row.append(icon, details, edit);
    } else {
      const readOnly = document.createElement('span');
      readOnly.className = 'project-content-read-only';
      readOnly.textContent = 'Somente leitura';
      row.append(icon, details, readOnly);
    }
    list.append(row);
  }
}
function renderProjectOverview(overview) {
  const model = projectOverviewModel(overview);
  $('#project-view-title').textContent = model.title;
  $('#project-slug').textContent = model.slug ? `/${model.slug}` : 'Projeto selecionado';
  const domain = $('#project-domain');
  domain.textContent = model.domain.label;
  domain.dataset.state = model.domain.state;
  const metrics = clear($('#project-metrics'));
  for (const metric of model.metrics) {
    const item = document.createElement('div');
    const caption = document.createElement('span');
    caption.textContent = metric.label;
    const value = document.createElement('strong');
    value.textContent = metric.value;
    const detail = document.createElement('small');
    detail.textContent = metric.detail;
    item.append(caption, value, detail);
    if (metric.label === 'LEADS' && studioShell?.can?.('submission.read')) {
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.setAttribute('aria-label', `Abrir Leads do projeto (${metric.value})`);
      item.onclick = () => selectProjectContentFilter('leads');
      item.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectProjectContentFilter('leads');
      };
    }
    metrics.append(item);
  }
  const modules = clear($('#project-modules'));
  const structureStatus = $('#project-structure-status');
  structureStatus.textContent = `${model.structureComplete}/${model.structureTotal}`;
  structureStatus.dataset.state = model.structureComplete === model.structureTotal ? 'complete' : 'pending';
  for (const structure of model.structure) {
    const item = document.createElement('div');
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined project-structure-icon';
    icon.textContent = structure.icon;
    const details = document.createElement('div');
    const nameNode = document.createElement('strong');
    nameNode.textContent = structure.label;
    const detailNode = document.createElement('small');
    detailNode.textContent = structure.detail;
    const stateNode = document.createElement('span');
    stateNode.textContent = structure.state;
    stateNode.className = 'project-structure-state';
    stateNode.dataset.state = ['Ativo', 'Conectada', 'Conectados'].includes(structure.state) ? 'ready' : 'pending';
    details.append(nameNode, detailNode);
    item.append(icon, details, stateNode);
    modules.append(item);
  }
  for (const button of $('#project-content-filter').querySelectorAll('button')) {
    if (button.dataset.projectFilter === projectContentFilter) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (projectContentFilter === 'all') $('#project-content-all').setAttribute('aria-current', 'page');
  else $('#project-content-all').removeAttribute('aria-current');
  renderProjectContent(model);
}
function formatMcpKeyDate(value) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : 'sem data';
}
function mcpKeyRow(key, projectId) {
  const row = document.createElement('article');
  row.className = 'project-content-row';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined project-content-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'key';
  const details = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = key.name;
  const meta = document.createElement('span');
  meta.textContent = `${key.prefix}… · expira em ${formatMcpKeyDate(key.expiresAt)}${key.lastUsedAt ? ' · em uso' : ''}${key.revokedAt ? ' · revogada' : ''}`;
  details.append(name, meta);
  row.append(icon, details);
  if (!key.revokedAt) {
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'project-content-open';
    revoke.textContent = 'Revogar';
    revoke.onclick = action(async () => {
      if (!await confirmarAcao({ titulo: `Revogar a chave “${key.name}”?`, descricao: 'Agentes conectados perdem acesso imediatamente.', confirmar: 'Revogar chave', perigo: true })) return;
      await api(`/projects/${projectId}/mcp/keys/${key.id}`, 'DELETE', {});
      toast('Chave MCP revogada.');
      await renderMcpKeys(projectId);
    });
    row.append(revoke);
  }
  return row;
}
async function renderMcpKeys(projectId) {
  const section = $('#project-agent-keys');
  if (!section) return;
  const allowed = Boolean(studioShell?.can?.('project.manage'));
  section.hidden = !allowed;
  if (!allowed) return;
  const list = clear($('#mcp-key-list'));
  const status = $('#mcp-key-status');
  status.textContent = 'Carregando chaves…';
  try {
    const keys = await api(`/projects/${projectId}/mcp/keys`);
    if (studioShell.state().currentProject?.id !== projectId) return;
    status.textContent = keys.length ? '' : 'Nenhuma chave MCP criada neste projeto.';
    for (const key of keys) list.append(mcpKeyRow(key, projectId));
  } catch (error) {
    status.textContent = error.message || 'Não foi possível carregar as chaves MCP.';
  }
}
function renderPublication(overview, publication = {}) {
  const configured = publication.integration?.connectionStatus === 'configured' || overview.integrations?.vercel === 'configured';
  const publishedRoutes = (overview.content || []).filter((item) => item.published);
  const model = publicationModel({ connectionStatus: configured ? 'configured' : 'pending', run: publication.run, routes: publishedRoutes, canPublish: studioShell.can('deployment.publish') });
  $('#publication-state').textContent = model.label;
  $('#publication-state').dataset.state = model.state;
  $('#publication-routes').textContent = publishedRoutes.length
    ? `${publishedRoutes.length} ${publishedRoutes.length === 1 ? 'rota publicada' : 'rotas publicadas'}: ${publishedRoutes.map((item) => item.route).join(', ')}`
    : 'Nenhuma rota publicada ainda.';
  $('#publication-summary').textContent = model.publishMessage || (configured
    ? 'Prévia e produção enviam todas as rotas publicadas deste projeto juntas.'
    : 'Conecte a Vercel uma vez para publicar todas as rotas deste projeto juntas.');
  $('#publication-preview').disabled = !model.canPreview;
  $('#publication-production').disabled = !model.canProduction;
  $('#publication-domain-form').hidden = !model.canProduction || !studioShell.can('integration.manage');
  const connection = $('#publication-connection-form');
  connection.elements.vercelProjectId.value = publication.integration?.vercelProjectId || '';
}
function paintAnalyticsPanel(model) {
  const card = $('#analytics-panel');
  if (!card) return;
  card.hidden = model.phase === 'hidden';
  if (card.hidden) return;
  const status = $('#analytics-status');
  const chart = $('#analytics-chart');
  const journey = $('#analytics-journey');
  const analyticsUpdated = $('#analytics-updated');
  if (analyticsUpdated) analyticsUpdated.textContent = model.updatedLabel || 'Origem dos dados indisponível';
  const messages = { loading: 'Carregando visitas…', error: model.message, empty: 'Ainda não há visitas neste período.' };
  status.textContent = messages[model.phase] || '';
  status.dataset.state = model.phase;
  chart.hidden = model.phase !== 'ready' && model.phase !== 'empty';
  journey.hidden = model.phase !== 'ready' || model.funnel.length === 0;
  clear(chart);
  for (const bar of model.bars) {
    const barNode = document.createElement('i');
    barNode.style.height = `${bar.altura}%`;
    const label = `${bar.dia || 'Dia sem data'}: ${bar.visitas} ${bar.visitas === 1 ? 'visita' : 'visitas'}`;
    barNode.setAttribute('aria-label', label);
    barNode.title = label;
    chart.append(barNode);
  }
  clear(journey);
  model.funnel.forEach((step, index) => {
    if (index > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'material-symbols-outlined';
      arrow.textContent = 'arrow_forward';
      journey.append(arrow);
    }
    const span = document.createElement('span');
    span.textContent = typeof step === 'string' ? step : step.label;
    journey.append(span);
  });
}
function updateProjectAnalyticsMetrics(summary) {
  const visitors = Number(summary?.visitors);
  if (!Object.hasOwn(summary || {}, 'visitors') || !Number.isFinite(visitors)) return;
  const metrics = $('#project-metrics');
  const cards = metrics?.children;
  if (!cards || cards.length < 4) return;
  const submissions = Number(String(cards[1].querySelector('strong')?.textContent || '').replace(/\D/g, '') || 0);
  cards[0].querySelector('strong').textContent = new Intl.NumberFormat('pt-BR').format(visitors);
  cards[0].querySelector('small').textContent = 'Nos últimos 7 dias';
  cards[2].querySelector('strong').textContent = visitors > 0 ? `${(submissions / visitors * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
  cards[2].querySelector('small').textContent = visitors > 0 ? 'Leads por visitante' : 'Sem visitas para calcular';
}
async function renderAnalyticsPanel(projectId) {
  const canRead = Boolean(studioShell?.can?.('analytics.read'));
  if (!canRead) return paintAnalyticsPanel(analyticsPanelModel(null, { canRead }));
  const request = analyticsPanelGuard.next();
  paintAnalyticsPanel(analyticsPanelModel(null, { phase: 'loading', canRead }));
  try {
    const { from, to } = analyticsRangeParams();
    const summary = await api(`/projects/${projectId}/analytics/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!analyticsPanelGuard.isCurrent(request, projectId, dashboardState().currentProject?.id)) return;
    updateProjectAnalyticsMetrics(summary);
    paintAnalyticsPanel(analyticsPanelModel(summary, { canRead }));
  } catch (error) {
    if (!analyticsPanelGuard.isCurrent(request, projectId, dashboardState().currentProject?.id)) return;
    paintAnalyticsPanel(analyticsPanelModel(null, { phase: 'error', error: error.message, canRead }));
  }
}
async function renderProject() {
  if (!studioShell) return;
  leadsRequest += 1;
  updateLeadsFilter();
  updateConversionsFilter();
  const projectView = $('#project-view');
  if (projectContentFilter === 'leads') projectView.dataset.contentView = 'leads';
  else delete projectView.dataset.contentView;
  $('#project-content-title').textContent = projectContentFilter === 'leads' ? 'Leads do projeto' : 'Conteúdos do projeto';
  $('#project-content-all').textContent = projectContentFilter === 'leads' ? 'Voltar aos conteúdos' : 'Ver todos';
  const state = dashboardState();
  $('#project-create-action').hidden = !canCreateProject(studioShell);
  $('#open-analytics').hidden = !studioShell?.can?.('analytics.read');
  $('#analytics-panel').hidden = true;
  if (projectContentFilter === 'leads') return renderProjectLeads(state);
  if (projectContentFilter === 'conversions') return renderProjectConversions(state);
  const status = $('#project-status');
  $('#project-leads-controls').hidden = true;
  const list = clear($('#project-content-list'));
  clear($('#project-metrics'));
  clear($('#project-modules'));
  if (state.phase === 'loading') {
    status.dataset.state = 'loading';
    status.textContent = 'Carregando projeto…';
    $('#project-view-title').textContent = 'Projeto';
    $('#project-slug').textContent = '';
    list.append(projectEmpty('Carregando conteúdos…', 'Aguarde enquanto preparamos o projeto.'));
    return;
  }
  if (!state.currentProject) {
    const model = projectOverviewModel(null, { phase: 'empty' });
    status.dataset.state = model.status;
    status.textContent = model.message;
    $('#project-view-title').textContent = 'Projeto';
    $('#project-slug').textContent = '';
    list.append(projectEmpty('Nenhum projeto selecionado.', model.message));
    return;
  }
  const request = ++projectOverviewRequest;
  status.dataset.state = 'loading';
  status.textContent = 'Carregando projeto…';
  $('#project-view-title').textContent = state.currentProject.name || 'Projeto';
  $('#project-slug').textContent = '';
  try {
    const [overview, publication] = await Promise.all([
      api(`/projects/${state.currentProject.id}/overview`),
      api(`/projects/${state.currentProject.id}/publication`).catch(() => ({})),
    ]);
    if (request !== projectOverviewRequest || state.currentProject.id !== studioShell.state().currentProject?.id) return;
    const model = projectOverviewModel(overview);
    mediaPipelineEnabled = overview.runtime?.media === true;
    updateVslNavigation();
    status.dataset.state = model.status;
    status.textContent = model.message;
    renderProjectOverview(overview);
    renderPublication(overview, publication);
    renderAnalyticsPanel(state.currentProject.id);
    renderMcpKeys(state.currentProject.id);
  } catch (error) {
    if (request !== projectOverviewRequest) return;
    const model = projectOverviewModel(null, { phase: 'error', error: error.message });
    status.dataset.state = model.status;
    status.textContent = model.message;
    list.append(projectEmpty('Não foi possível carregar o projeto.', model.message));
  }
}
async function save() {
  await flushChanges(() => dirty, saveOnce);
  return page;
}
async function saveOnce() {
  clearTimeout(timer);
  if (saving) {
    await saving;
    if (dirty) return saveOnce();
    return page;
  }
  if (!page || !dirty) return page;
  loading = true;
  try {
    normalizeForms(editor);
    editor.getWrapper().find('form').forEach((form) => syncFormDelivery(form, page.webhook));
  } finally {
    loading = false;
  }
  const snapshot = change;
  const currentId = page.id;
  const payload = {
    revision: page.revision,
    name: $('#page-name').value.trim(),
    project: editor.getProjectData(),
    html: exportHtml(),
    domain: page.domain,
    webhook: page.webhook,
  };
  $('#save-state').textContent = 'Salvando…';
  saving = api('/pages/' + currentId, 'PUT', payload)
    .then((result) => {
      if (page?.id === currentId) {
        page = { ...result, name: $('#page-name').value, domain: page.domain, webhook: page.webhook };
        dirty = change !== snapshot;
        $('#save-state').textContent = dirty ? 'Alterações por salvar' : 'Salvo neste computador';
      }
      return result;
    })
    .catch((error) => {
      $('#save-state').textContent = 'Não salvo — tente novamente';
      clearTimeout(timer);
      throw error;
    })
    .finally(() => (saving = null));
  return saving;
}
const pageList = createContextList({
  load: () => api('/pages'),
  apply: (next) => {
    pages = next;
    renderList();
  },
});
async function loadList() {
  return pageList.refresh();
}
function renderList() {
  const textos = textosDaLista(tipoDeConteudo);
  const search = $('#search').value.toLocaleLowerCase('pt-BR');
  const doTipo = conteudoDaLista(pages, tipoDeConteudo);
  const filtered = doTipo.filter((p) => p.name.toLocaleLowerCase('pt-BR').includes(search));
  $('#page-count').textContent = contagemDaLista(doTipo.length, tipoDeConteudo);
  const list = $('#page-list');
  list.replaceChildren();
  if (!filtered.length) {
    list.innerHTML =
      '<div class="empty"><div class="empty-icon">↗</div><h2>' +
      (!doTipo.length ? textos.vazio : textos.naoEncontrado) +
      '</h2><p>' +
      (!doTipo.length ? textos.ajudaVazio : 'Tente buscar por outro nome.') +
      '</p></div>';
    return;
  }
  for (const p of filtered) {
    const card = document.createElement('article');
    card.className = 'page-card';
    const editable = studioShell?.can('page.write');
    const state = p.deployment?.state;
    const label =
      state === 'READY'
        ? p.deployment.revision === p.revision
          ? 'PUBLICADA'
          : 'ALTERADA'
        : state === 'ERROR'
          ? 'FALHOU'
          : state
            ? 'EM PUBLICAÇÃO'
            : 'RASCUNHO';
    card.innerHTML =
      '<div class="thumbnail"><div class="blank">↗</div></div><div class="card-content"><div class="card-top"><h3>' +
      escape(p.name) +
      '</h3><span class="badge">' +
      label +
      '</span></div><p>' +
      escape(p.domain || 'Domínio ainda não conectado') +
      `</p><div class="card-actions">${editable ? `<button class="card-action alva-tooltip edit" type="button" data-tooltip="Editar ${textos.singular}" aria-label="Editar ${textos.singular}"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button><button class="card-action alva-tooltip duplicate" type="button" data-tooltip="Duplicar ${textos.singular}" aria-label="Duplicar ${textos.singular}"><span class="material-symbols-outlined" aria-hidden="true">content_copy</span></button><button class="card-action alva-tooltip delete fe-danger" type="button" data-tooltip="Excluir ${textos.singular}" aria-label="Excluir ${textos.singular}"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>` : '<span class="read-only">Somente leitura</span>'}</div></div>`;
    if (editable) {
      card.querySelector('.edit').onclick = action(() => openPage(p.id));
      card.querySelector('.duplicate').onclick = action(async () => {
        await api('/pages/' + p.id + '/duplicate', 'POST', {});
        await loadList();
        toast('Cópia criada. O domínio foi deixado em branco.');
      });
      card.querySelector('.delete').onclick = action(async () => {
        if (!(await confirmarAcao({ titulo: 'Excluir “' + p.name + '”?', descricao: `${tipoDeConteudo === 'quiz' ? 'O quiz sai' : 'A página sai'} deste Studio. Uma publicação existente na Vercel continua no ar.`, confirmar: `Excluir ${textos.singular}`, perigo: true }))) return;
        await api('/pages/' + p.id, 'DELETE', {});
        await loadList();
      });
    }
    list.append(card);
    const frame = document.createElement('iframe');
    frame.title = 'Miniatura de ' + p.name;
    frame.sandbox = '';
    frame.tabIndex = -1;
    frame.loading = 'lazy';
    card.querySelector('.thumbnail').replaceChildren(frame);
    api('/pages/' + p.id)
      .then((full) => {
        frame.srcdoc = full.html || templateDocument(getTemplate(full.template) || getTemplate('services'));
      })
      .catch(() => {
        frame.srcdoc = '<p>Prévia indisponível</p>';
      });
  }
}
function syncPagePublishControl() {
  const publish = $('#publish');
  if (!publish) return;
  const canPublish = Boolean(studioShell?.can?.('deployment.publish'));
  const connected = Boolean(config.vercelConnected);
  publish.disabled = !canPublish || !connected;
  publish.title = canPublish
    ? (connected ? 'Publicar página' : 'Conecte a Vercel nas configurações do app')
    : 'Você não tem permissão para publicar. Peça acesso a um administrador.';
  const help = $('#publish-help');
  if (help) help.textContent = !canPublish
    ? 'Você não tem permissão para publicar. Peça acesso a um administrador.'
    : connected ? '' : 'Conecte a Vercel nas configurações do app para publicar.';
}

async function openPage(id) {
  const result = await api('/pages/' + id);
  page = result;
  const projectId = page.projectId || studioShell?.state().currentProject?.id;
  let vslVideos = [];
  let vslLoadError = '';
  if (mediaPipelineEnabled && studioShell?.can?.('video.read') && projectId) {
    try {
      vslVideos = await api(`/projects/${projectId}/videos`);
    } catch {
      vslLoadError = 'Não foi possível carregar as VSLs. Tente novamente.';
    }
  }
  // Quem abre um quiz pelo painel do projeto não passou pela lista: a marca da própria
  // página é que diz de onde ela veio e para onde o botão de voltar leva.
  tipoDeConteudo = page.kind === 'quiz' ? 'quiz' : 'page';
  const textos = textosDaLista(tipoDeConteudo);
  loading = true;
  dirty = false;
  change = 0;
  $('#dashboard').hidden = true;
  $('#editing').hidden = false;
  $('#back').setAttribute('aria-label', `Voltar para ${textos.voltar.toLocaleLowerCase('pt-BR')}`);
  $('#back').title = textos.voltar;
  $('#back').dataset.tooltip = textos.voltar;
  $('#page-name').setAttribute('aria-label', textos.nomeDoConteudo);
  $('#page-name').value = page.name;
  $('#save-state').textContent = 'Salvo neste computador';
  if (editor) editor.destroy();
  const template = getTemplate(page.template) || getTemplate('services');
  editor = createFriendlyEditor({
    container: '#editor',
    headerContext: textos.contexto,
    project: page.project,
    html: template.html,
    css: template.css,
    onChange: markDirty,
    onOpenFormSettings: () => abrirConfiguracoesDaPagina('respostas'),
    vslVideos,
    vslLoadError,
    mediaEnabled: () => mediaPipelineEnabled,
    publicOrigin: window.location.origin,
    can: (capability) => studioShell?.can?.(capability),
    quizCanvas: page.kind === 'quiz',
  });
  loading = false;
  if (!page.project || editor.__alvaMigrated) markDirty();
  syncPagePublishControl();
}
$('#new-page').onclick = () => {
  const textos = textosDaLista(tipoDeConteudo);
  const dialogo = $('#create-dialog');
  dialogo.querySelector('.eyebrow').textContent = textos.comecar;
  dialogo.querySelector('label').firstChild.textContent = textos.nomeDoConteudo;
  dialogo.querySelector('button.primary').textContent = textos.criar;
  renderTemplates();
  dialogo.showModal();
};
$('#create-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const p = await api('/pages', 'POST', { ...data, kind: tipoDeConteudo });
    $('#create-dialog').close();
    event.target.reset();
    await openPage(p.id);
  } finally {
    button.disabled = false;
  }
});
$('#search').oninput = renderList;
$('#page-name').oninput = () => {
  page.name = $('#page-name').value;
  markDirty();
};
$('#save').onclick = action(async () => {
  await save();
  toast('Página salva.');
});
$('#back').onclick = action(async () => {
  const projectId = page?.projectId;
  await save();
  clearTimeout(timer);
  if (editor) {
    editor.destroy();
    editor = null;
  }
  page = null;
  $('#editing').hidden = true;
  $('#dashboard').hidden = false;
  await returnToProject(projectId);
  // O botão promete a lista de onde a pessoa veio; devolvê-la à visão geral do projeto
  // fazia com que ela tivesse de procurar o caminho de novo.
  await mostrarConteudo(tipoDeConteudo);
});
$('#preview').onclick = action(async () => {
  await save();
  $('#preview-dialog iframe').srcdoc = exportHtml();
  $('#preview-dialog').showModal();
});
$('#download').onclick = action(async () => {
  await save();
  const url = URL.createObjectURL(new Blob([exportHtml()], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (page.name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'landing-page') + '.html';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('HTML exportado. Configure o destino do formulário antes de usar.');
});
function showDeployment() {
  const p = page.deployment;
  $('#deployment-state').textContent = p
    ? 'Publicação: ' +
      ({
        READY: 'No ar',
        BUILDING: 'Preparando a página',
        QUEUED: 'Na fila',
        ERROR: 'Não publicada — ocorreu um erro',
        CANCELED: 'Cancelada',
      }[p.state] || p.state) +
      ' · ' +
      (p.url || '')
    : 'Nenhuma publicação enviada.';
  $('#check-publication').disabled = !p || !config.vercelConnected;
  $('#connect-domain').disabled = !p || p.state !== 'READY' || !config.vercelConnected;
}
$('#settings').onclick = () => {
  const form = $('#settings-form');
  form.elements.webhook.value = page.webhook;
  form.elements.domain.value = page.domain;
  $('#vercel-state').textContent = config.vercelConnected
    ? '● Conexão Vercel salva. Você pode conferir o acesso em Configurações do app.'
    : '○ Conecte a Vercel nas configurações do app para publicar.';
  $('#domain-result').replaceChildren();
  showDeployment();
  $('#settings-dialog').showModal();
};
$('#settings-form').onsubmit = action(async (event) => {
  event.preventDefault();
  await save();
  const data = Object.fromEntries(new FormData(event.target));
  const webhook = data.webhook.trim();
  if (webhook) {
    const u = new URL(webhook);
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new Error('Informe um endereço HTTPS sem credenciais.');
  }
  const domain = data.domain.trim().toLowerCase();
  if (domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
    throw new Error('Informe o domínio sem https ou caminho.');
  page.webhook = webhook;
  page.domain = domain;
  editor.getWrapper().find('form').forEach((form) => syncFormDelivery(form, page.webhook));
  markDirty();
  await save();
  toast('Configurações salvas.');
  $('#settings-dialog').close();
});
$('#publish').onclick = action(async () => {
  if (!studioShell?.can?.('deployment.publish')) throw new Error('Você não tem permissão para publicar. Peça acesso a um administrador.');
  await save();
  if (!(await confirmarAcao({ titulo: 'Publicar “' + page.name + '”?', descricao: 'A versão atual vai para a Vercel e fica visível para quem acessar o endereço.', confirmar: 'Publicar' }))) return;
  $('#publish').disabled = true;
  try {
    page.deployment = await api('/pages/' + page.id + '/publish', 'POST', { revision: page.revision });
    toast('Enviada à Vercel. Consulte o andamento em Configurar.');
  } finally {
    syncPagePublishControl();
  }
});
$('#check-publication').onclick = action(async () => {
  page.deployment = await api('/pages/' + page.id + '/status');
  showDeployment();
  toast(page.deployment?.state === 'READY' ? 'A Vercel confirmou a publicação.' : 'Estado atualizado.');
});
$('#connect-domain').onclick = action(async () => {
  await save();
  if (!page.domain) throw new Error('Preencha e salve um domínio primeiro.');
  if (!(await confirmarAcao({ titulo: 'Conectar ' + page.domain + '?', descricao: 'O domínio passa a apontar para o projeto desta página na Vercel.', confirmar: 'Conectar domínio' }))) return;
  const result = await api('/pages/' + page.id + '/domain', 'POST', {});
  const domainNode = $('#domain-result');
  domainNode.textContent = result.verified
    ? 'Domínio adicionado. Confira o apontamento DNS na Vercel.'
    : 'Domínio adicionado. Verifique os registros abaixo no provedor do domínio.';
  if (result.verification?.length) {
    const table = document.createElement('table');
    table.className = 'domain-records';
    table.innerHTML = '<thead><tr><th>Tipo</th><th>Nome</th><th>Valor</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const record of result.verification) {
      const row = document.createElement('tr');
      for (const value of [record.type, record.domain, record.value]) {
        const cell = document.createElement('td');
        cell.textContent = value || '';
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    domainNode.append(table);
  }
  toast(
    result.verified
      ? 'Domínio adicionado. Confira o apontamento DNS na Vercel.'
      : 'Domínio adicionado; verifique a propriedade e o DNS na Vercel.',
  );
});
document
  .querySelectorAll('[data-close]')
  .forEach((button) => (button.onclick = () => button.closest('dialog').close()));
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function templateDocument(template) {
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>' +
    template.css +
    '</style></head><body>' +
    template.html +
    '</body></html>'
  );
}
let templateCategory = 'Todos';
function renderTemplates() {
  const selected = $('#create-form').elements.template.value || 'services';
  const filter = $('#template-filter');
  filter.replaceChildren();
  for (const category of ['Todos', ...new Set(templates.map((t) => t.category))]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = category;
    button.setAttribute('aria-pressed', String(category === templateCategory));
    button.onclick = () => {
      templateCategory = category;
      renderTemplates();
    };
    filter.append(button);
  }
  const gallery = $('#template-gallery');
  gallery.replaceChildren();
  for (const template of templates.filter((t) => templateCategory === 'Todos' || t.category === templateCategory)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'template-choice';
    button.setAttribute('aria-pressed', String(template.id === selected));
    button.setAttribute('aria-label', 'Usar modelo ' + template.name);
    button.innerHTML =
      '<span class="template-thumb"></span><span class="template-name">' +
      escape(template.name) +
      '</span><span class="template-description">' +
      escape(template.description) +
      '</span>';
    const frame = document.createElement('iframe');
    frame.sandbox = '';
    frame.tabIndex = -1;
    frame.title = 'Modelo ' + template.name;
    frame.srcdoc = templateDocument(template);
    button.querySelector('.template-thumb').append(frame);
    button.onclick = () => {
      $('#create-form').elements.template.value = template.id;
      renderTemplates();
    };
    gallery.append(button);
  }
}
async function refreshConfig() {
  if (!studioShell?.state().currentProject || !studioShell.can('integration.manage')) {
    config = { vercelConnected: false };
    syncPagePublishControl();
    return config;
  }
  config = await api('/config');
  syncPagePublishControl();
}
async function closeOpenEditors() {
  await contextBoundary.close();
}
function resetPageList() {
  pageList.invalidate();
  pages = [];
  dirty = false;
  $('#page-list').replaceChildren();
}
async function returnToProject(projectId) {
  if (projectId && studioShell?.state().currentProject?.id !== projectId) await studioShell.selectProject(projectId);
}
const vslUI = createVslUI({ api, getShell: () => studioShell, toast });
contextBoundary = createStudioContextBoundary({
  savePage: save,
  closePageEditor: () => {
    clearTimeout(timer);
    if (editor) editor.destroy();
    editor = null;
    page = null;
    $('#editing').hidden = true;
  },
  clearPageList: resetPageList,
});
studioShell = createStudioShell({
  api,
  beforeContextChange: closeOpenEditors,
  onContextChanged: async () => {
    companyOverviewRequest++;
    projectOverviewRequest++;
    dashboardStateOverride = null;
    const state = dashboardContextFlow.confirm();
    await refreshConfig();
    if (!$('#studio-home').hidden) renderHome();
    if (!$('#company-view').hidden) await renderCompany();
    if (!$('#project-view').hidden) await renderProject();
    if (!$('#pages-view').hidden && state.currentProject) await loadList();
    if (!$('#vsl-view').hidden && state.currentProject) await vslUI.reload();
  },
});
function renderProjectSwitcher(state = studioShell.state(), { selectedProjectId = state.currentProject?.id || '', disabled = state.phase === 'loading' || !state.projects.length } = {}) {
  const switcher = $('#project-switcher');
  switcher.replaceChildren();
  for (const project of state.projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === selectedProjectId;
    switcher.append(option);
  }
  switcher.disabled = disabled;
}
dashboardContextFlow = createDashboardProjectFlow({
  shell: studioShell,
  renderState: renderDashboardState,
  renderSwitcher: renderProjectSwitcher,
});
$('#nav-home').onclick = () => setDashboardView('home');
$('#nav-projects').onclick = () => setDashboardView('home');
$('#nav-project').onclick = action(async () => {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar sua visão geral.');
  projectContentFilter = 'all';
  setDashboardView('project');
});
async function openProjectSection({ navigation, filter = 'all', target, capability } = {}) {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha ou crie um projeto antes de continuar.');
  if (capability && !studioShell.can(capability)) throw new Error('Você não tem permissão para acessar esta área.');
  projectContentFilter = filter;
  await setDashboardView('project');
  setActiveNavigation(navigation || 'project');
  if (target) {
    const element = $(target);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
let analyticsViewDays = 7;
let journeySource = '';
let journeyGraph = null;
let journeyView = { escala: 1, x: 0, y: 0 };
let journeyArea = null;
let journeySelecionado = null;
function pintarRankList(seletor, linhas, vazio) {
  const alvo = clear($(seletor));
  if (!linhas.length) return alvo.append(projectEmpty(vazio, 'Os dados aparecem assim que houver movimento no período.'));
  for (const linha of linhas) {
    const row = document.createElement('div');
    row.className = 'rank-row';
    const label = document.createElement('span');
    label.textContent = linha.label;
    label.title = linha.label;
    const value = document.createElement('strong');
    value.textContent = linha.value;
    const share = document.createElement('div');
    share.className = 'rank-value';
    share.style.setProperty('--p', linha.width);
    const pct = document.createElement('span');
    pct.textContent = linha.share;
    share.append(pct);
    row.append(label, value, share);
    alvo.append(row);
  }
}
function pintarAnalyticsView(summary, { phase = 'ready', message = '' } = {}) {
  const status = $('#analytics-view-status');
  status.textContent = phase === 'loading' ? 'Carregando dados…' : phase === 'error' ? message : '';
  status.dataset.state = phase;
  $('#analytics-view-source').textContent = summary?.source === 'umami'
    ? 'Comportamento e aquisição medidos pelo Analytics.'
    : 'Comportamento e aquisição medidos pelo coletor legado · migração pendente.';
  const metrics = clear($('#analytics-view-metrics'));
  for (const metric of analyticsMetricsModel(phase === 'ready' ? summary : null)) {
    const card = document.createElement('article');
    card.className = 'metric';
    const label = document.createElement('small');
    label.textContent = metric.label;
    const value = document.createElement('strong');
    value.textContent = metric.value;
    card.append(label, value);
    metrics.append(card);
  }
  const dias = Array.isArray(summary?.dailyVisits) ? summary.dailyVisits.slice(-analyticsViewDays) : [];
  const maior = Math.max(1, ...dias.map((dia) => Number(dia?.visits) || 0));
  const chart = clear($('#analytics-view-chart'));
  const axis = clear($('#analytics-view-axis'));
  for (const dia of dias) {
    const bar = document.createElement('i');
    bar.className = 'bar';
    bar.style.setProperty('--h', `${Math.round(((Number(dia?.visits) || 0) / maior) * 100)}%`);
    bar.title = `${dia?.date ?? ''}: ${Number(dia?.visits) || 0} visitas`;
    chart.append(bar);
    const marca = document.createElement('span');
    marca.textContent = dia?.date ? new Date(dia.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
    axis.append(marca);
  }
  $('#analytics-chart-helper').textContent = dias.length ? `Últimos ${dias.length} dias · visitas por dia` : 'Sem visitas no período.';
  pintarRankList('#analytics-pages', analyticsRankModel(summary?.topRoutes), 'Nenhuma página visitada.');
  pintarRankList('#analytics-sources', analyticsRankModel(summary?.sources), 'Nenhuma origem registrada.');
  pintarRankList('#analytics-campaigns', analyticsRankModel((summary?.utms || []).map((utm) => ({ source: utm.campaign || utm.source || '(sem campanha)', total: utm.total }))), 'Nenhuma campanha registrada.');
  // O coletor legado não devolve `events` como o Umami: as conversões por conteúdo e os
  // marcos de VSL são o que ele mede de evento, e é isso que a aba mostra.
  const eventos = [
    ...(summary?.conversions || []).map((item) => ({ source: item.contentId || item.urlPath, total: item.total })),
    ...(summary?.vslFunnel || []).map((item) => ({ source: item.milestone === null ? item.eventName : `${item.eventName} · ${item.milestone}%`, total: item.total })),
    ...(summary?.events || []).map((evento) => ({ source: evento.name, total: evento.total })),
  ];
  pintarRankList('#analytics-events', analyticsRankModel(eventos, 10), 'Nenhum evento registrado.');
  pintarRankList('#analytics-countries', analyticsRankModel((summary?.audience?.countries || []).map((i) => ({ source: i.value, total: i.total }))), 'Nenhum país registrado.');
  pintarRankList('#analytics-cities', analyticsRankModel((summary?.audience?.cities || []).map((i) => ({ source: i.value, total: i.total }))), 'Nenhuma cidade registrada.');
  pintarRankList('#analytics-devices', analyticsRankModel((summary?.audience?.devices || []).map((i) => ({ source: i.value, total: i.total }))), 'Nenhum dispositivo registrado.');
  pintarRankList('#analytics-entries', analyticsRankModel((summary?.behavior?.entries || []).map((i) => ({ source: i.value, total: i.total }))), 'Nenhuma entrada registrada.');
  pintarRankList('#analytics-exits', analyticsRankModel((summary?.behavior?.exits || []).map((i) => ({ source: i.value, total: i.total }))), 'Nenhuma saída registrada.');
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (nome, atributos = {}) => {
  const elemento = document.createElementNS(SVG_NS, nome);
  for (const [chave, valor] of Object.entries(atributos)) elemento.setAttribute(chave, valor);
  return elemento;
};
function desenharJornada(graph) {
  const alvo = clear($('#journey-graph'));
  const mapa = journeyLayout(graph);
  if (!mapa.nodes.length) {
    const vazio = document.createElement('p');
    vazio.className = 'journey-empty';
    vazio.textContent = 'Ainda não há páginas suficientes para desenhar o caminho das visitas.';
    alvo.append(vazio);
    return;
  }
  const alturaTitulos = 22;
  const alturaTotal = mapa.height + alturaTitulos;
  // O mapa é muito mais largo que alto. Encaixá-lo inteiro na largura deixaria os cartões
  // ilegíveis, então a área mostra pixels reais e quem quiser a visão geral usa Enquadrar.
  const larguraVisivel = Math.max(320, alvo.clientWidth || 900);
  const alturaVisivel = Math.min(520, Math.max(320, alturaTotal + 24));
  const svg = svgEl('svg', { width: '100%', height: alturaVisivel, viewBox: `0 0 ${larguraVisivel} ${alturaVisivel}` });
  const palco = svgEl('g', { class: 'journey-stage' });
  svg.append(palco);
  journeyArea = { largura: larguraVisivel, altura: alturaVisivel, conteudo: { largura: mapa.width, altura: alturaTotal } };
  for (const coluna of mapa.columns) {
    const titulo = svgEl('text', { x: coluna.x, y: 12, class: 'journey-column' });
    titulo.textContent = coluna.title;
    palco.append(titulo);
  }
  for (const aresta of mapa.edges) {
    const deslocada = aresta.path.replace(/,(-?\d+(?:\.\d+)?)/g, (todo, valor) => `,${Number(valor) + alturaTitulos}`);
    palco.append(svgEl('path', { d: deslocada, class: 'journey-edge', 'data-source': aresta.source, 'data-target': aresta.target }));
    const rotulo = svgEl('text', {
      x: aresta.labelX, y: aresta.labelY + alturaTitulos - 4,
      class: `journey-edge-label${aresta.major ? '' : ' journey-edge-label-weak'}`,
      'text-anchor': 'middle', 'data-source': aresta.source, 'data-target': aresta.target,
    });
    rotulo.textContent = `${aresta.transitions} · ${aresta.share}`;
    palco.append(rotulo);
  }
  for (const no of mapa.nodes) {
    const origem = no.type === 'source';
    const tipo = origem ? ' journey-source' : no.type === 'event' ? ' journey-event' : '';
    const grupo = svgEl('g', { class: `journey-node${tipo}`, 'data-node': no.id, transform: `translate(${no.x}, ${no.y + alturaTitulos})` });
    grupo.addEventListener('click', () => destacarCaminho(no.id === journeySelecionado ? null : no.id));
    grupo.append(svgEl('rect', { width: mapa.cardWidth, height: mapa.cardHeight }));
    const nome = svgEl('text', { x: 12, y: 24, class: 'journey-label' });
    nome.textContent = no.label.length > 22 ? `${no.label.slice(0, 21)}…` : no.label;
    const linha1 = svgEl('text', { x: 12, y: 42, class: 'journey-meta' });
    linha1.textContent = origem || no.type === 'event' ? `${no.sessions} sessões` : `${no.pageviews} visualizações · ${no.sessions} sessões`;
    const linha2 = svgEl('text', { x: 12, y: 58, class: 'journey-meta' });
    linha2.textContent = origem ? 'origem das visitas' : no.type === 'event' ? 'ação executada' : `${no.entries} entradas · ${no.exits} saídas`;
    const titulo = svgEl('title');
    titulo.textContent = no.label;
    grupo.append(nome, linha1, linha2, titulo);
    palco.append(grupo);
  }
  alvo.append(svg);
  enquadrarJornada();
  ligarArrasteEZoom(alvo, svg);
  destacarCaminho(journeySelecionado);
}
function aplicarTransformacao() {
  const palco = document.querySelector('#journey-graph .journey-stage');
  if (palco) palco.setAttribute('transform', `translate(${journeyView.x}, ${journeyView.y}) scale(${journeyView.escala})`);
}
// Enquadrar: escala o mapa para caber na área, sem passar de 1 — ampliar não ajuda a ler.
function enquadrarJornada() {
  if (!journeyArea) return;
  const { largura, altura, conteudo } = journeyArea;
  const escala = Math.min(1, (largura - 24) / conteudo.largura, (altura - 24) / conteudo.altura);
  journeyView = {
    escala,
    x: Math.max(12, (largura - conteudo.largura * escala) / 2),
    y: Math.max(12, (altura - conteudo.altura * escala) / 2),
  };
  aplicarTransformacao();
}
function ajustarZoom(fator) {
  journeyView.escala = Math.min(3, Math.max(0.4, journeyView.escala * fator));
  aplicarTransformacao();
}
function ligarArrasteEZoom(alvo, svg) {
  let arrastando = null;
  alvo.addEventListener('pointerdown', (evento) => {
    arrastando = { x: evento.clientX - journeyView.x, y: evento.clientY - journeyView.y };
    alvo.classList.add('is-dragging');
    svg.setPointerCapture?.(evento.pointerId);
  });
  alvo.addEventListener('pointermove', (evento) => {
    if (!arrastando) return;
    journeyView.x = evento.clientX - arrastando.x;
    journeyView.y = evento.clientY - arrastando.y;
    aplicarTransformacao();
  });
  for (const nome of ['pointerup', 'pointerleave', 'pointercancel']) {
    alvo.addEventListener(nome, () => { arrastando = null; alvo.classList.remove('is-dragging'); });
  }
  alvo.addEventListener('wheel', (evento) => {
    evento.preventDefault();
    ajustarZoom(evento.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
}
// Clicar num cartão acende a cadeia inteira em que ele está — de onde as visitas vieram
// até onde chegaram. O que não tem ligação com ele recua.
function destacarCaminho(nodeId) {
  journeySelecionado = nodeId;
  const alcancados = journeyConnected(journeyGraph, nodeId);
  for (const cartao of document.querySelectorAll('#journey-graph .journey-node')) {
    const dele = cartao.dataset.node;
    cartao.classList.toggle('journey-dim', Boolean(nodeId) && !alcancados.has(dele));
    cartao.classList.toggle('journey-selected', dele === nodeId);
  }
  for (const passagem of document.querySelectorAll('#journey-graph .journey-edge')) {
    const noCaminho = Boolean(nodeId) && alcancados.has(passagem.dataset.source) && alcancados.has(passagem.dataset.target);
    passagem.classList.toggle('journey-dim', Boolean(nodeId) && !noCaminho);
    passagem.classList.toggle('journey-strong', noCaminho);
  }
  for (const rotulo of document.querySelectorAll('#journey-graph .journey-edge-label')) {
    const noCaminho = Boolean(nodeId) && alcancados.has(rotulo.dataset.source) && alcancados.has(rotulo.dataset.target);
    rotulo.classList.toggle('journey-dim', Boolean(nodeId) && !noCaminho);
    rotulo.classList.toggle('journey-reveal', noCaminho);
  }
}
function pintarJornadaDoSite(graph) {
  journeyGraph = graph;
  const seletor = $('#journey-source');
  const escolhida = seletor.value;
  clear(seletor);
  const todas = document.createElement('option');
  todas.value = '';
  todas.textContent = 'Todas as origens';
  seletor.append(todas);
  for (const origem of graph?.sources ?? []) {
    const opcao = document.createElement('option');
    opcao.value = origem;
    opcao.textContent = origem;
    seletor.append(opcao);
  }
  seletor.value = escolhida || journeySource || '';
  desenharJornada(graph);
  $('#journey-summary').textContent = graph?.totals
    ? `${graph.totals.sessions} sessões · ${graph.totals.conversions} com ação · ${graph.totals.conversionRate}% de conversão · ${graph.totals.pages} páginas`
    : 'Caminho percorrido pelas visitas, montado a partir das páginas vistas em cada sessão.';
  pintarRankList('#journey-attributions', analyticsRankModel((graph?.attributions || []).map((item) => ({
    source: [item.source, item.campaign].filter(Boolean).join(' · '), total: item.sessions,
  }))), 'Nenhuma origem registrada.');
}
async function carregarJornada() {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) return;
  try {
    const { from, to } = analyticsRangeParams(new Date(), analyticsViewDays);
    const filtro = journeySource ? `&source=${encodeURIComponent(journeySource)}` : '';
    const graph = await api(`/projects/${projectId}/analytics/journey?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${filtro}`);
    pintarJornadaDoSite(graph);
  } catch (error) {
    pintarJornadaDoSite(null);
    toast(error.message);
  }
}

$('#journey-source').onchange = () => {
  journeySource = $('#journey-source').value;
  journeySelecionado = null;
  void carregarJornada();
};
$('#journey-zoom-in').onclick = () => ajustarZoom(1.2);
$('#journey-zoom-out').onclick = () => ajustarZoom(1 / 1.2);
$('#journey-reset').onclick = () => enquadrarJornada();
async function abrirAnalytics() {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha ou crie um projeto antes de continuar.');
  if (!studioShell.can('analytics.read')) throw new Error('Você não tem permissão para acessar esta área.');
  setDashboardView('analytics');
  pintarAnalyticsView(null, { phase: 'loading' });
  const request = analyticsPanelGuard.next();
  try {
    const { from, to } = analyticsRangeParams(new Date(), analyticsViewDays);
    const summary = await api(`/projects/${projectId}/analytics/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!analyticsPanelGuard.isCurrent(request, projectId, dashboardState().currentProject?.id)) return;
    pintarAnalyticsView(summary);
    void carregarJornada();
  } catch (error) {
    if (!analyticsPanelGuard.isCurrent(request, projectId, dashboardState().currentProject?.id)) return;
    pintarAnalyticsView(null, { phase: 'error', message: error.message });
  }
}
$('#nav-project-analytics').onclick = action(abrirAnalytics);
$('#analytics-range').onchange = action(async () => {
  analyticsViewDays = Number($('#analytics-range').value) || 7;
  await abrirAnalytics();
});
const DESTINOS = { meta: ['Meta', 'Pixel e Conversions API'], google: ['Google Ads', 'Enhanced Conversions'], tiktok: ['TikTok', 'Events API'], linkedin: ['LinkedIn', 'Conversions API'], taboola: ['Taboola', 'Server-to-server'] };
const CONSENTIMENTO = {
  granted: ['granted', 'Concedido', 'Click IDs e hashes de contato gerados no servidor seguem para os destinos.'],
  pending: ['pending', 'Aguardando decisão', 'O evento e os identificadores pseudônimos permitidos continuam sendo processados. Sem nome, e-mail ou telefone.'],
  denied: ['denied', 'Negado', 'Nenhum hash derivado é gerado. Só seguem os identificadores estritamente permitidos.'],
};
const TRACKING_PAGINA = 10;
let trackingDeliveries = [];
let trackingSelected = null;
let trackingVisiveis = TRACKING_PAGINA;
function tempoRelativo(valor) {
  const data = new Date(valor);
  if (Number.isNaN(data.valueOf())) return '—';
  const minutos = Math.max(0, Math.round((Date.now() - data.valueOf()) / 60_000));
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 24 ? `há ${horas} h` : data.toLocaleDateString('pt-BR');
}
function entregasFiltradas() {
  const ambiente = $('#tracking-environment').value;
  return trackingDeliveries.filter((linha) => !ambiente || linha.environment === ambiente);
}
function pintarRastreamento() {
  const entregas = entregasFiltradas();
  const metrics = clear($('#tracking-metrics'));
  for (const metric of trackingMetricsModel(entregas)) {
    const card = document.createElement('article');
    card.className = 'metric';
    const label = document.createElement('small');
    label.textContent = metric.label;
    const value = document.createElement('strong');
    value.textContent = metric.value;
    const detail = document.createElement('span');
    detail.className = 'trend';
    detail.textContent = metric.detail;
    card.append(label, value, detail);
    metrics.append(card);
  }
  const tipo = $('#tracking-filter-event').value;
  const estado = $('#tracking-filter-state').value;
  const encontrados = trackingEventsModel(entregas)
    .filter((evento) => (!tipo || evento.eventName === tipo) && (!estado || evento.status === estado));
  const pagina = trackingPageModel(encontrados, trackingVisiveis);
  const eventos = pagina.rows;
  const verMais = $('#tracking-more');
  verMais.hidden = !pagina.hasMore;
  verMais.textContent = 'Ver mais';
  const corpo = clear($('#tracking-events'));
  if (!eventos.length) {
    const linha = document.createElement('tr');
    const celula = document.createElement('td');
    celula.colSpan = 5;
    celula.textContent = 'Nenhum evento comercial registrado neste ambiente.';
    linha.append(celula);
    corpo.append(linha);
  }
  for (const evento of eventos) {
    const linha = document.createElement('tr');
    linha.classList.toggle('selected', evento.eventRef === trackingSelected);
    const estados = { Entregue: 'ok', 'Nova tentativa': 'retry', Encerrada: 'error' };
    for (const texto of [evento.eventName, evento.contentId || '—', evento.consentLabel, tempoRelativo(evento.receivedAt)]) {
      const celula = document.createElement('td');
      celula.textContent = texto;
      linha.append(celula);
    }
    const entrega = document.createElement('td');
    const marca = document.createElement('span');
    marca.className = `delivery-state ${estados[evento.status] || 'retry'}`;
    marca.textContent = evento.status;
    entrega.append(marca);
    linha.append(entrega);
    linha.onclick = () => { trackingSelected = evento.eventRef; pintarRastreamento(); };
    corpo.append(linha);
  }
  pintarJornada(encontrados.find((evento) => evento.eventRef === trackingSelected) || eventos[0] || null);
  const saude = clear($('#tracking-health'));
  const linhas = trackingHealthModel(entregas);
  if (!linhas.length) saude.append(projectEmpty('Nenhuma entrega registrada.', 'A saúde por destino aparece assim que houver envios.'));
  for (const destino of linhas) {
    const barra = document.createElement('div');
    barra.className = 'delivery-bar';
    const nome = document.createElement('span');
    nome.textContent = DESTINOS[destino.destination]?.[0] || destino.destination;
    const trilho = document.createElement('div');
    trilho.className = 'track';
    const preenchido = document.createElement('i');
    preenchido.style.setProperty('--p', destino.rate);
    trilho.append(preenchido);
    const taxa = document.createElement('strong');
    taxa.textContent = destino.rate;
    barra.append(nome, trilho, taxa);
    saude.append(barra);
  }
  const destinos = clear($('#tracking-destinations'));
  const ativos = new Set(entregas.map((linha) => linha.destination));
  for (const [chave, [nome, descricao]] of Object.entries(DESTINOS)) {
    const card = document.createElement('article');
    card.className = 'provider';
    const texto = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = nome;
    const detalhe = document.createElement('small');
    detalhe.textContent = descricao;
    texto.append(titulo, detalhe);
    const estado = document.createElement('span');
    estado.className = `delivery-state ${ativos.has(chave) ? 'ok' : 'retry'}`;
    estado.textContent = ativos.has(chave) ? 'Enviando' : 'Sem envios';
    card.append(texto, estado);
    destinos.append(card);
  }
  const consentimento = clear($('#tracking-consent'));
  const contagem = new Map();
  for (const evento of trackingEventsModel(entregas)) contagem.set(evento.consentState, (contagem.get(evento.consentState) || 0) + 1);
  for (const [chave, [rotulo, titulo, descricao]] of Object.entries(CONSENTIMENTO)) {
    const card = document.createElement('article');
    card.className = 'consent-card';
    const nome = document.createElement('h3');
    nome.textContent = titulo;
    const marca = document.createElement('span');
    marca.className = 'delivery-state retry';
    marca.textContent = `${rotulo} · ${contagem.get(chave) || 0} eventos`;
    const texto = document.createElement('p');
    texto.textContent = descricao;
    card.append(nome, marca, texto);
    consentimento.append(card);
  }
}
function pintarJornada(evento) {
  const alvo = clear($('#tracking-journey'));
  if (!evento) return alvo.append(projectEmpty('Selecione um evento.', 'A jornada aparece ao escolher uma linha.'));
  const titulo = document.createElement('strong');
  titulo.textContent = `${evento.eventName} · ${evento.contentId || 'sem conteúdo'}`;
  const linhaDoTempo = document.createElement('div');
  linhaDoTempo.className = 'timeline';
  const entregues = evento.destinations.filter(Boolean).map((destino) => DESTINOS[destino]?.[0] || destino);
  const passos = [
    ['1', 'Registrado no Studio', new Date(evento.receivedAt).toLocaleString('pt-BR')],
    ['2', 'Consentimento aplicado', `${evento.consentLabel} · hashes gerados no servidor`],
    ['3', 'Recebido pelo Rastreamento', `${evento.total} ${evento.total === 1 ? 'entrega enfileirada' : 'entregas enfileiradas'}`],
    ['4', 'Destinos concluídos', entregues.length ? `${evento.delivered} de ${evento.total} · ${entregues.join(', ')}` : 'Nenhum destino concluído'],
  ];
  for (const [ordem, nome, detalhe] of passos) {
    const linha = document.createElement('div');
    linha.className = 'timeline-row';
    const marca = document.createElement('div');
    marca.className = 'timeline-mark';
    const bolinha = document.createElement('i');
    bolinha.textContent = ordem;
    marca.append(bolinha);
    const texto = document.createElement('div');
    const forte = document.createElement('strong');
    forte.textContent = nome;
    const pequeno = document.createElement('small');
    pequeno.textContent = detalhe;
    texto.append(forte, pequeno);
    linha.append(marca, texto);
    linhaDoTempo.append(linha);
  }
  alvo.append(titulo, linhaDoTempo);
}

async function abrirRastreamento() {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha ou crie um projeto antes de continuar.');
  if (!studioShell.can('analytics.read')) throw new Error('Você não tem permissão para acessar esta área.');
  setDashboardView('tracking');
  trackingVisiveis = TRACKING_PAGINA;
  const status = $('#tracking-status');
  status.textContent = 'Carregando eventos…';
  status.dataset.state = 'loading';
  try {
    trackingDeliveries = await api(`/projects/${projectId}/conversions`);
    status.textContent = '';
    status.dataset.state = 'ready';
  } catch (error) {
    trackingDeliveries = [];
    status.textContent = error.message;
    status.dataset.state = 'error';
  }
  pintarRastreamento();
}
$('#nav-project-tracking').onclick = action(abrirRastreamento);
for (const seletor of ['#tracking-environment', '#tracking-filter-event', '#tracking-filter-state']) $(seletor).onchange = () => {
  trackingVisiveis = TRACKING_PAGINA;
  pintarRastreamento();
};
$('#tracking-more').onclick = () => {
  trackingVisiveis += TRACKING_PAGINA;
  pintarRastreamento();
};
async function abrirPublicacao() {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de continuar.');
  setDashboardView('publication');
  await renderProject();
}
async function abrirAgentes() {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de continuar.');
  if (!studioShell.can('project.manage')) throw new Error('Você não tem permissão para acessar esta área.');
  setDashboardView('agents');
  await renderProject();
}
$('#nav-project-publication').onclick = action(abrirPublicacao);
$('#nav-project-agents').onclick = action(abrirAgentes);
$('#publication-preview').onclick = action(async () => {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha um projeto antes de criar a prévia.');
  await api(`/projects/${projectId}/publication/preview`, 'POST', { revision: 0 });
  toast('Prévia preparada.');
  await renderProject();
});
$('#publication-production').onclick = action(async () => {
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha um projeto antes de publicar.');
  if (!(await confirmarAcao({ titulo: 'Publicar em produção?', descricao: 'Todas as rotas deste projeto vão ao ar de uma vez.', confirmar: 'Publicar tudo' }))) return;
  const publication = await api(`/projects/${projectId}/publication`);
  if (!publication.latestPreviewReady?.id) throw new Error('Crie uma prévia pronta antes de publicar em produção.');
  await api(`/projects/${projectId}/publication/production`, 'POST', { confirmed: true, previewRunId: publication.latestPreviewReady.id, revision: 0 });
  toast('Publicação enviada.');
  await renderProject();
});
$('#publication-connection-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const projectId = studioShell.state().currentProject?.id;
  const data = Object.fromEntries(new FormData(event.target));
  await api(`/projects/${projectId}/publication/vercel`, 'PUT', data);
  toast('Conexão Vercel salva.');
  await renderProject();
});
$('#publication-sync').onclick = action(async () => {
  const projectId = studioShell.state().currentProject?.id;
  const nome = $('#publication-connection-form').elements.vercelProjectId.value.trim();
  if (!nome) throw new Error('Informe o nome do projeto na Vercel.');
  if (!(await confirmarAcao({
    titulo: `Criar “${nome}” na Vercel?`,
    descricao: `As páginas deste projeto passam a subir como rotas de ${nome}.vercel.app. Se já existir um projeto com esse nome na sua conta, ele será usado.`,
    confirmar: 'Criar na Vercel',
  }))) return;
  const resultado = await api(`/projects/${projectId}/publication/vercel/sync`, 'POST', { vercelProjectId: nome });
  toast(resultado.created ? `Projeto ${resultado.vercelProjectId} criado na Vercel.` : `Projeto ${resultado.vercelProjectId} já existia e foi conectado.`);
  await renderProject();
});
$('#publication-domain-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const projectId = studioShell.state().currentProject?.id;
  const publication = await api(`/projects/${projectId}/publication`);
  const data = Object.fromEntries(new FormData(event.target));
  await api(`/projects/${projectId}/publication/domain`, 'POST', { ...data, runId: publication.production?.id });
  toast('Domínio conectado.');
  await renderProject();
});
$('#mcp-key-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const projectId = studioShell.state().currentProject?.id;
  if (!projectId) throw new Error('Escolha um projeto antes de criar uma chave MCP.');
  const form = event.target;
  const data = new FormData(form);
  const result = await api(`/projects/${projectId}/mcp/keys`, 'POST', {
    name: String(data.get('name') || ''),
    scopes: data.get('drafts') ? ['read', 'drafts'] : ['read'],
    expiresInDays: Number(data.get('expiresInDays')),
  });
  form.reset();
  await renderMcpKeys(projectId);
  $('#mcp-key-status').textContent = `Copie agora e guarde em local seguro: ${result.token}`;
  toast('Chave MCP criada. O segredo aparece somente agora.');
});
// Páginas e Quizzes abrem a mesma tela. Manter duas telas era manter dois editores, e é
// justamente isso que a marca resolveu: o quiz é a página com etapas.
async function mostrarConteudo(tipo) {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar seus conteúdos.');
  tipoDeConteudo = tipo;
  const textos = textosDaLista(tipo);
  setDashboardView(tipo === 'quiz' ? 'forms' : 'pages');
  $('#pages-eyebrow').textContent = textos.eyebrow;
  $('#pages-title').innerHTML = `${escape(textos.titulo)}<span class="accent">.</span>`;
  $('#pages-subtitle').textContent = textos.descricao;
  $('#new-page').textContent = textos.botao;
  $('#search').placeholder = textos.busca;
  $('#search').setAttribute('aria-label', `Buscar ${textos.plural}`);
  $('#pages-footer').firstChild.textContent = `${textos.rodape} `;
  $('#new-page').hidden = !studioShell.can('page.write');
  await loadList();
}
async function abrirPaginas() {
  await mostrarConteudo('page');
}
async function abrirFormularios() {
  await mostrarConteudo('quiz');
}
$('#nav-pages').onclick = action(abrirPaginas);
$('#nav-forms').onclick = action(abrirFormularios);
$('#new-vsl').onclick = () => { if (studioShell.can('video.write')) vslUI.edit(); };
function selectProjectContentFilter(filter) {
  if (filter === 'leads' && !studioShell?.can?.('submission.read')) return;
  if (filter === 'conversions' && !studioShell?.can?.('analytics.read')) return;
  projectContentFilter = filter;
  if (projectContentFilter === 'leads') {
    leadsFormId = '';
    leadsSource = null;
    leadSources = [];
    leadsRows = [];
    leadsNextCursor = null;
  }
  for (const item of $('#project-content-filter').querySelectorAll('button')) {
    if (item.dataset.projectFilter === projectContentFilter) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  if (projectContentFilter === 'all') $('#project-content-all').setAttribute('aria-current', 'page');
  else $('#project-content-all').removeAttribute('aria-current');
  renderProject();
}
$('#project-content-filter').onclick = (event) => {
  const button = event.target.closest('[data-project-filter]');
  if (button) selectProjectContentFilter(button.dataset.projectFilter);
};
$('#project-content-all').onclick = action(async () => {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar seus conteúdos.');
  if (projectContentFilter === 'leads') {
    selectProjectContentFilter('all');
    return;
  }
  if (projectContentFilter === 'forms') return abrirFormularios();
  await abrirPaginas();
});
$('#project-leads-form').onchange = () => {
  const value = $('#project-leads-form').value;
  leadsSource = value ? JSON.parse(value) : null;
  leadsFormId = leadsSource?.sourceKind === 'form' ? leadsSource.sourceId : '';
  leadsRows = [];
  leadsNextCursor = null;
  void loadProjectLeads();
};
$('#project-leads-next').onclick = () => void loadProjectLeads({ append: true });
mobileMenuTrigger = $('#mobile-menu');
mobileDrawer = createMobileDrawerController({
  drawer: $('#studio-sidebar'),
  trigger: mobileMenuTrigger,
  focusable: () => [...$('#studio-sidebar').querySelectorAll('a[href], button:not([disabled]), select:not([disabled])')],
});
function syncMobileDrawer() {
  const sidebar = $('#studio-sidebar');
  const backdrop = $('#mobile-drawer-backdrop');
  if (mobileDrawerActive()) {
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
    mobileDrawer.close({ returnFocus: false });
  } else {
    sidebar.inert = false;
    sidebar.setAttribute('aria-hidden', 'false');
    mobileMenuTrigger.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
  }
}
syncMobileDrawer();
window.addEventListener('resize', syncMobileDrawer);
mobileMenuTrigger.onclick = () => {
  if (!mobileDrawerActive()) return;
  const sidebar = $('#studio-sidebar');
  if (sidebar.classList.contains('is-open')) {
    closeMobileDrawer({ returnFocus: true });
  } else {
    sidebar.classList.add('is-open');
    $('#mobile-drawer-backdrop').hidden = false;
    mobileDrawer.open();
  }
};
$('#mobile-drawer-backdrop').onclick = () => closeMobileDrawer({ returnFocus: true });
document.addEventListener('keydown', (event) => {
  if (!mobileDrawerActive() || $('dialog[open]')) return;
  const sidebar = $('#studio-sidebar');
  if (!sidebar.classList.contains('is-open')) return;
  mobileDrawer.handleKeydown(event);
  if (event.key === 'Escape') $('#mobile-drawer-backdrop').hidden = true;
});
$('#project-switcher').onchange = action(async (event) => {
  if (event.target.value === studioShell.state().currentProject?.id) return;
  await dashboardContextFlow.selectProject(event.target.value);
  setDashboardView('project');
});
$('#new-project').onclick = () => {
  const form = $('#new-project-form');
  $('#new-project-error').textContent = '';
  form.reset();
  form.elements.slug.dataset.auto = 'true';
  $('#new-project-dialog').showModal();
};
$('#project-create-action').onclick = () => $('#new-project').click();
$('#project-settings-action').onclick = action(async () => {
  const projeto = dashboardState().currentProject;
  if (!projeto?.id) throw new Error('Escolha um projeto para configurar.');
  const form = $('#project-settings-form');
  form.elements.name.value = projeto.name || '';
  form.elements.slug.value = projeto.slug || '';
  $('#project-settings-error').textContent = '';
  $('#project-settings-dialog').showModal();
});
$('#project-settings-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const projectId = dashboardState().currentProject?.id;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const name = values.name.trim();
  const slug = values.slug.trim();
  const error = $('#project-settings-error');
  error.textContent = '';
  if (!name || name.length > 100) {
    error.textContent = 'Informe um nome de até 100 caracteres.';
    return;
  }
  if (!isProjectSlug(slug) || slug.length > 80) {
    error.textContent = 'Use um identificador de até 80 caracteres com letras minúsculas, números e hífens.';
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/projects/' + projectId, 'PUT', { name, slug });
    $('#project-settings-dialog').close();
    await studioShell.initialize();
    await selectProject(projectId);
    toast('Projeto atualizado.');
  } catch (falha) {
    error.textContent = falha?.message || 'Não foi possível salvar o projeto.';
  } finally {
    button.disabled = false;
  }
});
$('#nav-vsl').onclick = () => setDashboardView('vsl');
$('#home-history-all').onclick = () => setDashboardView('history');
$('#open-analytics').onclick = action(async () => {
  const projectId = dashboardState().currentProject?.id;
  if (!projectId) throw new Error('Escolha um projeto para abrir Analytics.');
  if (!studioShell?.can?.('analytics.read')) throw new Error('Você não tem permissão para visualizar Analytics.');
  if ($('#project-view').hidden) setDashboardView('project');
  await renderAnalyticsPanel(projectId);
  $('#analytics-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#new-project-form').elements.name.oninput = (event) => {
  const slug = $('#new-project-form').elements.slug;
  if (slug.dataset.auto !== 'true') return;
  slug.value = event.target.value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};
$('#new-project-form').elements.slug.oninput = () => {
  $('#new-project-form').elements.slug.dataset.auto = 'false';
};
$('#new-project-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const name = values.name.trim();
  const slug = values.slug.trim();
  const error = $('#new-project-error');
  error.textContent = '';
  if (!name || name.length > 100) {
    error.textContent = 'Informe um nome de até 100 caracteres.';
    return;
  }
  if (!isProjectSlug(slug) || slug.length > 80) {
    error.textContent = 'Use um identificador de até 80 caracteres com letras minúsculas, números e hífens.';
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    await projectSubmission.submit({ name, slug });
    toast('Projeto criado e selecionado.');
  } finally {
    button.disabled = false;
  }
});
projectSubmission = createProjectSubmission({
  createProject: (input) => api('/projects', 'POST', input),
  selectProject,
  closeDialog: () => $('#new-project-dialog').close(),
  showError: (message) => ($('#new-project-error').textContent = message),
});
ownerUI = createOwnerUI({
  api,
  toast,
  onAuthenticated: async () => {
    await studioShell.initialize();
    dashboardContextFlow.bootstrap();
    await refreshConfig();
    if (page) {
      $('#editing').hidden = false;
      $('#dashboard').hidden = true;
    } else {
      $('#dashboard').hidden = false;
      const rota = window.location.hash.length > 1 ? viewRouter.current() : null;
      const hasProject = Boolean(studioShell.state().currentProject);
      abrirView(viewToRestore(rota, { hasProject }), { settingsTab: rota?.settingsTab ?? 'account' });
      viewRouter.start();
    }
  },
  beforeLogout: save,
  onCompanySettings: () => {
    const state = studioShell?.state();
    $('#settings-company-name').textContent = state?.currentCompany?.name || 'Empresa atual';
    $('#settings-company-role').textContent = state?.currentCompany ? `Seu papel: ${roleLabel(state.currentCompany.role || state.session?.role)}` : '';
    $('#settings-company-status').textContent = 'Carregando dados da empresa…';
    const target = $('#settings-company-content');
    if (!state?.currentCompany || !target) return;
    Promise.all([api(`/companies/${state.currentCompany.id}/overview`), api('/billing').catch(() => null)]).then(([overview, billing]) => {
      if (studioShell?.state().currentCompany?.id !== state.currentCompany.id || $('#settings-view').hidden) return;
      $('#settings-company-status').textContent = '';
      renderCompanyOverview(overview, { content: target, title: $('#settings-company-name'), role: $('#settings-company-role'), billing });
    }).catch((error) => {
      if ($('#settings-view').hidden) return;
      $('#settings-company-status').textContent = error.message || 'Não foi possível carregar a empresa.';
    });
  },
  onSettingsClosed: () => setDashboardView(studioShell?.state().currentProject ? 'project' : 'home'),
  canManageIntegration: () => !studioShell?.state().session?.user || studioShell.can('integration.manage'),
  onLoggedOut: async () => {
    clearTimeout(timer);
    editor?.destroy();
    editor = null;
    page = null;
    resetPageList();
    $('#editing').hidden = true;
    $('#dashboard').hidden = true;
    companyOverviewRequest++;
    $('#project-switcher').replaceChildren();
  },
  onSettingsChanged: refreshConfig,
  settingsMount: $('#settings-view'),
});
$('#app-settings').onclick = () => setDashboardView('settings');
$('#page-vercel-settings').onclick = action(async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
  if (!studioShell.can('integration.manage')) {
    toast('Você não tem permissão para configurar integrações.');
    return;
  }
  const projectId = page?.projectId;
  await save();
  clearTimeout(timer);
  if (editor) editor.destroy();
  editor = null;
  page = null;
  $('#editing').hidden = true;
  $('#dashboard').hidden = false;
  await returnToProject(projectId);
  $('#settings-dialog').close();
  await setDashboardView('settings', { settingsTab: 'vercel' });
  } finally {
    button.disabled = false;
  }
});
try {
  await ownerUI.initialize();
  $('#startup').remove();
} catch (error) {
  $('#startup').textContent = 'Não foi possível abrir o Studio. Recarregue a página para tentar novamente.';
  toast(error.message);
}
