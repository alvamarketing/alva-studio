export function isProjectSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value ?? ''));
}

export function createAuthenticatedApi({ request = globalThis.fetch, onSessionExpired = () => {}, prefix = '/api' } = {}) {
  if (typeof request !== 'function') throw new Error('A requisição HTTP do Studio é obrigatória.');
  const isPublicFlow = (path) => ['/setup', '/login'].includes(path) || path.startsWith('/public/');
  return {
    async request(path, method = 'GET', data) {
      const response = await request(prefix + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 && !isPublicFlow(path)) onSessionExpired();
        throw Object.assign(new Error(result.error || 'Não foi possível concluir.'), { status: response.status });
      }
      return result;
    },
  };
}

export function applyDashboardNavigation(navigation, active) {
  for (const [name, element] of Object.entries(navigation)) {
    const current = name === active;
    element.classList.toggle('nav-active', current);
    if (current) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  }
}

export function canCreateProject(shell) {
  return Boolean(shell?.can?.('project.manage'));
}

export function dashboardModel({ phase = 'empty', error = '', companies = [], projects = [] } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando seu Studio…', companies: [], projects: [], activity: [] };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar seu Studio.', companies: [], projects: [], activity: [] };
  if (!projects.length) return { status: 'empty', message: 'Você ainda não tem projetos disponíveis.', companies, projects: [], activity: [] };
  return { status: 'ready', message: '', companies, projects, activity: [...projects].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))) };
}

export function createLatestRequestGuard() {
  let generation = 0;
  return {
    next() {
      generation += 1;
      return generation;
    },
    isCurrent(request, context, currentContext) {
      return request === generation && context === currentContext;
    },
  };
}

export function projectCardCounts(overview = {}) {
  const counts = overview.counts || {};
  return {
    pages: Number(counts.pages || 0),
    forms: Number(counts.forms || 0),
    videos: Number(counts.videos || 0),
    submissions: Number(counts.submissions || 0),
    published: Number(counts.publishedPages || 0) + Number(counts.publishedForms || 0) + Number(counts.publishedVideos || 0),
  };
}

export function filterProjectContent(content = [], filter = 'all') {
  const kind = filter === 'pages' ? 'page' : filter === 'forms' ? 'form' : filter === 'videos' ? 'video' : '';
  return kind ? content.filter((item) => item.kind === kind) : [...content];
}

export function projectContentAction(shell, item) {
  const capability = item?.kind === 'form' ? 'form.write' : item?.kind === 'video' ? 'video.write' : 'page.write';
  return shell?.can?.(capability) ? 'edit' : 'read';
}

export function createMobileDrawerController({ drawer, trigger, focusable, activeElement = () => document.activeElement } = {}) {
  if (!drawer || !trigger || typeof focusable !== 'function') throw new Error('Os controles do menu móvel são obrigatórios.');
  const setOpen = (open, { returnFocus = false } = {}) => {
    drawer.classList?.toggle('is-open', open);
    drawer.inert = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    if (open) focusable()[0]?.focus();
    else if (returnFocus) trigger.focus();
  };
  return {
    open: () => setOpen(true),
    close: (options) => setOpen(false, options),
    handleKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false, { returnFocus: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      const active = activeElement();
      if ((event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    },
  };
}

export function projectOverviewModel(overview, { phase = 'ready', error = '' } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando projeto…', content: [], metrics: [], modules: [] };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar este projeto.', content: [], metrics: [], modules: [] };
  if (!overview?.project) return { status: 'empty', message: 'Escolha ou crie um projeto para continuar.', content: [], metrics: [], modules: [] };

  const counts = overview.counts || {};
  const content = (overview.content || []).map((item) => ({
    ...item,
    status: item.published ? 'Publicado' : 'Rascunho',
    responses: Number(item.submissionCount || 0),
  }));
  const published = Number(counts.publishedPages || 0) + Number(counts.publishedForms || 0) + Number(counts.publishedVideos || 0);
  const configured = (value) => value === 'configured' ? 'Configurado' : 'Ainda não configurado';
  return {
    status: content.length ? 'ready' : 'empty',
    message: content.length ? '' : 'Este projeto ainda não tem conteúdos.',
    title: overview.project.name,
    slug: overview.project.slug,
    project: overview.project,
    metrics: [
      ['Páginas', Number(counts.pages || 0)],
      ['Quizzes', Number(counts.forms || 0)],
      ['VSLs', Number(counts.videos || 0)],
      ['Publicados', published],
      ['Leads / respostas', Number(counts.submissions || 0)],
    ],
    content,
    domain: overview.domain?.verificationStatus === 'verified'
      ? { label: overview.domain.domain, state: 'verified' }
      : { label: 'Domínio ainda não verificado', state: 'pending' },
    modules: [
      ['Analytics', configured(overview.integrations?.analytics)],
      ['Rastreamento', 'Em breve'],
      ['Publicação', configured(overview.integrations?.vercel)],
      ['Agentes', configured(overview.integrations?.agents)],
    ],
  };
}

const ANALYTICS_DAYS = 7;
const ANALYTICS_FUNNEL_STEPS = 4;
const ANALYTICS_WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

// GET /api/projects/:id/analytics/summary exige from/to (server/project-api.mjs, analyticsRange) —
// sem isso o endpoint sempre responde 400. "Últimos 7 dias" é o recorte que o próprio título do cartão promete.
export function analyticsRangeParams(now = new Date()) {
  const to = new Date(now);
  const from = new Date(to.getTime() - ANALYTICS_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function analyticsPanelModel(summary, { phase = 'ready', error = '', canRead = true } = {}) {
  if (!canRead) return { phase: 'hidden', bars: [], funnel: [], updatedLabel: '' };
  if (phase === 'loading') return { phase: 'loading', bars: [], funnel: [], updatedLabel: '' };
  if (phase === 'error') return { phase: 'error', message: error || 'Não foi possível carregar as visitas.', bars: [], funnel: [], updatedLabel: '' };

  const days = Array.isArray(summary?.dailyVisits) ? summary.dailyVisits.slice(-ANALYTICS_DAYS) : [];
  const padded = Array.from({ length: ANALYTICS_DAYS }, (_, index) => days[index] || null);
  const max = Math.max(1, ...padded.map((day) => Number(day?.visits) || 0));
  const bars = padded.map((day) => {
    const visitas = Number(day?.visits) || 0;
    return {
      dia: day?.date ? ANALYTICS_WEEKDAY.format(new Date(day.date)) : '',
      visitas,
      altura: Math.round((visitas / max) * 100),
    };
  });
  const funnel = Array.isArray(summary?.funnel) ? summary.funnel.slice(0, ANALYTICS_FUNNEL_STEPS) : [];
  const hasVisits = bars.some((bar) => bar.visitas > 0);

  return {
    phase: hasVisits || funnel.length ? 'ready' : 'empty',
    bars,
    funnel,
    updatedLabel: 'Coletor interno · atualizado agora',
  };
}

export function publicationModel({ connectionStatus = 'pending', run = null, routes = [], canPublish = undefined } = {}) {
  const count = Array.isArray(routes) ? routes.length : Number(routes || 0);
  if (canPublish === false) return { state: 'blocked', label: 'Sem permissão', routes: count, canPreview: false, canProduction: false, publishMessage: 'Você não tem permissão para publicar. Peça acesso a um administrador.' };
  if (connectionStatus !== 'configured') return { state: 'pending', label: 'Conecte a Vercel', routes: count, canPreview: false, canProduction: false };
  const status = String(run?.status || '').toUpperCase();
  const state = status === 'READY' ? 'ready' : ['ERROR', 'CANCELED', 'BLOCKED'].includes(status) ? 'error' : status ? 'preparing' : 'idle';
  const label = state === 'ready' ? 'No ar' : state === 'error' ? 'Falhou' : state === 'preparing' ? 'Preparando' : 'Pronto para prévia';
  return { state, label, routes: count, canPreview: true, canProduction: state === 'ready' };
}

export function roleLabel(role) {
  return ({ owner: 'Proprietário', admin: 'Administrador', editor: 'Editor', analyst: 'Analista', viewer: 'Visualizador' })[role] || 'Membro';
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Não foi possível atualizar a empresa.';
}

function loadingState(state) {
  return { ...state, phase: 'loading', projects: [], currentProject: null, error: '' };
}

function failedState(state, error) {
  return {
    phase: 'error',
    session: state.session ?? null,
    companies: [],
    projects: [],
    currentCompany: null,
    currentProject: null,
    error: errorMessage(error),
  };
}

export function createDashboardContextFlow({ shell, renderState, renderSwitcher }) {
  if (!shell || typeof shell.state !== 'function' || typeof shell.selectCompany !== 'function')
    throw new Error('O contexto do Studio é obrigatório.');
  if (typeof renderState !== 'function' || typeof renderSwitcher !== 'function')
    throw new Error('Os renderizadores do dashboard são obrigatórios.');

  let confirmed = shell.state();

  const confirm = () => {
    confirmed = shell.state();
    renderSwitcher(confirmed, { selectedCompanyId: confirmed.currentCompany?.id || '', disabled: false });
    return confirmed;
  };

  return {
    async selectCompany(companyId) {
      const previous = confirmed;
      renderState(loadingState(previous));
      renderSwitcher(previous, { selectedCompanyId: companyId, disabled: true });
      try {
        return await shell.selectCompany(companyId);
      } catch (error) {
        renderState(failedState(previous, error));
        renderSwitcher(previous, { selectedCompanyId: previous.currentCompany?.id || '', disabled: false });
        throw error;
      }
    },
    confirm,
    bootstrap: confirm,
  };
}

export function createDashboardProjectFlow({ shell, renderState, renderSwitcher }) {
  if (!shell || typeof shell.state !== 'function' || typeof shell.selectProject !== 'function')
    throw new Error('O contexto de projeto do Studio é obrigatório.');
  if (typeof renderState !== 'function' || typeof renderSwitcher !== 'function')
    throw new Error('Os renderizadores do dashboard são obrigatórios.');

  let confirmed = shell.state();
  const confirm = () => {
    confirmed = shell.state();
    renderSwitcher(confirmed, { selectedProjectId: confirmed.currentProject?.id || '', disabled: false });
    return confirmed;
  };
  return {
    async selectProject(projectId) {
      const previous = confirmed;
      renderState(loadingState(previous));
      renderSwitcher(previous, { selectedProjectId: projectId, disabled: true });
      try {
        return await shell.selectProject(projectId);
      } catch (error) {
        renderState(failedState(previous, error));
        renderSwitcher(previous, { selectedProjectId: previous.currentProject?.id || '', disabled: false });
        throw error;
      }
    },
    confirm,
    bootstrap: confirm,
  };
}

export function createProjectSubmission({ createProject, selectProject, closeDialog, showError }) {
  if ([createProject, selectProject, closeDialog, showError].some((value) => typeof value !== 'function'))
    throw new Error('Os controles de criação de projeto são obrigatórios.');

  return {
    async submit(input) {
      let project;
      try {
        project = await createProject(input);
        await selectProject(project.id);
        closeDialog();
        showError('');
        return project;
      } catch (error) {
        if (project) {
          const message = `O projeto “${project.name}” foi criado, mas não foi possível selecioná-lo: ${errorMessage(error)}`;
          showError(message);
          throw new Error(message, { cause: error });
        }
        showError(errorMessage(error));
        throw error;
      }
    },
  };
}
