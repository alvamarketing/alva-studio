const ROUTES = {
  home: '',
  company: 'empresa',
  history: 'historico',
  settings: 'configuracoes',
  project: 'projeto',
  pages: 'paginas',
  forms: 'formularios',
  vsl: 'vsl',
  analytics: 'analytics',
  tracking: 'rastreamento',
  agents: 'agentes',
  publication: 'publicacao',
};
const VIEWS = Object.fromEntries(Object.entries(ROUTES).map(([view, slug]) => [slug, view]));
const DEFAULT_SETTINGS_TAB = 'account';

export function viewToHash(view, { settingsTab = DEFAULT_SETTINGS_TAB } = {}) {
  const slug = ROUTES[view];
  if (!slug) return '#/';
  if (view === 'settings' && settingsTab !== DEFAULT_SETTINGS_TAB) return `#/${slug}/${settingsTab}`;
  return `#/${slug}`;
}

export function hashToView(hash) {
  const [slug = '', tab = ''] = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/');
  const view = VIEWS[slug] ?? 'home';
  return { view, settingsTab: view === 'settings' && tab ? tab : DEFAULT_SETTINGS_TAB };
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

const VIEWS_NEEDING_PROJECT = new Set(['project', 'pages', 'forms', 'vsl', 'analytics', 'tracking', 'agents', 'publication']);

export function viewToRestore(route, { hasProject = false } = {}) {
  const fallback = hasProject ? 'project' : 'home';
  if (!route?.view || route.view === 'home') return fallback;
  if (VIEWS_NEEDING_PROJECT.has(route.view) && !hasProject) return 'home';
  return route.view;
}
