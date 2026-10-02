const ROUTES = {
  home: '',
  company: 'empresa',
  history: 'historico',
  settings: 'configuracoes',
  project: 'projeto',
  pages: 'paginas',
  forms: 'quizzes',
  funnels: 'funis',
  vsl: 'vsl',
  analytics: 'analytics',
  tracking: 'rastreamento',
  agents: 'agentes',
  publication: 'publicacao',
  projectSettings: 'configuracoes-do-projeto',
};
// Endereços antigos continuam abrindo a tela nova: quem guardou o link de "formularios"
// não descobre uma página inicial no lugar do quiz.
const APELIDOS = { formularios: 'forms' };
const VIEWS = { ...APELIDOS, ...Object.fromEntries(Object.entries(ROUTES).map(([view, slug]) => [slug, view])) };
const DEFAULT_SETTINGS_TAB = 'account';
// As duas telas de configuração guardam a aba no endereço: a da conta e a do projeto (a volta
// do Facebook cai direto em "Rastreamento").
const VIEWS_WITH_TAB = new Set(['settings', 'projectSettings']);

export function viewToHash(view, { settingsTab = DEFAULT_SETTINGS_TAB } = {}) {
  const slug = ROUTES[view];
  if (!slug) return '#/';
  if (VIEWS_WITH_TAB.has(view) && settingsTab !== DEFAULT_SETTINGS_TAB) return `#/${slug}/${settingsTab}`;
  return `#/${slug}`;
}

export function hashToView(hash) {
  const [slug = '', tab = ''] = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/');
  const view = VIEWS[slug] ?? 'home';
  return { view, settingsTab: VIEWS_WITH_TAB.has(view) && tab ? tab : DEFAULT_SETTINGS_TAB };
}

export function createViewRouter({ window: win = window, onNavigate = () => {} } = {}) {
  let escritoPelaAplicacao = null;
  return {
    current: () => hashToView(win.location.hash),
    commit(view, options) {
      const hash = viewToHash(view, options);
      if (win.location.hash === hash) return;
      escritoPelaAplicacao = hash;
      win.location.hash = hash;
    },
    start() {
      win.addEventListener('hashchange', () => {
        if (escritoPelaAplicacao === win.location.hash) {
          escritoPelaAplicacao = null;
          return;
        }
        escritoPelaAplicacao = null;
        onNavigate(hashToView(win.location.hash));
      });
    },
  };
}

const VIEWS_NEEDING_PROJECT = new Set(['project', 'pages', 'forms', 'funnels', 'vsl', 'analytics', 'tracking', 'agents', 'publication', 'projectSettings']);

export function viewToRestore(route, { hasProject = false } = {}) {
  const fallback = hasProject ? 'project' : 'home';
  if (!route?.view || route.view === 'home') return fallback;
  if (VIEWS_NEEDING_PROJECT.has(route.view) && !hasProject) return 'home';
  return route.view;
}
