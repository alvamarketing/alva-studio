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

// Duas entradas de navegação podem apontar para a mesma seção — Páginas e Quizzes são a
// mesma tela. Decidir por seletor, e não por nome de view, evita que a segunda entrada
// esconda o que a primeira acabou de mostrar.
export function secoesEscondidas(secoes = {}, view = '') {
  const alvo = secoes[view];
  const visibilidade = {};
  for (const seletor of Object.values(secoes)) visibilidade[seletor] = seletor !== alvo;
  return visibilidade;
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

export function trackingPageModel(events, visible) {
  const linhas = Array.isArray(events) ? events : [];
  const limite = Math.max(0, Number(visible) || 0);
  return { rows: linhas.slice(0, limite), hasMore: linhas.length > limite, remaining: Math.max(0, linhas.length - limite) };
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

// Mapa de resultados: distribui os nós da jornada em colunas por profundidade
// (Entrada, Etapa 2, ...), calcula as coordenadas dos cartões e a curva de cada passagem.
const JOURNEY_MAX_NODES = 24;
const JOURNEY_CARD = { width: 168, height: 74, gapX: 96, gapY: 18, padding: 16 };

const rotuloDaOrigem = (atribuicao) => [atribuicao.source, atribuicao.campaign].filter(Boolean).join(' \u00b7 ');

// As atribuicoes viram a primeira coluna do mapa: cada origem e um no, ligado por uma
// passagem a cada pagina em que ela entrou. Mesma origem com entradas diferentes soma
// num no so, para nao repetir o mesmo cartao lado a lado.
function origensDaJornada(graph, paginasPermitidas) {
  const porOrigem = new Map();
  for (const atribuicao of graph?.attributions ?? []) {
    if (!paginasPermitidas.has(atribuicao.entry)) continue;
    const rotulo = rotuloDaOrigem(atribuicao);
    if (!rotulo) continue;
    const id = `origem:${rotulo}`;
    if (!porOrigem.has(id)) porOrigem.set(id, { id, type: 'source', label: rotulo, pageviews: 0, sessions: 0, entries: 0, exits: 0, entradas: new Map() });
    const origem = porOrigem.get(id);
    origem.sessions += atribuicao.sessions;
    origem.pageviews += atribuicao.sessions;
    origem.entries += atribuicao.sessions;
    origem.entradas.set(atribuicao.entry, (origem.entradas.get(atribuicao.entry) ?? 0) + atribuicao.sessions);
  }
  const nos = [];
  const arestas = [];
  for (const { entradas, ...origem } of porOrigem.values()) {
    nos.push(origem);
    for (const [entrada, sessoes] of entradas) {
      arestas.push({ source: origem.id, target: entrada, transitions: sessoes, sessions: sessoes });
    }
  }
  return { nos, arestas };
}

// Cadeia de um cartão: tudo que leva até ele e tudo que sai dele. Para um fim de linha
// como /obrigado, só o que sai seria vazio — o que interessa é justamente o caminho de trás.
export function journeyConnected(graph, nodeId) {
  const alcancados = new Set();
  if (!nodeId || !graph) return alcancados;
  const arestas = graph.edges ?? [];
  alcancados.add(nodeId);
  for (const [de, para] of [['source', 'target'], ['target', 'source']]) {
    const fila = [nodeId];
    while (fila.length) {
      const atual = fila.shift();
      for (const aresta of arestas) {
        if (aresta[de] !== atual || alcancados.has(aresta[para])) continue;
        alcancados.add(aresta[para]);
        fila.push(aresta[para]);
      }
    }
  }
  return alcancados;
}

export function journeyLayout(graph, { maxNodes = JOURNEY_MAX_NODES } = {}) {
  const paginas = [...(graph?.nodes ?? [])].sort((a, b) => b.pageviews - a.pageviews).slice(0, maxNodes);
  const permitidos = new Set(paginas.map((no) => no.id));
  const origens = origensDaJornada(graph, permitidos);
  const nodes = [...origens.nos, ...paginas];
  const edges = [
    ...origens.arestas,
    ...(graph?.edges ?? []).filter((e) => permitidos.has(e.source) && permitidos.has(e.target)),
  ];
  if (!nodes.length) return { nodes: [], edges: [], columns: [], width: 0, height: 0, cardWidth: JOURNEY_CARD.width, cardHeight: JOURNEY_CARD.height };

  // profundidade: abre o mapa quem não recebe passagem de ninguém; cada passagem empurra
  // o destino uma coluna adiante. Em ciclo, a página com mais entradas vira a raiz.
  const recebe = new Set(edges.map((aresta) => aresta.target));
  const profundidade = new Map(nodes.map((no) => [no.id, recebe.has(no.id) ? Infinity : 0]));
  if (![...profundidade.values()].some((valor) => valor === 0)) {
    profundidade.set([...nodes].sort((a, b) => b.entries - a.entries)[0].id, 0);
  }
  for (let volta = 0; volta < nodes.length; volta += 1) {
    let mudou = false;
    for (const aresta of edges) {
      const origem = profundidade.get(aresta.source);
      if (origem === Infinity) continue;
      if (profundidade.get(aresta.target) > origem + 1) { profundidade.set(aresta.target, origem + 1); mudou = true; }
    }
    if (!mudou) break;
  }
  for (const [id, valor] of profundidade) if (valor === Infinity) profundidade.set(id, 0);

  const porColuna = new Map();
  for (const no of nodes) {
    const nivel = profundidade.get(no.id);
    if (!porColuna.has(nivel)) porColuna.set(nivel, []);
    porColuna.get(nivel).push(no);
  }
  const niveis = [...porColuna.keys()].sort((a, b) => a - b);
  const posicionados = [];
  for (const nivel of niveis) {
    const coluna = porColuna.get(nivel).sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id));
    for (const [linha, no] of coluna.entries()) {
      posicionados.push({
        ...no,
        depth: nivel,
        x: JOURNEY_CARD.padding + nivel * (JOURNEY_CARD.width + JOURNEY_CARD.gapX),
        y: JOURNEY_CARD.padding + linha * (JOURNEY_CARD.height + JOURNEY_CARD.gapY),
      });
    }
  }
  const posicaoDe = new Map(posicionados.map((no) => [no.id, no]));
  // A participação responde "de quem viu esta página, quantos seguiram por aqui" — por isso
  // a base são as visualizações da origem, não a soma das passagens desenhadas.
  const vistasDaOrigem = new Map(nodes.map((no) => [no.id, no.pageviews]));

  // Rótulo no meio da curva faz as passagens de um mesmo cartão se empilharem no mesmo
  // ponto. Cada uma escreve o seu em uma fração diferente do caminho, e só as três
  // maiores de cada origem trazem rótulo fixo — o resto aparece quando o caminho é aceso.
  const ordemNaOrigem = new Map();
  const forca = [...edges].sort((a, b) => b.transitions - a.transitions);
  for (const aresta of forca) {
    const anteriores = ordemNaOrigem.get(aresta.source) ?? [];
    anteriores.push(aresta);
    ordemNaOrigem.set(aresta.source, anteriores);
  }
  const posicaoNaOrigem = new Map();
  for (const [origem, lista] of ordemNaOrigem) {
    for (const [indice, aresta] of lista.entries()) posicaoNaOrigem.set(aresta, { indice, total: lista.length, origem });
  }
  const pontoNaCurva = (t, x1, y1, c1, c2, x2, y2) => {
    const u = 1 - t;
    return {
      x: u ** 3 * x1 + 3 * u ** 2 * t * c1 + 3 * u * t ** 2 * c2 + t ** 3 * x2,
      y: u ** 3 * y1 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y2,
    };
  };
  const desenhadas = edges.map((aresta) => {
    const de = posicaoDe.get(aresta.source);
    const para = posicaoDe.get(aresta.target);
    const x1 = de.x + JOURNEY_CARD.width;
    const y1 = de.y + JOURNEY_CARD.height / 2;
    const x2 = para.x;
    const y2 = para.y + JOURNEY_CARD.height / 2;
    const curva = (x2 - x1) / 2;
    const total = vistasDaOrigem.get(aresta.source) || 0;
    const lugar = posicaoNaOrigem.get(aresta) ?? { indice: 0, total: 1 };
    const t = lugar.total === 1 ? 0.5 : 0.26 + (lugar.indice / Math.max(1, lugar.total - 1)) * 0.48;
    const ponto = pontoNaCurva(t, x1, y1, x1 + curva, x2 - curva, x2, y2);
    return {
      ...aresta,
      path: `M${x1},${y1} C${x1 + curva},${y1} ${x2 - curva},${y2} ${x2},${y2}`,
      share: total ? `${Math.round((aresta.transitions / total) * 100)}%` : '0%',
      major: lugar.indice < 3,
      labelX: ponto.x,
      labelY: ponto.y,
    };
  });

  const maiorColuna = Math.max(...niveis.map((nivel) => porColuna.get(nivel).length));
  const temOrigens = origens.nos.length > 0;
  return {
    nodes: posicionados,
    edges: desenhadas,
    columns: niveis.map((nivel) => ({
      depth: nivel,
      title: temOrigens
        ? (nivel === 0 ? 'Origem' : nivel === 1 ? 'Entrada' : `Etapa ${nivel}`)
        : (nivel === 0 ? 'Entrada' : `Etapa ${nivel + 1}`),
      x: JOURNEY_CARD.padding + nivel * (JOURNEY_CARD.width + JOURNEY_CARD.gapX),
    })),
    width: JOURNEY_CARD.padding * 2 + niveis.length * JOURNEY_CARD.width + Math.max(0, niveis.length - 1) * JOURNEY_CARD.gapX,
    height: JOURNEY_CARD.padding * 2 + maiorColuna * JOURNEY_CARD.height + Math.max(0, maiorColuna - 1) * JOURNEY_CARD.gapY,
    cardWidth: JOURNEY_CARD.width,
    cardHeight: JOURNEY_CARD.height,
  };
}
