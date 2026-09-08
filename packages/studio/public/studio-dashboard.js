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
  const mediaEnabled = overview.runtime?.media !== false;
  return {
    pages: Number(counts.pages || 0),
    forms: Number(counts.forms || 0),
    videos: mediaEnabled ? Number(counts.videos || 0) : 0,
    submissions: Number(counts.submissions || 0),
    published: Number(counts.publishedPages || 0) + Number(counts.publishedForms || 0) + Number(counts.publishedVideos || 0),
  };
}

export function filterProjectContent(content = [], filter = 'all') {
  const kind = filter === 'pages' ? 'page' : filter === 'forms' ? 'form' : filter === 'videos' ? 'video' : '';
  return kind ? content.filter((item) => item.kind === kind) : [...content];
}

export function previewProjectContent(content = [], limit = 3) {
  return content.slice(0, limit);
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
  const mediaEnabled = overview.runtime?.media !== false;
  const content = (overview.content || []).filter((item) => mediaEnabled || item.kind !== 'video').map((item) => ({
    ...item,
    status: item.published ? 'Publicado' : 'Rascunho',
    responses: Number(item.submissionCount || 0),
  }));
  const publishedPages = Number(counts.publishedPages || 0);
  const publishedForms = Number(counts.publishedForms || 0);
  const publishedVideos = mediaEnabled ? Number(counts.publishedVideos || 0) : 0;
  const published = publishedPages + publishedForms + publishedVideos;
  const visitors = Number(overview.analytics?.visitors);
  const hasVisitors = Object.hasOwn(overview.analytics || {}, 'visitors') && Number.isFinite(visitors);
  const submissions = Number(counts.submissions || 0);
  const number = (value) => new Intl.NumberFormat('pt-BR').format(value);
  const configured = (value) => value === 'configured' ? 'Configurado' : 'Ainda não configurado';
  const analyticsConfigured = overview.runtime?.analytics === true && overview.integrations?.analytics === 'configured';
  const publishedDetail = [
    `${publishedPages} ${publishedPages === 1 ? 'página' : 'páginas'}`,
    `${publishedForms} ${publishedForms === 1 ? 'formulário' : 'formulários'}`,
  ];
  if (mediaEnabled && (overview.runtime?.media === true || Number(counts.videos || 0) > 0 || Number(counts.publishedVideos || 0) > 0)) {
    publishedDetail.push(`${publishedVideos} ${publishedVideos === 1 ? 'VSL' : 'VSLs'}`);
  }
  const structure = [
    { icon: 'language', label: 'Domínio', detail: overview.domain?.domain || 'Domínio pendente', state: overview.domain?.verificationStatus === 'verified' ? 'Ativo' : 'Pendente' },
    { icon: 'cloud', label: 'Vercel', detail: 'Publicação do projeto', state: overview.integrations?.vercel === 'configured' ? 'Conectada' : 'Pendente' },
    { icon: 'monitoring', label: 'Analytics + Tracking', detail: 'Dados do projeto', state: analyticsConfigured ? 'Ativo' : 'Pendente' },
    { icon: 'smart_toy', label: 'Agentes', detail: 'Acesso do projeto', state: overview.integrations?.agents === 'configured' ? 'Conectados' : 'Pendente' },
  ];
  const structureComplete = structure.filter((item) => ['Ativo', 'Conectada', 'Conectados'].includes(item.state)).length;
  return {
    status: content.length ? 'ready' : 'empty',
    message: content.length ? '' : 'Este projeto ainda não tem conteúdos.',
    title: overview.project.name,
    slug: overview.project.slug,
    project: overview.project,
    metrics: [
      { label: 'VISITANTES', value: hasVisitors ? number(visitors) : '—', detail: hasVisitors ? 'Nos últimos 7 dias' : 'Dados indisponíveis' },
      { label: 'LEADS', value: number(submissions), detail: submissions === 1 ? 'Resposta recebida' : 'Respostas recebidas' },
      { label: 'CONVERSÃO', value: hasVisitors && visitors > 0 ? `${(submissions / visitors * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—', detail: hasVisitors && visitors > 0 ? 'Leads por visitante' : hasVisitors ? 'Sem visitas para calcular' : 'Aguardando visitas' },
      { label: 'ATIVOS PUBLICADOS', value: number(published), detail: publishedDetail.join(' · ') },
    ],
    content,
    domain: overview.domain?.verificationStatus === 'verified'
      ? { label: overview.domain.domain, state: 'verified' }
      : { label: 'Domínio ainda não verificado', state: 'pending' },
    structure,
    structureComplete,
    structureTotal: structure.length,
    modules: [
      ['Analytics', configured(analyticsConfigured ? 'configured' : 'pending')],
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
export function analyticsRangeParams(now = new Date(), days = ANALYTICS_DAYS) {
  const to = new Date(now);
  const janela = Number(days) > 0 ? Number(days) : ANALYTICS_DAYS;
  const from = new Date(to.getTime() - janela * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const NUMERO = new Intl.NumberFormat('pt-BR');
const numero = (value) => (Number.isFinite(Number(value)) && value !== null && value !== undefined ? NUMERO.format(Number(value)) : '—');

function duracaoMedia(totalTime, visits) {
  if (!Number.isFinite(Number(totalTime)) || !Number(visits)) return '—';
  const segundos = Math.round(Number(totalTime) / Number(visits));
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const resto = segundos % 60;
  return [...(horas ? [`${horas}h`] : []), ...(horas || minutos ? [`${minutos}m`] : []), `${resto}s`].join(' ');
}

function taxaDeRejeicao(bounces, visits) {
  if (!Number.isFinite(Number(bounces)) || !Number(visits)) return '—';
  return `${Math.round((Number(bounces) / Number(visits)) * 100)}%`;
}

const PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ESTADO_ENTREGA = { delivered: 'Entregue', dead: 'Encerrada' };

export function trackingMetricsModel(deliveries) {
  const linhas = Array.isArray(deliveries) ? deliveries : [];
  const eventos = new Set(linhas.map((linha) => linha?.eventRef ?? linha?.id)).size;
  const conta = (estado) => linhas.filter((linha) => (estado === 'pending' ? !ESTADO_ENTREGA[linha?.status] : linha?.status === estado)).length;
  const parcela = (quantidade) => (linhas.length ? `${PERCENTUAL.format((quantidade / linhas.length) * 100)}%` : '');
  const entregues = conta('delivered');
  const tentando = conta('pending');
  const encerradas = conta('dead');
  return [
    { key: 'received', label: 'Eventos recebidos', value: numero(eventos), detail: '' },
    { key: 'delivered', label: 'Entregues', value: numero(entregues), detail: parcela(entregues) },
    { key: 'retrying', label: 'Em nova tentativa', value: numero(tentando), detail: parcela(tentando) },
    { key: 'dead', label: 'Falhas encerradas', value: numero(encerradas), detail: parcela(encerradas) },
  ];
}

export function trackingEventsModel(deliveries) {
  const linhas = Array.isArray(deliveries) ? deliveries : [];
  const porEvento = new Map();
  for (const linha of linhas) {
    const chave = linha?.eventRef ?? linha?.id;
    if (!porEvento.has(chave)) {
      porEvento.set(chave, {
        eventRef: chave,
        eventName: linha?.eventName ?? '',
        contentId: linha?.contentId ?? '',
        consentState: linha?.consentState ?? 'pending',
        consentLabel: linha?.consentState ?? 'pending',
        receivedAt: linha?.createdAt ?? null,
        destinations: [],
        delivered: 0,
        total: 0,
        status: 'Entregue',
      });
    }
    const evento = porEvento.get(chave);
    evento.destinations.push(linha?.destination);
    evento.total += 1;
    if (linha?.status === 'delivered') evento.delivered += 1;
    if (linha?.status === 'dead') evento.status = 'Encerrada';
    else if (evento.status !== 'Encerrada' && linha?.status !== 'delivered') evento.status = 'Nova tentativa';
  }
  return [...porEvento.values()];
}

export function trackingHealthModel(deliveries) {
  const linhas = Array.isArray(deliveries) ? deliveries : [];
  const porDestino = new Map();
  for (const linha of linhas) {
    const destino = linha?.destination;
    if (!destino) continue;
    if (!porDestino.has(destino)) porDestino.set(destino, { destination: destino, delivered: 0, total: 0 });
    const alvo = porDestino.get(destino);
    alvo.total += 1;
    if (linha?.status === 'delivered') alvo.delivered += 1;
  }
  return [...porDestino.values()].map((alvo) => ({ destination: alvo.destination, rate: `${Math.round((alvo.delivered / alvo.total) * 100)}%`, delivered: alvo.delivered, total: alvo.total }));
}

export function analyticsRankModel(rows, limit = 5) {
  const lista = (Array.isArray(rows) ? rows : []).slice(0, limit);
  const total = lista.reduce((soma, linha) => soma + (Number(linha?.total) || 0), 0);
  const maior = Math.max(0, ...lista.map((linha) => Number(linha?.total) || 0));
  return lista.map((linha) => {
    const valor = Number(linha?.total) || 0;
    return {
      label: linha?.urlPath || linha?.source || '(direto)',
      value: numero(valor),
      share: `${total ? Math.round((valor / total) * 100) : 0}%`,
      width: `${maior ? Math.round((valor / maior) * 100) : 0}%`,
    };
  });
}

export function analyticsMetricsModel(summary) {
  return [
    { key: 'pageviews', label: 'Visualizações', value: numero(summary?.pageviews) },
    { key: 'visits', label: 'Visitas', value: numero(summary?.visits) },
    { key: 'visitors', label: 'Visitantes', value: numero(summary?.visitors) },
    { key: 'bounceRate', label: 'Taxa de rejeição', value: taxaDeRejeicao(summary?.bounces, summary?.visits) },
    { key: 'averageTime', label: 'Duração média', value: duracaoMedia(summary?.totalTime, summary?.visits) },
  ];
}

export function analyticsPanelModel(summary, { phase = 'ready', error = '', canRead = true } = {}) {
  if (!canRead) return { phase: 'hidden', bars: [], funnel: [], metrics: [], updatedLabel: '' };
  if (phase === 'loading') return { phase: 'loading', bars: [], funnel: [], metrics: analyticsMetricsModel(null), updatedLabel: '' };
  if (phase === 'error') return { phase: 'error', message: error || 'Não foi possível carregar as visitas.', bars: [], funnel: [], metrics: analyticsMetricsModel(null), updatedLabel: '' };

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
    metrics: analyticsMetricsModel(summary),
    updatedLabel: summary?.source === 'legacy'
      ? 'Coletor legado · migração pendente'
      : 'Origem dos dados indisponível',
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
