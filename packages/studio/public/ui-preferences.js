const THEMES = new Set(['system', 'light', 'dark']);
const THEME_KEY = 'alva-studio-theme';
const SIDEBAR_KEY = 'alva-studio-sidebar-collapsed';

export function normalizeTheme(value) {
  return THEMES.has(value) ? value : 'system';
}

export function resolveTheme(preference, systemIsDark) {
  const normalized = normalizeTheme(preference);
  return normalized === 'system' ? (systemIsDark ? 'dark' : 'light') : normalized;
}

export function nextSidebarState(collapsed) {
  return !collapsed;
}

const read = (storage, key) => {
  try {
    return storage?.getItem(key);
  } catch {
    return null;
  }
};

const write = (storage, key, value) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // The preference still works for this visit when storage is unavailable.
  }
};

export function createUIPreferences({
  root = document.documentElement,
  storage = window.localStorage,
  media = window.matchMedia('(prefers-color-scheme: dark)'),
  themeSelect = document.querySelector('#appearance-theme'),
  sidebarToggle = document.querySelector('#sidebar-toggle'),
} = {}) {
  let theme = normalizeTheme(read(storage, THEME_KEY));
  let collapsed = read(storage, SIDEBAR_KEY) === 'true';

  const applyTheme = () => {
    root.dataset.themePreference = theme;
    root.dataset.colorScheme = resolveTheme(theme, media.matches);
    if (themeSelect) themeSelect.value = theme;
  };
  const applySidebar = () => {
    root.dataset.sidebarCollapsed = String(collapsed);
    if (!sidebarToggle) return;
    const expanded = !collapsed;
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebarToggle.title = expanded ? 'Recolher menu' : 'Expandir menu';
    const label = sidebarToggle.querySelector('.sidebar-label');
    if (label) label.textContent = expanded ? 'Recolher menu' : 'Expandir menu';
  };
  const onSystemChange = () => {
    if (theme === 'system') applyTheme();
  };

  themeSelect?.addEventListener('change', () => {
    theme = normalizeTheme(themeSelect.value);
    write(storage, THEME_KEY, theme);
    applyTheme();
  });
  sidebarToggle?.addEventListener('click', () => {
    collapsed = nextSidebarState(collapsed);
    write(storage, SIDEBAR_KEY, String(collapsed));
    applySidebar();
  });
  media.addEventListener?.('change', onSystemChange);
  applyTheme();
  applySidebar();

  return { applyTheme, applySidebar };
}
