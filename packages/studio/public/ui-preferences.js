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

export function nextTheme(value) {
  return { system: 'light', light: 'dark', dark: 'system' }[normalizeTheme(value)];
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
  themeButton = document.querySelector('#appearance-theme'),
  sidebarToggle = document.querySelector('#sidebar-toggle'),
} = {}) {
  let theme = normalizeTheme(read(storage, THEME_KEY));
  let collapsed = read(storage, SIDEBAR_KEY) === 'true';

  const applyTheme = () => {
    root.dataset.themePreference = theme;
    root.dataset.colorScheme = resolveTheme(theme, media.matches);
    if (themeButton) {
      const labels = { system: 'Sistema', light: 'Claro', dark: 'Escuro' };
      const icons = { system: 'computer', light: 'light_mode', dark: 'dark_mode' };
      const label = `Aparência: ${labels[theme]}. Clique para mudar.`;
      themeButton.setAttribute('aria-label', label);
      themeButton.title = label;
      const icon = themeButton.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = icons[theme];
    }
  };
  const applySidebar = () => {
    root.dataset.sidebarCollapsed = String(collapsed);
    if (!sidebarToggle) return;
    const expanded = !collapsed;
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebarToggle.title = expanded ? 'Recolher menu' : 'Expandir menu';
    const label = sidebarToggle.querySelector('.sidebar-label');
    if (label) label.textContent = expanded ? 'Recolher menu' : 'Expandir menu';
    const icon = sidebarToggle.querySelector('.sidebar-toggle-icon');
    if (icon) icon.textContent = expanded ? 'left_panel_close' : 'left_panel_open';
  };
  const onSystemChange = () => {
    if (theme === 'system') applyTheme();
  };

  themeButton?.addEventListener('click', () => {
    theme = nextTheme(theme);
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
