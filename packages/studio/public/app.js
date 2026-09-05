import { flushChanges } from './save-cycle.js';
import { templates, getTemplate, normalizeForms } from './templates.js';
import { createFriendlyEditor } from './editor-shell.js';
import { createOwnerUI } from './owner.js';
import { createUIPreferences } from './ui-preferences.js';
import { createFormsUI } from './forms.js';
import { createStudioShell } from './studio-shell.js';
import { createStudioContextBoundary } from './studio-context-boundary.js';
import { createContextList } from './context-list.js';
import { applyDashboardNavigation, canCreateProject, createAuthenticatedApi, createDashboardContextFlow, createMobileDrawerController, createProjectSubmission, dashboardModel, filterProjectContent, isProjectSlug, projectContentAction, projectOverviewModel, publicationModel, roleLabel } from './studio-dashboard.js';
const $ = (s) => document.querySelector(s);
createUIPreferences();
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
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
  formsUI,
  studioShell,
  dashboardContextFlow,
  dashboardStateOverride,
  projectSubmission,
  contextBoundary,
  companyOverviewRequest = 0,
  projectOverviewRequest = 0,
  projectContentFilter = 'all',
  mobileMenuTrigger,
  mobileDrawer,
  config = { vercelConnected: false };
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
  applyDashboardNavigation({ home: $('#nav-home'), company: $('#nav-company'), project: $('#nav-project'), pages: $('#nav-pages'), forms: $('#nav-forms') }, view);
}
function setDashboardView(view) {
  const sections = {
    home: '#studio-home',
    company: '#company-view',
    project: '#project-view',
    pages: '#pages-view',
    forms: '#forms-view',
  };
  for (const [name, selector] of Object.entries(sections)) $(selector).hidden = name !== view;
  closeMobileDrawer();
  setActiveNavigation(view);
  if (view === 'home') renderHome();
  if (view === 'company') renderCompany();
  if (view === 'project') renderProject();
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
  if (!$('#studio-home').hidden) renderHome();
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
  const state = dashboardState();
  const model = dashboardModel(state);
  $('#home-display-name').textContent = state.session?.user?.displayName || 'seja bem-vindo';
  const status = $('#studio-dashboard-status');
  status.textContent = model.message;
  status.dataset.state = model.status;
  $('#new-project').hidden = !canCreateProject(studioShell);
  const companies = clear($('#home-companies'));
  const projects = clear($('#home-projects'));
  const activity = clear($('#home-activity'));
  if (model.status === 'loading') return;
  if (model.status === 'error') return;
  if (!model.companies.length) companies.append(emptyCard('Nenhuma empresa disponível.', 'Peça acesso a uma empresa para continuar.'));
  for (const company of model.companies) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'company-card';
    button.dataset.companyId = company.id;
    const name = document.createElement('strong');
    name.textContent = company.name;
    const label = document.createElement('span');
    label.textContent = company.id === state.currentCompany?.id ? 'Empresa atual' : roleLabel(company.role);
    button.append(name, label);
    button.onclick = action(async () => {
      if (company.id === studioShell.state().currentCompany?.id) return;
      await dashboardContextFlow.selectCompany(company.id);
      setDashboardView('home');
    });
    companies.append(button);
  }
  if (!model.projects.length) projects.append(emptyCard('Nenhum projeto disponível.', 'Crie um projeto ou peça acesso a um projeto da empresa atual.'));
  for (const project of model.projects) projects.append(projectCard(project));
  if (!model.activity.length) activity.append(emptyCard('Ainda não há atividade.', 'As atualizações dos seus projetos aparecerão aqui.'));
  for (const project of model.activity) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'activity-item';
    const name = document.createElement('strong');
    name.textContent = project.name;
    const date = document.createElement('span');
    date.textContent = relativeDate(project.updatedAt);
    item.append(name, date);
    item.onclick = action(() => selectProject(project.id));
    activity.append(item);
  }
}
function projectCard(project) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'studio-project-card';
  button.dataset.projectId = project.id;
  const name = document.createElement('strong');
  name.textContent = project.name;
  const meta = document.createElement('span');
  meta.textContent = relativeDate(project.updatedAt);
  button.append(name, meta);
  button.onclick = action(() => selectProject(project.id));
  return button;
}
async function selectProject(projectId) {
  await studioShell.selectProject(projectId);
  projectContentFilter = 'all';
  setDashboardView('project');
}
function renderCompanyOverview(overview) {
  const content = clear($('#company-content'));
  $('#company-view-title').textContent = overview.company.name;
  $('#company-role').textContent = `Seu papel: ${roleLabel(overview.role)}`;
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
  const future = document.createElement('section');
  future.className = 'company-overview-section company-future';
  const futureTitle = document.createElement('h2');
  futureTitle.textContent = 'Plano e cobrança';
  const futureText = document.createElement('p');
  futureText.textContent = 'Em breve';
  future.append(futureTitle, futureText);
  content.append(future);
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
    const overview = await api(`/companies/${state.currentCompany.id}/overview`);
    if (request !== companyOverviewRequest || state.currentCompany.id !== studioShell.state().currentCompany?.id) return;
    status.textContent = '';
    status.dataset.state = overview.projects.length ? 'ready' : 'empty';
    renderCompanyOverview(overview);
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
  const title = escape($('#page-name').value.trim());
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    title +
    '</title><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,200..700,0..1,-25..200&display=block" rel="stylesheet"><style>' +
    editor.getCss() +
    '</style></head><body>' +
    editor.getHtml() +
    '<script>' +
    editor.getJs() +
    '</script></body></html>'
  );
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
function renderProjectContent(model) {
  const list = clear($('#project-content-list'));
  const content = filterProjectContent(model.content, projectContentFilter);
  if (!content.length) {
    const label = projectContentFilter === 'pages' ? 'landing pages' : projectContentFilter === 'forms' ? 'formulários' : 'conteúdos';
    list.append(projectEmpty(`Nenhum ${label} disponível.`, projectContentFilter === 'all' ? 'Crie uma landing page ou formulário para começar.' : 'Mude o filtro ou crie um novo conteúdo.'));
    return;
  }
  for (const item of content) {
    const row = document.createElement('article');
    row.className = 'project-content-row';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined project-content-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.kind === 'page' ? 'web' : 'dynamic_form';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.textContent = `${item.route || '/'} · ${item.status}${item.kind === 'form' ? ` · ${item.responses} ${item.responses === 1 ? 'resposta' : 'respostas'}` : ''}`;
    details.append(name, meta);
    if (projectContentAction(studioShell, item) === 'edit') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'project-content-open';
      edit.textContent = item.kind === 'page' ? 'Editar página' : 'Editar formulário';
      edit.onclick = action(() => item.kind === 'page' ? openPage(item.id) : formsUI.openForm(item.id));
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
  for (const [label, amount] of model.metrics) {
    const item = document.createElement('div');
    const value = document.createElement('strong');
    value.textContent = String(amount);
    const caption = document.createElement('span');
    caption.textContent = label;
    item.append(value, caption);
    metrics.append(item);
  }
  const modules = clear($('#project-modules'));
  for (const [name, state] of model.modules) {
    const item = document.createElement('div');
    const nameNode = document.createElement('strong');
    nameNode.textContent = name;
    const stateNode = document.createElement('span');
    stateNode.textContent = state;
    item.append(nameNode, stateNode);
    modules.append(item);
  }
  for (const button of $('#project-content-filter').querySelectorAll('button')) {
    if (button.dataset.projectFilter === projectContentFilter) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  renderProjectContent(model);
}
function renderPublication(overview, publication = {}) {
  const configured = publication.integration?.connectionStatus === 'configured' || overview.integrations?.vercel === 'configured';
  const publishedRoutes = (overview.content || []).filter((item) => item.published);
  const model = publicationModel({ connectionStatus: configured ? 'configured' : 'pending', run: publication.run, routes: publishedRoutes });
  $('#publication-state').textContent = model.label;
  $('#publication-state').dataset.state = model.state;
  $('#publication-routes').textContent = publishedRoutes.length
    ? `${publishedRoutes.length} ${publishedRoutes.length === 1 ? 'rota publicada' : 'rotas publicadas'}: ${publishedRoutes.map((item) => item.route).join(', ')}`
    : 'Nenhuma rota publicada ainda.';
  $('#publication-summary').textContent = configured
    ? 'Prévia e produção enviam todas as rotas publicadas deste projeto juntas.'
    : 'Conecte a Vercel uma vez para publicar todas as rotas deste projeto juntas.';
  $('#publication-preview').disabled = !model.canPreview || !studioShell.can('deployment.publish');
  $('#publication-production').disabled = !model.canProduction || !studioShell.can('deployment.publish');
  $('#publication-domain-form').hidden = !model.canProduction || !studioShell.can('integration.manage');
  const connection = $('#publication-connection-form');
  connection.elements.vercelProjectId.value = publication.integration?.vercelProjectId || '';
  connection.elements.teamId.value = publication.integration?.teamId || '';
  connection.elements.token.value = '';
}
async function renderProject() {
  if (!studioShell) return;
  const state = dashboardState();
  const status = $('#project-status');
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
    status.dataset.state = model.status;
    status.textContent = model.message;
    renderProjectOverview(overview);
    renderPublication(overview, publication);
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
    editor
      .getWrapper()
      .find('form')
      .forEach((form) => {
        form.addAttributes({ method: 'post', action: page.webhook || '#' });
        if (page.webhook) form.removeAttributes('onsubmit');
        else form.addAttributes({ onsubmit: 'return false' });
      });
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
  const search = $('#search').value.toLocaleLowerCase('pt-BR');
  const filtered = pages.filter((p) => p.name.toLocaleLowerCase('pt-BR').includes(search));
  $('#page-count').textContent = pages.length + ' ' + (pages.length === 1 ? 'página' : 'páginas');
  const list = $('#page-list');
  list.replaceChildren();
  if (!filtered.length) {
    list.innerHTML =
      '<div class="empty"><div class="empty-icon">↗</div><h2>' +
      (!pages.length ? 'Sua próxima campanha começa aqui.' : 'Nenhuma página encontrada.') +
      '</h2><p>' +
      (!pages.length
        ? 'Escolha um modelo, dê a sua cara e prepare a publicação.<br>A primeira landing page está a um clique.'
        : 'Tente buscar por outro nome.') +
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
      `</p><div class="card-actions">${editable ? '<button class="edit">Editar página ↗</button><button class="duplicate" title="Duplicar página">Duplicar</button><button class="delete" title="Excluir página">Excluir</button>' : '<span class="read-only">Somente leitura</span>'}</div></div>`;
    if (editable) {
      card.querySelector('.edit').onclick = action(() => openPage(p.id));
      card.querySelector('.duplicate').onclick = action(async () => {
        await api('/pages/' + p.id + '/duplicate', 'POST', {});
        await loadList();
        toast('Cópia criada. O domínio foi deixado em branco.');
      });
      card.querySelector('.delete').onclick = action(async () => {
        if (!confirm('Excluir “' + p.name + '” deste computador? Uma publicação existente na Vercel continuará no ar.'))
          return;
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
async function openPage(id) {
  const result = await api('/pages/' + id);
  page = result;
  loading = true;
  dirty = false;
  change = 0;
  $('#dashboard').hidden = true;
  $('#editing').hidden = false;
  $('#page-name').value = page.name;
  $('#save-state').textContent = 'Salvo neste computador';
  if (editor) editor.destroy();
  const template = getTemplate(page.template) || getTemplate('services');
  editor = createFriendlyEditor({
    container: '#editor',
    project: page.project,
    html: template.html,
    css: template.css,
    onChange: markDirty,
    onOpenFormSettings: () => $('#settings').click(),
  });
  loading = false;
  if (!page.project || editor.__alvaMigrated) markDirty();
  $('#device').value = 'Desktop';
  $('#publish').disabled = !config.vercelConnected;
  $('#publish').title = config.vercelConnected ? 'Publicar na Vercel' : 'Conecte sua conta em Configurações do app';
}
$('#new-page').onclick = () => {
  renderTemplates();
  $('#create-dialog').showModal();
};
$('#create-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const p = await api('/pages', 'POST', data);
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
  setDashboardView('project');
});
$('#device').onchange = () => editor.setDevice($('#device').value);
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
  editor
    .getWrapper()
    .find('form')
    .forEach((form) => {
      form.addAttributes({ method: 'post', action: page.webhook || '#' });
      if (page.webhook) form.removeAttributes('onsubmit');
      else form.addAttributes({ onsubmit: 'return false' });
    });
  markDirty();
  await save();
  toast('Configurações salvas.');
  $('#settings-dialog').close();
});
$('#publish').onclick = action(async () => {
  await save();
  if (editor.getWrapper().find('form').length && !page.webhook)
    throw new Error('Configure o destino do formulário antes de publicar.');
  if (!confirm('Publicar a versão atual de “' + page.name + '” na Vercel?')) return;
  $('#publish').disabled = true;
  try {
    page.deployment = await api('/pages/' + page.id + '/publish', 'POST', { revision: page.revision });
    toast('Enviada à Vercel. Consulte o andamento em Configurar.');
  } finally {
    $('#publish').disabled = !config.vercelConnected;
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
  if (!confirm('Conectar ' + page.domain + ' ao projeto desta página na Vercel?')) return;
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
    return config;
  }
  config = await api('/config');
  if (page) {
    $('#publish').disabled = !config.vercelConnected;
    $('#publish').title = config.vercelConnected ? 'Publicar na Vercel' : 'Conecte a Vercel nas configurações do app';
  }
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
formsUI = createFormsUI({ api, toast, onReturnToProject: returnToProject, can: (capability) => studioShell?.can(capability) });
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
  closeFormEditor: () => formsUI.closeEditor(),
  resetForms: () => formsUI.reset(),
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
    if (!$('#forms-view').hidden && state.currentProject) await formsUI.showForms();
  },
});
function renderCompanySwitcher(state = studioShell.state(), { selectedCompanyId = state.currentCompany?.id || '', disabled = state.phase === 'loading' || !state.companies.length } = {}) {
  const switcher = $('#company-switcher');
  switcher.replaceChildren();
  for (const company of state.companies) {
    const option = document.createElement('option');
    option.value = company.id;
    option.textContent = company.name;
    option.selected = company.id === selectedCompanyId;
    switcher.append(option);
  }
  switcher.disabled = disabled;
}
dashboardContextFlow = createDashboardContextFlow({
  shell: studioShell,
  renderState: renderDashboardState,
  renderSwitcher: renderCompanySwitcher,
});
$('#nav-home').onclick = () => setDashboardView('home');
$('#nav-company').onclick = () => setDashboardView('company');
$('#nav-project').onclick = action(async () => {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar sua visão geral.');
  projectContentFilter = 'all';
  setDashboardView('project');
});
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
  if (!confirm('Publicar todas as rotas deste projeto em produção?')) return;
  const publication = await api(`/projects/${projectId}/publication`);
  if (!publication.run?.id) throw new Error('Crie uma prévia antes de publicar em produção.');
  await api(`/projects/${projectId}/publication/production`, 'POST', { confirmed: true, previewRunId: publication.run.id, revision: 0 });
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
$('#publication-domain-form').onsubmit = action(async (event) => {
  event.preventDefault();
  const projectId = studioShell.state().currentProject?.id;
  const publication = await api(`/projects/${projectId}/publication`);
  const data = Object.fromEntries(new FormData(event.target));
  await api(`/projects/${projectId}/publication/domain`, 'POST', { ...data, runId: publication.run?.id });
  toast('Domínio conectado.');
  await renderProject();
});
$('#nav-pages').onclick = action(async () => {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar seus conteúdos.');
  setDashboardView('pages');
  $('#new-page').hidden = !studioShell.can('page.write');
  formsUI.showPages();
  await loadList();
});
$('#nav-forms').onclick = action(async () => {
  if (!studioShell.state().currentProject) throw new Error('Escolha ou crie um projeto antes de acessar seus conteúdos.');
  setDashboardView('forms');
  await formsUI.showForms();
});
$('#project-content-filter').onclick = (event) => {
  const button = event.target.closest('[data-project-filter]');
  if (!button) return;
  projectContentFilter = button.dataset.projectFilter;
  for (const item of $('#project-content-filter').querySelectorAll('button')) {
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  renderProject();
};
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
$('#company-switcher').onchange = action(async (event) => {
  if (event.target.value === studioShell.state().currentCompany?.id) return;
  await dashboardContextFlow.selectCompany(event.target.value);
  setDashboardView('home');
});
$('#new-project').onclick = () => {
  const form = $('#new-project-form');
  $('#new-project-error').textContent = '';
  form.reset();
  form.elements.slug.dataset.auto = 'true';
  $('#new-project-dialog').showModal();
};
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
      setDashboardView('home');
    }
  },
  beforeLogout: save,
  canManageIntegration: () => !studioShell?.state().session?.user || studioShell.can('integration.manage'),
  onLoggedOut: async () => {
    clearTimeout(timer);
    editor?.destroy();
    editor = null;
    page = null;
    resetPageList();
    $('#editing').hidden = true;
    $('#dashboard').hidden = true;
    formsUI.reset();
    companyOverviewRequest++;
    $('#company-switcher').replaceChildren();
  },
  onSettingsChanged: refreshConfig,
});
$('#app-settings').onclick = () => ownerUI.openSettings();
$('#page-vercel-settings').onclick = () => {
  if (!studioShell.can('integration.manage')) {
    toast('Você não tem permissão para configurar integrações.');
    return;
  }
  $('#settings-dialog').close();
  ownerUI.openSettings('vercel');
};
try {
  await ownerUI.initialize();
  $('#startup').remove();
} catch (error) {
  $('#startup').textContent = 'Não foi possível abrir o Studio. Recarregue a página para tentar novamente.';
  toast(error.message);
}
