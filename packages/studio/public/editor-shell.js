import { blocks, normalizeCharts, normalizeForms, templateCss } from './templates.js';
import { normalizeWorkspacePanel, workspaceKeyAction, workspaceState } from './editor-workspace.js';

const svg = (body) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const blockIcons = {
  section: '▤',
  columns: '▥',
  heading: 'T',
  text: '≡',
  image: '▧',
  vsl: '▶',
  button: '↗',
  icon: '★',
  'bar-chart': '▥',
  'donut-chart': '◉',
  form: '☷',
  input: '▱',
  'hero-section': '▣',
  'benefits-section': '✓',
  'testimonials-section': '❝',
  'faq-section': '?',
  'contact-section': '✉',
};

export const VSL_ATTRIBUTE = 'data-alva-vsl';

export function vslBlockState(publicId = '') {
  return { type: 'vsl', publicId: String(publicId ?? '').trim() };
}

export function vslEmbedUrl(publicOrigin, publicId) {
  const originUrl = new URL(String(publicOrigin || globalThis.location?.origin || ''));
  if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash)
    throw new Error('A origem pública da VSL é inválida.');
  const origin = originUrl.origin;
  return `${origin}/embed/v/${encodeURIComponent(String(publicId ?? '').trim())}`;
}

export function publishedVslOptions(videos = []) {
  return videos
    .filter((video) => video?.publicId && typeof video.publishedVersionId === 'string' && video.publishedVersionId.trim())
    .map((video) => ({ publicId: String(video.publicId), name: String(video.name || 'VSL'), status: 'Publicada' }));
}

export function vslEditorOptions(videos = []) {
  return publishedVslOptions(videos).map(({ publicId, name, status }) => ({ publicId, name, status }));
}

export function vslCanvasMessage({ publicId = '', canRead = true, loadError = '' } = {}) {
  if (loadError) return 'Não foi possível carregar as VSLs. Tente novamente.';
  if (!canRead) return 'Você não tem permissão para visualizar VSLs.';
  return publicId ? 'VSL não encontrada. Publique a VSL antes de usar.' : 'Escolha uma VSL publicada.';
}

export function vslOptionKeyboardAction(event, visibleIds = [], selectedId = '', disabledIds = []) {
  const ids = Array.from(visibleIds || []);
  if (!ids.length) return null;
  const index = Math.max(0, ids.indexOf(String(selectedId || '')));
  const disabled = new Set(Array.from(disabledIds || [], (id) => String(id || '')));
  const direction = event?.key === 'ArrowLeft' || event?.key === 'ArrowUp' ? -1 : event?.key === 'ArrowRight' || event?.key === 'ArrowDown' ? 1 : 0;
  if (direction) {
    for (let offset = 1; offset <= ids.length; offset += 1) {
      const candidate = ids[(index + direction * offset + ids.length * 2) % ids.length];
      if (!disabled.has(String(candidate || ''))) return candidate;
    }
    return null;
  }
  if (event?.key === 'Home') return ids[0];
  if (event?.key === 'End') return ids.at(-1);
  return null;
}

export function restoreVslOptionFocus(options = [], selectedId = '') {
  const selected = String(selectedId || '');
  const option = Array.from(options || []).find((candidate) => String(candidate?.dataset?.vslOption || '') === selected && !candidate.disabled);
  if (!option?.focus) return false;
  option.focus();
  return true;
}

export function createReadOnlyMutationGuard(editor, { snapshot = editor?.getProjectData?.(), lock = () => {} } = {}) {
  const initialSnapshot = structuredClone(snapshot || {});
  const initialSignature = JSON.stringify(initialSnapshot);
  let restoring = false;
  let queued = false;
  let disposed = false;
  const watched = new Map();
  const componentPath = (component) => {
    const path = [];
    let current = component;
    while (current?.parent?.()) {
      path.unshift(current.index?.() ?? 0);
      current = current.parent();
    }
    return path;
  };
  const componentAtPath = (component, path) => {
    let current = component;
    for (const index of path) current = current?.components?.().at(index);
    return current;
  };
  const restore = () => {
    if (restoring || !editor?.loadProjectData) return false;
    restoring = true;
    const selectedPath = componentPath(editor.getSelected?.());
    unwatchComponents();
    editor.loadProjectData(structuredClone(initialSnapshot));
    lock(editor.getWrapper?.());
    watchComponent(editor.getWrapper?.());
    const selected = componentAtPath(editor.getWrapper?.(), selectedPath);
    if (selected) editor.select?.(selected, { scroll: false });
    restoring = false;
    return true;
  };
  const scheduleIfPersisted = () => {
    if (restoring || disposed || JSON.stringify(editor.getProjectData?.()) === initialSignature) return;
    scheduleRestore();
  };
  const watchComponent = (component) => {
    if (!component || watched.has(component)) return;
    const onChange = () => scheduleIfPersisted();
    component.on?.('change', onChange);
    watched.set(component, onChange);
    componentChildren(component).forEach(watchComponent);
  };
  const unwatchComponents = () => {
    watched.forEach((onChange, component) => component.off?.('change', onChange));
    watched.clear();
  };
  const scheduleRestore = () => {
    if (queued || restoring || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed && !restoring) restore();
    });
  };
  const mutationEvents = ['update', 'component:add', 'component:remove', 'component:update:attributes', 'component:update:components', 'component:update:content', 'component:styleUpdate'];
  const handlers = new Map(mutationEvents.map((event) => [event, event === 'component:add' ? (component) => { watchComponent(component); scheduleRestore(); } : scheduleRestore]));
  watchComponent(editor.getWrapper?.());
  handlers.forEach((handler, event) => editor.on?.(event, handler));
  return { restore, isRestoring: () => restoring, dispose: () => { disposed = true; unwatchComponents(); handlers.forEach((handler, event) => editor.off?.(event, handler)); } };
}

export function renderVslOptionCards(videos = [], selectedId = '') {
  const options = vslEditorOptions(videos);
  const selected = String(selectedId || '').trim();
  if (selected && !options.some((option) => option.publicId === selected))
    options.push({ publicId: selected, name: 'VSL não encontrada', status: 'Indisponível', invalid: true });
  options.unshift({ publicId: '', name: 'Remover seleção', status: 'Nenhuma VSL' });
  const focusId = options.some((option) => !option.invalid && option.publicId === selected) ? selected : '';
  return `<div class="fe-vsl-options" role="radiogroup" aria-label="VSL publicada">${options.map((option) => `<button type="button" role="radio" class="fe-vsl-option${option.invalid ? ' is-invalid' : ''}" data-vsl-option="${escapeText(option.publicId)}" aria-checked="${option.publicId === selected}" tabindex="${option.publicId === focusId ? '0' : '-1'}"${option.invalid ? ' disabled' : ''}><span class="material-symbols-outlined" aria-hidden="true">${option.publicId ? 'play_circle' : 'remove_circle_outline'}</span><span><strong>${escapeText(option.name)}</strong><small>${escapeText(option.status)}</small></span></button>`).join('')}</div>`;
}

export function editorInteractionPolicy(can = () => false) {
  const canEdit = Boolean(can('page.write'));
  return { canEdit, canAdd: canEdit, canReorder: canEdit, canDelete: canEdit, canInlineEdit: canEdit, canReadVsl: Boolean(can('video.read')) };
}

export function applyEditorInteractionPolicy(root, can = () => false) {
  const policy = editorInteractionPolicy(can);
  const library = root?.querySelector?.('.fe-library');
  if (library) library.hidden = !policy.canAdd;
  if (!policy.canEdit) root?.querySelectorAll?.('input, select, textarea, .fe-element-actions button, .fe-canvas-bar button, .fe-heading-levels button, .fe-motion-select button').forEach((control) => { control.disabled = true; });
  return policy;
}

const VSL_MODEL_KEYS = new Set(['type', 'publicId', 'tagName', 'attributes', 'components', 'style', 'classes', 'droppable']);

function cleanVslModel(model, publicId) {
  for (const key of Object.keys(model.attributes || {})) {
    if (!VSL_MODEL_KEYS.has(key)) model.unset?.(key, { silent: true });
  }
  model.set('type', 'vsl', { silent: true });
  model.set('publicId', publicId, { silent: true });
  model.set('attributes', { [VSL_ATTRIBUTE]: publicId }, { silent: true });
}

export function createVslComponentType({ publishedVslById = new Map(), publicOrigin = '', canReadVsl = () => true, loadError = '' } = {}) {
  return {
    isComponent: (element) => element?.getAttribute?.(VSL_ATTRIBUTE) !== null,
    model: {
      defaults: {
        tagName: 'div',
        type: 'vsl',
        publicId: '',
        droppable: false,
        attributes: { [VSL_ATTRIBUTE]: '' },
      },
      init() {
        const attrs = this.get('attributes') || {};
        const attrId = String(attrs[VSL_ATTRIBUTE] || '').trim();
        const id = String(this.get('publicId') || attrId).trim();
        cleanVslModel(this, id);
        this.listenTo(this, 'change:publicId', () => cleanVslModel(this, String(this.get('publicId') || '').trim()));
      },
    },
    view: {
      onRender() {
        const publicId = String(this.model.get('publicId') || '').trim();
        this.el.classList.add('alva-vsl');
        this.el.replaceChildren();
        const video = publicId ? publishedVslById.get(publicId) : null;
        if (video && canReadVsl()) {
          const iframe = this.el.ownerDocument.createElement('iframe');
          iframe.className = 'alva-vsl-frame';
          iframe.src = vslEmbedUrl(publicOrigin, publicId);
          iframe.title = `Prévia da VSL: ${video.name}`;
          iframe.loading = 'lazy';
          iframe.allow = 'autoplay';
          iframe.setAttribute('aria-label', `Prévia da VSL ${video.name}`);
          this.el.append(iframe);
          return;
        }
        const message = this.el.ownerDocument.createElement('p');
        message.className = 'alva-vsl-empty';
        message.textContent = vslCanvasMessage({ publicId, canRead: canReadVsl(), loadError });
        this.el.append(message);
      },
      removed() {
        this.el?.replaceChildren();
      },
    },
  };
}

function vslIframeMarkup(publicId, publicOrigin) {
  if (!publicId) return '<div class="alva-vsl-empty">Escolha uma VSL publicada.</div>';
  const src = escapeText(vslEmbedUrl(publicOrigin, publicId));
  return `<iframe class="alva-vsl-frame" src="${src}" title="Prévia da VSL" allow="autoplay" loading="lazy" aria-label="Prévia da VSL"></iframe>`;
}

export function renderVslReferences(html, { publicOrigin } = {}) {
  const source = String(html ?? '');
  return source.replace(/<([a-z][\w:-]*)\b([^>]*\bdata-alva-vsl(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?[^>]*)>([\s\S]*?)<\/\1\s*>/gi, (whole, tag, attrs, doubleId, singleId) => {
    const publicId = String(doubleId ?? singleId ?? '').trim();
    return vslIframeMarkup(publicId, publicOrigin);
  });
}

export function buildPageExportHtml({ title = '', css = '', html = '', js = '', publicOrigin } = {}) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeText(title) +
    '</title><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,200..700,0..1,-25..200&display=block" rel="stylesheet"><style>' +
    css +
    '</style></head><body>' +
    renderVslReferences(html, { publicOrigin }) +
    '<script>' +
    js +
    '</script></body></html>';
}

export const editorActionMeta = Object.freeze({
  undo: { label: 'Desfazer', icon: svg('<path d="M9 7 4 12l5 5"/><path d="M20 17a8 8 0 0 0-13-5"/>') },
  redo: { label: 'Refazer', icon: svg('<path d="m15 7 5 5-5 5"/><path d="M4 17a8 8 0 0 1 13-5"/>') },
  moveUp: { label: 'Mover acima', icon: svg('<path d="m12 19V5m-6 6 6-6 6 6"/>') },
  moveDown: { label: 'Mover abaixo', icon: svg('<path d="M12 5v14m6-6-6 6-6-6"/>') },
  selectParent: {
    label: 'Selecionar grupo',
    icon: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  },
  duplicate: {
    label: 'Duplicar',
    icon: svg(
      '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    ),
  },
  delete: { label: 'Excluir', icon: svg('<path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7"/>') },
});

export function panelMode(component) {
  return !component || component.is?.('wrapper') ? 'library' : 'inspector';
}

export function isCanvasBackgroundElement(element) {
  return /^(HTML|BODY|MAIN|SECTION)$/.test(String(element?.tagName || '').toUpperCase());
}

export function editorKeyboardAction(event, selected) {
  if (event?.key === 'Escape') return 'clear';
  if (!['Delete', 'Backspace'].includes(event?.key) || !selected || selected.is?.('wrapper')) return null;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(String(target?.tagName || '').toUpperCase()))
    return null;
  return 'delete';
}
const escapeText = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const tagOf = (model) => String(model?.get('tagName') || '').toLowerCase();
const componentHasClass = (model, className) =>
  (model?.getClasses?.() || []).includes(className) ||
  String(model?.getAttributes?.().class || '').split(/\s+/).includes(className);
export const isMaterialIcon = (model) => componentHasClass(model, 'material-symbols-outlined');
export function setHeadingLevel(model, level) {
  if (!/^h[1-3]$/.test(String(level))) return false;
  model?.set?.('tagName', level);
  return true;
}
export function inspectorNumber(value, fallback = '') {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
}
export function inspectorTextAlign(value, direction = 'ltr') {
  const normalized = String(value || '').toLowerCase();
  const rtl = String(direction || '').toLowerCase() === 'rtl';
  if (normalized === 'start') return rtl ? 'right' : 'left';
  if (normalized === 'end') return rtl ? 'left' : 'right';
  return ['left', 'center', 'right'].includes(normalized) ? normalized : 'left';
}
const motionOptions = [
  ['none', 'Nenhum', 'do_not_disturb_on'],
  ['fade-up', 'Suave', 'animation'],
  ['slide-left', 'Lateral', 'arrow_forward'],
  ['zoom-in', 'Zoom', 'zoom_in'],
  ['float', 'Flutuar', 'air'],
];
export function bindInspectorRepaintOnFocusout(inspector, repaint) {
  const onFocusout = (event) => {
    if (inspector.contains(event.relatedTarget)) return;
    repaint();
  };
  inspector.addEventListener('focusout', onFocusout);
  return () => inspector.removeEventListener('focusout', onFocusout);
}
export function renderMotionPopover({ document: ownerDocument = globalThis.document, value = 'none', canEdit = true, onChange = () => {} } = {}) {
  const current = motionOptions.some(([id]) => id === value) ? value : 'none';
  const root = ownerDocument.createElement('div');
  root.className = 'fe-motion-select';
  const trigger = ownerDocument.createElement('button');
  trigger.type = 'button';
  trigger.className = 'fe-motion-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.disabled = !canEdit;
  const list = ownerDocument.createElement('div');
  list.className = 'fe-motion-popover';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Movimento');
  list.hidden = true;
  const close = ({ focus = false } = {}) => {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  };
  const open = () => {
    if (!canEdit) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    list.querySelector('[aria-selected="true"]')?.focus();
  };
  const paint = (selected) => {
    const [, label, icon] = motionOptions.find(([id]) => id === selected) || motionOptions[0];
    trigger.replaceChildren();
    const text = ownerDocument.createElement('span');
    text.textContent = label;
    const symbol = ownerDocument.createElement('span');
    symbol.className = 'material-symbols-outlined';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = icon;
    const expand = ownerDocument.createElement('span');
    expand.className = 'material-symbols-outlined';
    expand.setAttribute('aria-hidden', 'true');
    expand.textContent = 'expand_more';
    trigger.append(text, symbol, expand);
    list.querySelectorAll('[role="option"]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.motion === selected)));
  };
  motionOptions.forEach(([id, label, icon]) => {
    const option = ownerDocument.createElement('button');
    option.type = 'button'; option.className = 'fe-motion-option'; option.dataset.motion = id;
    option.setAttribute('role', 'option'); option.tabIndex = -1; option.disabled = !canEdit;
    option.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span><span></span>`;
    option.lastElementChild.textContent = label;
    option.onclick = () => { paint(id); onChange(id); close({ focus: true }); };
    option.onkeydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({ focus: true }); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = [...list.querySelectorAll('[role="option"]')];
        const index = options.indexOf(option);
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
      }
    };
    list.append(option);
  });
  // Keep an active inspector field focused on pointer click. Its blur otherwise
  // schedules a repaint which replaces this popover immediately after opening.
  trigger.onpointerdown = (event) => { if (canEdit) event.preventDefault(); };
  trigger.onclick = () => (list.hidden ? open() : close({ focus: true }));
  trigger.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
  root.append(trigger, list);
  paint(current);
  return root;
}
const componentDescendants = (model) => {
  const children = model?.components?.().models || [];
  return children.flatMap((child) => [child, ...componentDescendants(child)]);
};
export const chartAncestor = (model) => {
  let current = model;
  while (current) {
    if (componentHasClass(current, 'alva-chart-bars') || componentHasClass(current, 'alva-donut')) return current;
    current = current.parent?.();
  }
};
const componentWithClass = (model, className) => {
  const ancestor = chartAncestor(model);
  return componentHasClass(ancestor, className) ? ancestor : componentDescendants(model).find((child) => componentHasClass(child, className));
};
export const chartBlockContainer = (model) => {
  const bars = componentWithClass(model, 'alva-chart-bars');
  if (bars) return bars;
  const donut = componentWithClass(model, 'alva-donut');
  return componentHasClass(donut?.parent?.(), 'alva-chart') ? donut.parent() : donut;
};
export const chartInsertionTarget = (selected, wrapper) => {
  const chart = chartAncestor(selected);
  if (!chart) return null;
  const container = componentHasClass(chart, 'alva-donut') && componentHasClass(chart.parent?.(), 'alva-chart') ? chart.parent() : chart;
  return { target: container.parent() || wrapper, at: container.index() + 1 };
};
const componentsByTag = (model, tagName) =>
  componentDescendants(model).filter((child) => tagOf(child) === tagName);
export const chartRows = (value, max = Infinity) => {
  const rows = String(value || '')
    .split('\n')
    .map((row) => row.match(/^\s*(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*$/))
    .filter(Boolean)
    .slice(0, 8)
    .map((row) => [row[1].trim(), Number(row[2])]);
  return validateChartRows(rows, max);
};
export const validateChartRows = (rows, max = Infinity) => {
  const normalized = Array.from(rows || []).slice(0, 8).map(([name, value]) => [String(name ?? '').trim(), Number(value)]);
  if (normalized.length < 2) throw new Error('Mantenha ao menos duas opções no gráfico.');
  if (normalized.some(([name, number]) => !name || !Number.isFinite(number) || number < 0 || number > max))
    throw new Error(max === Infinity ? 'Use valores finitos maiores ou iguais a zero.' : `Use valores finitos entre 0 e ${max}.`);
  return normalized;
};
export const updateChartRow = (rows, index, patch, max = Infinity) =>
  validateChartRows(rows.map((row, rowIndex) => rowIndex === index ? [patch.name ?? row[0], patch.value ?? row[1]] : row), max);
export const removeChartRow = (rows, index, max = Infinity) => {
  const current = validateChartRows(rows, max);
  if (current.length < 3) throw new Error('Mantenha ao menos duas opções no gráfico.');
  return validateChartRows(current.filter((_, rowIndex) => rowIndex !== index), max);
};
export const donutSegments = (rows) => {
  const colors = ['#286eea', '#80d6c2', '#ffc76b', '#8f7ee8', '#ed8bb3', '#66b9e8', '#9ac85c', '#dca768'];
  const values = rows.map(([, value]) => Number(value));
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Use valores finitos maiores ou iguais a zero.');
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Informe ao menos um valor maior que zero.');
  let start = 0;
  return values.map((value, index) => {
    const end = start + (value / total) * 100;
    const segment = `${colors[index]} ${start}% ${end}%`;
    start = end;
    return segment;
  }).join(',');
};

export function safeDestination(value, image = false) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/[\u0000-\u0020]/.test(text)) throw new Error('Use um endereço sem espaços.');
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(text)) return text;
  if (/^(https?:\/\/|\/[^/]|#|\.\.?\/)/i.test(text) || (!image && /^(mailto:|tel:)/i.test(text))) return text;
  throw new Error(
    image ? 'Use uma imagem com endereço http ou https.' : 'Use um endereço http, https, #seção, mailto: ou tel:.',
  );
}

export function componentLabel(component) {
  const tag = tagOf(component);
  if (component?.is?.('wrapper')) return 'Página';
  if (component?.is?.('vsl') || component?.get?.('type') === 'vsl') return 'VSL';
  if (/^h[1-6]$/.test(tag)) return 'Título';
  return (
    {
      img: 'Imagem',
      a: 'Botão / link',
      button: 'Botão',
      input: 'Campo',
      textarea: 'Campo de mensagem',
      select: 'Lista de opções',
      label: 'Rótulo do campo',
      form: 'Formulário',
      section: 'Seção',
      main: 'Conteúdo da página',
      nav: 'Menu',
      footer: 'Rodapé',
      p: 'Texto',
      span: 'Texto',
      small: 'Texto',
      article: 'Cartão',
    }[tag] || 'Grupo de elementos'
  );
}

function componentChildren(component) {
  const children = component?.components?.();
  if (Array.isArray(children)) return children;
  return children?.models || [];
}

function componentTreeId(component) {
  return String(component?.cid || component?.getId?.() || component?.get?.('id') || '');
}

export function componentTreeNodes(wrapper, selected) {
  const nodes = [];
  const visit = (component, level) => {
    const id = componentTreeId(component);
    if (!id) return;
    nodes.push({ id, label: componentLabel(component), level, selected: component === selected });
    componentChildren(component).forEach((child) => visit(child, level + 1));
  };
  componentChildren(wrapper).forEach((component) => visit(component, 1));
  return nodes;
}

export function treeKeyAction(event, visibleIds, selectedId) {
  const ids = Array.from(visibleIds || []);
  if (!ids.length) return null;
  const index = ids.indexOf(selectedId);
  const selectedIndex = index < 0 ? 0 : index;

  if (event?.key === 'ArrowUp') return ids[Math.max(0, selectedIndex - 1)];
  if (event?.key === 'ArrowDown') return ids[Math.min(ids.length - 1, selectedIndex + 1)];
  if (event?.key === 'Home') return ids[0];
  if (event?.key === 'End') return ids.at(-1);
  return null;
}

export function restoreTreeFocus(items, id, activeItem) {
  if (!activeItem) return false;
  const item = Array.from(items || []).find((candidate) => candidate.dataset?.treeId === id);
  if (!item) return false;
  item.focus();
  return true;
}

export function bindTreeItemActivation(item, onActivate, activeElement = () => document.activeElement) {
  item.onclick = (event) => onActivate(event?.type === 'click' && activeElement() === item ? item : null);
}

export function scrollTreeComponent(editor, component) {
  editor?.Canvas?.scrollTo?.(component, { behavior: 'smooth', block: 'nearest' });
}

export function restoreTreeSelection(editor, id, components) {
  const component = components?.get?.(id);
  if (!component) return false;
  editor.select(component, { scroll: false });
  return true;
}

export function isHexColor(value) {
  return /^#[a-f\d]{6}$/i.test(String(value || '').trim());
}

export function colorToHex(value) {
  const text = String(value || '').trim();
  const hex = text.match(/^#([a-f\d]{3}|[a-f\d]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
    return `#${expanded.toLowerCase()}`;
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function treeDragSourceId(localId, dataTransfer) {
  return localId || dataTransfer?.getData?.('text/plain') || '';
}

export function treeDropPosition(event, rect) {
  return Number(event?.clientY) < Number(rect?.top || 0) + Number(rect?.height || 0) / 2 ? 'before' : 'after';
}

export function bindTreeDragInteraction(item, { id, component, canReorder, getSource, canMove, reorder, dragState } = {}) {
  item.draggable = Boolean(canReorder);
  const clearDropIndicator = () => {
    item.classList.remove('fe-tree-drop-before', 'fe-tree-drop-after');
    item.style.removeProperty('border-top');
    item.style.removeProperty('border-bottom');
  };
  item.ondragstart = (event) => {
    if (!canReorder) return;
    dragState.sourceId = id;
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    item.classList.add('fe-tree-dragging');
  };
  item.ondragover = (event) => {
    const source = getSource(treeDragSourceId(dragState.sourceId, event.dataTransfer));
    if (!source || source === component || source.parent?.() !== component.parent?.()) return;
    const position = treeDropPosition(event, item.getBoundingClientRect());
    if (!canMove(source, component, position)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearDropIndicator();
    item.classList.add(`fe-tree-drop-${position}`);
    item.style.setProperty(position === 'before' ? 'border-top' : 'border-bottom', '2px solid var(--alva-blue, #286eea)');
  };
  item.ondragleave = (event) => {
    if (!item.contains(event.relatedTarget)) clearDropIndicator();
  };
  item.ondrop = (event) => {
    event.preventDefault();
    const source = getSource(treeDragSourceId(dragState.sourceId, event.dataTransfer));
    const position = treeDropPosition(event, item.getBoundingClientRect());
    clearDropIndicator();
    dragState.sourceId = null;
    if (source && canMove(source, component, position)) reorder(source, component, position);
  };
  item.ondragend = () => {
    item.classList.remove('fe-tree-dragging');
    clearDropIndicator();
    dragState.sourceId = null;
  };
}

export function reorderTreeComponent({ source, target, position = 'after', canReorder = false, components } = {}) {
  if (!canReorder || !source || !target || source === target) return false;
  const parent = source.parent?.();
  if (!parent || parent !== target.parent?.()) return false;
  const at = target.index() + (position === 'after' ? 1 : 0);
  if (!components?.canMove?.(parent, source, at)?.result) return false;
  source.move(parent, { at });
  return true;
}

function editorTreeIcon(component) {
  const tag = tagOf(component);
  if (isMaterialIcon(component)) return 'star';
  if (tag === 'strong' && tagOf(component.parent?.()) === 'nav') return 'branding_watermark';
  if (component?.is?.('vsl') || component?.get?.('type') === 'vsl') return 'play_circle';
  if (/^h[1-6]$/.test(tag)) return 'title';
  return ({
    main: 'web', section: 'web', nav: 'menu', footer: 'contact_mail', div: 'dashboard', article: 'view_agenda',
    p: 'format_align_left', span: 'format_align_left', small: 'format_align_left', a: 'arrow_forward', button: 'smart_button',
    img: 'image', form: 'contact_page', input: 'short_text', textarea: 'subject', select: 'list_alt', label: 'label',
  })[tag] || 'widgets';
}

function componentAttributes(component) {
  return component?.getAttributes?.() || component?.get?.('attributes') || {};
}

function componentHas(component, target) {
  if (!component || !target) return false;
  if (component === target) return true;
  return componentChildren(component).some((child) => componentHas(child, target));
}

function editorialSectionLabel(component, index) {
  const tag = tagOf(component);
  const attrs = componentAttributes(component);
  const token = `${attrs.id || ''} ${attrs.class || ''}`.toLowerCase();
  if (tag === 'nav') return 'Topo';
  if (tag === 'footer' || /contact|contato/.test(token)) return 'Contato';
  if (/hero|offer-top|event-hero|thanks/.test(token)) return 'Abertura';
  if (/benefit/.test(token)) return 'Benefícios';
  if (/testimonial/.test(token)) return 'Depoimentos';
  if (/faq/.test(token)) return 'Perguntas frequentes';
  return index ? `Seção ${index + 1}` : 'Abertura';
}

export function editorialElementLabel(component, { inNav = false } = {}) {
  const tag = tagOf(component);
  if (isMaterialIcon(component)) return 'Ícone';
  const chart = chartBlockContainer(component);
  if (chart === component) {
    const donut = componentHasClass(component, 'alva-donut') || componentDescendants(component).some((child) => componentHasClass(child, 'alva-donut'));
    if (componentHasClass(component, 'alva-chart-bars')) return 'Gráfico de barras';
    if (donut) return 'Gráfico circular';
  }
  if (component?.is?.('vsl') || component?.get?.('type') === 'vsl') return 'VSL';
  if (/^h1$/.test(tag)) return 'Título principal';
  if (/^h[2-6]$/.test(tag)) return 'Título';
  if (tag === 'strong' && (inNav || tagOf(component.parent?.()) === 'nav')) return 'Logo';
  if (tag === 'a' && (inNav || tagOf(component.parent?.()) === 'nav')) return 'Menu';
  return ({ p: 'Texto', a: 'Botão', button: 'Botão', img: 'Imagem', form: 'Formulário', input: 'Campo', textarea: 'Mensagem', select: 'Lista de opções', label: 'Campo', })[tag] || '';
}

export function editorialLabel(component) {
  const chart = chartAncestor(component);
  if (componentHasClass(chart, 'alva-chart-bars')) return 'Gráfico de barras';
  if (componentHasClass(chart, 'alva-donut')) return 'Gráfico circular';
  const firstMeaningfulChild = (model) => {
    for (const child of componentChildren(model)) {
      const label = editorialElementLabel(child);
      if (label) return label;
      const nested = firstMeaningfulChild(child);
      if (nested) return nested;
    }
    return '';
  };
  let current = component;
  while (current && !current.is?.('wrapper')) {
    const own = editorialElementLabel(current);
    if (own) return own;
    const nested = firstMeaningfulChild(current);
    if (nested) return nested;
    current = current.parent?.();
  }
  // Bare layout tags do not convey an editorial role. They must never leak
  // their implementation name into the canvas label or property inspector.
  if (['div', 'span', 'section', 'main'].includes(tagOf(component))) return 'Elemento';
  const fallback = componentLabel(component);
  const editorialFallbacks = new Set([
    'Página', 'VSL', 'Imagem', 'Botão / link', 'Botão', 'Campo',
    'Campo de mensagem', 'Lista de opções', 'Rótulo do campo', 'Formulário',
    'Texto', 'Cartão', 'Menu', 'Rodapé',
  ]);
  return editorialFallbacks.has(fallback) ? fallback : 'Elemento';
}

export function editorialTreeEntries(wrapper, selected) {
  const sections = [];
  const addSection = (component) => {
    if (sections.some((section) => section.component === component)) return;
    sections.push({ component, label: editorialSectionLabel(component, sections.length), elements: [] });
  };
  const scanSections = (component) => {
    for (const child of componentChildren(component)) {
      const tag = tagOf(child);
      if (['section', 'nav', 'footer'].includes(tag)) {
        addSection(child);
        if (tag === 'section') scanSections(child);
      } else scanSections(child);
    }
  };
  scanSections(wrapper);
  if (!sections.length) sections.push({ component: wrapper, label: 'Abertura', elements: [] });
  sections.sort((left, right) => (tagOf(left.component) === 'nav' ? -1 : 0) - (tagOf(right.component) === 'nav' ? -1 : 0));
  const addElements = (section) => {
    const visit = (component, inNav = false) => {
      for (const child of componentChildren(component)) {
        const tag = tagOf(child);
        if (['section', 'footer'].includes(tag) || (tag === 'nav' && child !== section.component)) continue;
        const label = editorialElementLabel(child, { inNav: inNav || tagOf(section.component) === 'nav' });
        if (label) {
          section.elements.push({ component: child, label });
          continue;
        }
        visit(child, inNav || tag === 'nav');
      }
    };
    visit(section.source || section.component);
  };
  const realSections = sections.filter((section) => section.component !== wrapper);
  if (realSections.length) {
    realSections.forEach(addElements);
    const loose = { component: null, source: wrapper, label: 'Elementos soltos', elements: [], synthetic: true };
    addElements(loose);
    if (loose.elements.length) sections.push(loose);
  } else {
    sections.forEach(addElements);
  }
  return sections.map((section) => ({
    ...section,
    selected: !section.synthetic && componentHas(section.component, selected),
    // The editor tree is a map, not a DOM inspector. A concise list keeps each
    // section actionable while the canvas still gives access to every child.
    elements: section.elements.map((element) => ({ ...element, selected: componentHas(element.component, selected) })),
  }));
}

export function createFriendlyEditor({
  container,
  project,
  html = '',
  css = '',
  onChange = () => {},
  onOpenFormSettings = () => {},
  vslVideos = [],
  vslLoadError = '',
  mediaEnabled = () => true,
  publicOrigin = globalThis.location?.origin || '',
  can = () => true,
}) {
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (!host) throw new Error('Não foi possível abrir a área de edição.');
  let activeWorkspacePanel = 'canvas';
  const workspaceId = `landing-workspace-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspace = workspaceState(activeWorkspacePanel);
  host.classList.add('friendly-editor');
  host.innerHTML = `
    <div class="editor-workspace-tabs" role="tablist" aria-label="Regiões do editor">${workspace.panels.map((panel) => `<button type="button" role="tab" data-workspace-tab="${panel.id}" id="${workspaceId}-tab-${panel.id}" aria-controls="${workspaceId}-panel-${panel.id}" aria-selected="${panel.selected}" tabindex="${panel.selected ? '0' : '-1'}">${panel.label}</button>`).join('')}</div>
    <aside class="fe-sidebar" data-editor-panel="structure" id="${workspaceId}-panel-structure" role="tabpanel" aria-labelledby="${workspaceId}-tab-structure">
      <div class="fe-panel-heading">
        <span class="fe-eyebrow">PÁGINA</span>
        <h2>Estrutura</h2>
        <p>Organize seções e elementos em uma única árvore.</p>
      </div>
      <div class="fe-tree" role="tree" aria-label="Estrutura da página"></div>
      <details class="fe-library">
        <summary>Adicionar elementos</summary>
        <div class="fe-blocks"></div>
        <div class="fe-library-tip"><strong>Comece pelo essencial</strong><p>Um título claro, uma imagem e um convite para conversar.</p></div>
      </details>
    </aside>
    <div class="fe-workspace" data-editor-panel="canvas" id="${workspaceId}-panel-canvas" role="tabpanel" aria-labelledby="${workspaceId}-tab-canvas">
      <div class="fe-canvas-shell">
        <div class="fe-canvas-bar" aria-label="Controles do canvas"><span class="fe-canvas-meta">CANVAS · <span data-canvas-device>COMPUTADOR</span></span><span class="fe-canvas-history"><button type="button" class="fe-icon-button" data-undo></button><button type="button" class="fe-icon-button" data-redo></button></span><span class="fe-canvas-zoom">100%</span></div>
        <div class="fe-canvas-frame"><div class="fe-canvas"></div></div>
      </div>
      <div class="fe-status" role="status" aria-live="polite">Dica: dê dois cliques em um texto para escrever diretamente na página.</div>
    </div>
    <aside class="fe-inspector" data-editor-panel="inspector" id="${workspaceId}-panel-inspector" role="tabpanel" aria-labelledby="${workspaceId}-tab-inspector" aria-label="Editar elemento"><div class="fe-properties"></div></aside>`;
  const $ = (selector) => host.querySelector(selector);
  const props = $('.fe-properties');
  const status = $('.fe-status');
  const tree = $('.fe-tree');
  const cleanup = [];
  const pageHeader = document.querySelector('#editing .editor-header');
  if (pageHeader) {
    pageHeader.classList.add('landing-editor-header');
    if (!pageHeader.querySelector('.fe-editor-context')) {
      const context = document.createElement('span');
      context.className = 'fe-editor-context';
      context.textContent = 'Landing ·';
      pageHeader.querySelector('#page-name')?.before(context);
    }
    if (!pageHeader.querySelector('.fe-saved-mark')) {
      const mark = document.createElement('span');
      mark.className = 'fe-saved-mark material-symbols-outlined';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = 'check_circle';
      pageHeader.querySelector('#save-state')?.before(mark);
    }
    const saveState = pageHeader.querySelector('#save-state');
    const normalizeSaveState = () => {
      if (saveState?.textContent?.trim() === 'Salvo neste computador') saveState.textContent = 'Salvo';
    };
    normalizeSaveState();
    if (saveState && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(normalizeSaveState);
      observer.observe(saveState, { childList: true, characterData: true, subtree: true });
      cleanup.push(() => observer.disconnect());
    }
    const actions = pageHeader.querySelector('.editor-actions');
    if (actions && !pageHeader.querySelector('.fe-header-more')) {
      const more = document.createElement('details');
      more.className = 'fe-header-more';
      more.innerHTML = '<summary aria-label="Mais ações" title="Mais ações"><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></summary><div class="fe-header-more-menu" role="group" aria-label="Mais ações"></div>';
      const menu = more.querySelector('.fe-header-more-menu');
      // Move the original controls so their established IDs and handlers remain
      // the source of truth; the menu merely gives them a compact home.
      ['.device-control', '#settings', '#download'].forEach((selector) => {
        const control = actions.querySelector(selector);
        if (control) menu.append(control);
      });
      [['preview', 'Prévia'], ['publish', 'Publicar']].forEach(([id, label]) => {
        const shortcut = document.createElement('button');
        shortcut.type = 'button';
        shortcut.className = 'fe-header-menu-action';
        shortcut.setAttribute('aria-label', label);
        shortcut.textContent = label;
        shortcut.onclick = () => pageHeader.querySelector(`#${id}`)?.click();
        menu.append(shortcut);
      });
      actions.before(more);
    }
  }
  let loading = true;
  let repaint;
  let activeModel;
  let treeComponents = new Map();
  let treeDragSource = null;
  let readOnlyMutationGuard = null;
  let pendingVslOptionFocusId = null;
  const publishedVslById = new Map(publishedVslOptions(vslVideos).map((video) => [video.publicId, video]));
  const interactionPolicy = applyEditorInteractionPolicy(host, can);
  const canInsertVsl = () => interactionPolicy.canAdd && mediaEnabled();
  const canReadVsl = () => mediaEnabled() && Boolean(can('video.read'));
  const isCompactWorkspace = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;
  function syncWorkspacePanels({ focusTab = false } = {}) {
    const state = workspaceState(activeWorkspacePanel);
    const compact = isCompactWorkspace();
    state.panels.forEach((statePanel) => {
      const tab = $(`[data-workspace-tab="${statePanel.id}"]`);
      const panel = $(`[data-editor-panel="${statePanel.id}"]`);
      tab.setAttribute('aria-selected', String(statePanel.selected));
      tab.tabIndex = statePanel.selected ? 0 : -1;
      panel.hidden = compact && statePanel.id === 'structure';
      panel.inert = compact && statePanel.id === 'structure';
      if (focusTab && statePanel.selected) tab.focus();
    });
  }
  function activateWorkspacePanel(panel, { focusTab = false } = {}) {
    activeWorkspacePanel = normalizeWorkspacePanel(panel);
    syncWorkspacePanels({ focusTab });
  }
  function bindWorkspaceTabs() {
    host.querySelectorAll('[data-workspace-tab]').forEach((tab) => {
      tab.onclick = () => activateWorkspacePanel(tab.dataset.workspaceTab, { focusTab: true });
      tab.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activateWorkspacePanel(tab.dataset.workspaceTab, { focusTab: true });
          return;
        }
        const next = workspaceKeyAction(event, activeWorkspacePanel);
        if (!next) return;
        event.preventDefault();
        activateWorkspacePanel(next, { focusTab: true });
      };
    });
  }
  bindWorkspaceTabs();
  syncWorkspacePanels();
  const syncCanvasDevice = () => {
    const device = document.querySelector('#device');
    const label = device?.selectedOptions?.[0]?.textContent || 'Computador';
    host.querySelectorAll('[data-canvas-device]').forEach((node) => { node.textContent = label.toUpperCase(); });
  };
  const deviceControl = document.querySelector('#device');
  syncCanvasDevice();
  if (deviceControl) {
    deviceControl.addEventListener('change', syncCanvasDevice);
    cleanup.push(() => deviceControl.removeEventListener('change', syncCanvasDevice));
  }
  if (!interactionPolicy.canEdit) status.textContent = 'Modo de visualização: edição, ordem e exclusão estão desativadas.';
  if (typeof window !== 'undefined') {
    const syncOnResize = () => syncWorkspacePanels();
    window.addEventListener('resize', syncOnResize);
    cleanup.push(() => window.removeEventListener('resize', syncOnResize));
  }
  function applyIconButton(element, action, shortcut = '') {
    const meta = editorActionMeta[action];
    const label = shortcut ? `${meta.label} (${shortcut})` : meta.label;
    element.innerHTML = meta.icon;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.dataset.tooltip = meta.label;
  }
  applyIconButton($('.fe-canvas-bar [data-undo]'), 'undo', 'Ctrl/Cmd + Z');
  applyIconButton($('.fe-canvas-bar [data-redo]'), 'redo');
  const editor = window.grapesjs.init({
    container: $('.fe-canvas'),
    height: '100%',
    width: 'auto',
    storageManager: false,
    noticeOnUnload: false,
    fromElement: false,
    panels: { defaults: [] },
    selectorManager: { componentFirst: true },
    assetManager: { upload: false, embedAsBase64: true },
    parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false } },
    i18n: { locale: 'pt', localeFallback: 'en', messages: { pt: window.alvaLocale || {} } },
    deviceManager: {
      devices: [
        { id: 'Desktop', name: 'Computador', width: '' },
        { id: 'Tablet', name: 'Tablet', width: '768px', widthMedia: '992px' },
        { id: 'Mobile', name: 'Celular', width: '375px', widthMedia: '760px' },
      ],
    },
    blockManager: {
      appendTo: $('.fe-blocks'),
      appendOnClick: (block) => { if (interactionPolicy.canAdd) insertBlock(block); },
      blocks: blocks.filter(([id]) => interactionPolicy.canAdd && (id !== 'vsl' || canInsertVsl())).map(([id, label, category, content]) => ({
        id,
        label,
        category,
        content,
        media: `<span class="fe-block-icon" aria-hidden="true">${blockIcons[id] || '+'}</span>`,
        attributes: {
          title: `Adicionar ${label.toLocaleLowerCase('pt-BR')}`,
          tabindex: '0',
          role: 'button',
          'aria-label': `Adicionar ${label.toLocaleLowerCase('pt-BR')}`,
          'data-block-id': id,
        },
      })),
    },
  });
  // Canvas policy is deliberately separate from project HTML: it prevents saved
  // component scripts and form submissions from executing while editing.
  editor.on('canvas:frame:load', ({ el }) => {
    const doc = el.contentDocument;
    if (!doc) return;
    const policy = doc.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src 'none'; form-action 'none'; base-uri 'none'";
    doc.head.prepend(policy);
    const icons = doc.createElement('link');
    icons.rel = 'stylesheet';
    icons.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,200..700,0..1,-25..200&display=block';
    doc.head.append(icons);
    const editorSelection = doc.createElement('style');
    editorSelection.textContent = `
      .alva-editor-selected { outline: 2px solid #286eea !important; outline-offset: 7px !important; }
      .alva-editor-selected[data-alva-editor-label]::before { content: attr(data-alva-editor-label); position: absolute; z-index: 2147483647; right: -7px; top: -28px; padding: 5px 8px; border-radius: 6px 6px 0 0; background: #286eea; color: #fff; font: 700 9px/1 Inter, system-ui, sans-serif; letter-spacing: 0; white-space: nowrap; }
    `;
    doc.head.append(editorSelection);
    const handleCanvasKey = (event) => { if (interactionPolicy.canEdit) handleEditorKey(event, true); };
    const preventInlineEditing = (event) => {
      if (!interactionPolicy.canInlineEdit) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const clearSelection = (event) => {
      if (isCanvasBackgroundElement(event.target)) {
        activateWorkspacePanel('canvas', { focusTab: isCompactWorkspace() });
        editor.select(editor.getWrapper());
        render();
      }
    };
    doc.addEventListener('keydown', handleCanvasKey, true);
    doc.addEventListener('dblclick', preventInlineEditing, true);
    doc.addEventListener('click', clearSelection);
    cleanup.push(() => {
      doc.removeEventListener('keydown', handleCanvasKey, true);
      doc.removeEventListener('dblclick', preventInlineEditing, true);
      doc.removeEventListener('click', clearSelection);
    });
  });
  editor.DomComponents.addType('vsl', createVslComponentType({ publishedVslById, publicOrigin, canReadVsl, loadError: vslLoadError }));
  editor.DomComponents.addType('alva-field', {
    isComponent: (element) => element.tagName === 'INPUT',
    model: { defaults: { tagName: 'input', void: true, droppable: false, traits: [] } },
  });
  editor.on('rte:enable', (_view, rte) => {
    if (!interactionPolicy.canInlineEdit) rte?.disable?.();
  });
  if (project) editor.loadProjectData(project);
  else {
    editor.setComponents(html);
    editor.setStyle(css);
  }
  const beforeMigration = project ? JSON.stringify(editor.getProjectData()) : null;
  normalizeForms(editor);
  const lockComponent = (component) => {
    component?.set?.({ draggable: false, editable: false, droppable: false }, { silent: true });
    componentChildren(component).forEach(lockComponent);
  };
  if (!interactionPolicy.canEdit) {
    lockComponent(editor.getWrapper());
    readOnlyMutationGuard = createReadOnlyMutationGuard(editor, { snapshot: editor.getProjectData(), lock: lockComponent });
    cleanup.push(() => readOnlyMutationGuard?.dispose());
  }
  editor.__alvaMigrated = interactionPolicy.canEdit && !!project && beforeMigration !== JSON.stringify(editor.getProjectData());
  loading = false;
  if (editor.__alvaMigrated) onChange();

  function announce(message) {
    status.textContent = message;
  }
  function syncCanvasSelection(model) {
    const frame = editor.Canvas?.getFrameEl?.();
    const doc = frame?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll('.alva-editor-selected').forEach((element) => {
      element.classList.remove('alva-editor-selected');
      element.removeAttribute('data-alva-editor-label');
    });
    if (!model || model.is?.('wrapper')) return;
    const element = model.getEl?.();
    if (!element) return;
    element.classList.add('alva-editor-selected');
    element.dataset.alvaEditorLabel = editorialLabel(model);
  }
  function focusTreeItem(id, activeItem) {
    return restoreTreeFocus(tree.querySelectorAll('[data-tree-id]'), id, activeItem);
  }
  function selectTreeItem(id, activeItem = null) {
    const component = treeComponents.get(id);
    if (!component) return;
    const compact = isCompactWorkspace();
    activateWorkspacePanel('inspector', { focusTab: compact });
    editor.select(component, { scroll: false });
    scrollTreeComponent(editor, component);
    activeModel = null;
    render();
    if (!compact) focusTreeItem(id, activeItem);
  }
  function openLibraryFor(component) {
    if (!interactionPolicy.canAdd) return;
    if (component) editor.select(component, { scroll: false });
    const library = $('.fe-library');
    library.open = true;
    library.scrollIntoView({ block: 'nearest' });
  }
  function renderTree() {
    const wrapper = editor.getWrapper();
    treeComponents = new Map();
    const collect = (component) => {
      const id = componentTreeId(component);
      if (id) treeComponents.set(id, component);
      const element = component.getEl?.();
      if (element && (component.is?.('vsl') || component.get?.('type') === 'vsl')) element.hidden = !mediaEnabled();
      componentChildren(component).forEach(collect);
    };
    componentChildren(wrapper).forEach(collect);
    const sections = editorialTreeEntries(wrapper, editor.getSelected()).map((section) => ({
      ...section,
      elements: section.elements.filter(({ component }) => mediaEnabled() || !(component?.is?.('vsl') || component?.get?.('type') === 'vsl')),
    }));
    tree.replaceChildren();
    if (!sections.length) {
      const empty = document.createElement('p');
      empty.className = 'fe-tree-empty';
      empty.textContent = 'Adicione um elemento para começar a montar sua página.';
      tree.append(empty);
      return;
    }
    const visibleIds = sections.flatMap((section) => [
      ...(section.synthetic ? [] : [componentTreeId(section.component)]),
      ...section.elements.map(({ component }) => componentTreeId(component)),
    ]);
    const appendItem = ({ component, label, level, selected, section = false, count = 0 }) => {
      const id = componentTreeId(component);
      if (!id) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `fe-tree-item${section ? ' fe-tree-section' : ''}`;
      item.dataset.treeId = id;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(level));
      item.setAttribute('aria-selected', String(selected));
      item.style.setProperty('--fe-tree-level', String(level));
      item.innerHTML = `<span class="fe-tree-drag material-symbols-outlined" aria-hidden="true">drag_indicator</span><span class="fe-tree-icon material-symbols-outlined" aria-hidden="true">${editorTreeIcon(component)}</span><span class="fe-tree-label"></span>${section ? `<small>${count}</small>` : ''}`;
      item.querySelector('.fe-tree-label').textContent = label;
      bindTreeItemActivation(item, (activeItem) => selectTreeItem(id, activeItem));
      bindTreeDragInteraction(item, {
        id,
        component,
        canReorder: interactionPolicy.canReorder,
        getSource: (sourceId) => treeComponents.get(sourceId),
        canMove: (source, target, position) => {
          const parent = source.parent?.();
          const at = target.index() + (position === 'after' ? 1 : 0);
          return Boolean(parent && editor.Components.canMove(parent, source, at)?.result);
        },
        reorder: (source, target, position) => {
          if (reorderTreeComponent({ source, target, position, canReorder: interactionPolicy.canReorder, components: editor.Components })) {
            editor.select(source, { scroll: false });
            announce('Elemento reordenado.');
          }
        },
        dragState: { get sourceId() { return treeDragSource; }, set sourceId(value) { treeDragSource = value; } },
      });
      item.onkeydown = (event) => {
        const next = treeKeyAction(event, visibleIds, id);
        if (!next) return;
        event.preventDefault();
        selectTreeItem(next, item);
      };
      tree.append(item);
    };
    const appendSyntheticGroup = ({ label, count }) => {
      const item = document.createElement('div');
      item.className = 'fe-tree-item fe-tree-section fe-tree-synthetic';
      item.setAttribute('role', 'presentation');
      item.innerHTML = `<span aria-hidden="true"></span><span class="fe-tree-icon material-symbols-outlined" aria-hidden="true">folder</span><span class="fe-tree-label"></span><small>${count}</small>`;
      item.querySelector('.fe-tree-label').textContent = label;
      tree.append(item);
    };
    for (const section of sections) {
      if (section.synthetic) appendSyntheticGroup({ label: section.label, count: section.elements.length });
      else appendItem({ component: section.component, label: section.label, level: 1, selected: section.selected, section: true, count: section.elements.length });
      section.elements.forEach((element) => appendItem({ ...element, level: 2 }));
      if (!section.synthetic) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'fe-tree-add';
        add.textContent = '+ Elemento';
        add.disabled = !interactionPolicy.canAdd;
        add.onclick = () => openLibraryFor(section.component);
        tree.append(add);
      }
    }
    const addSection = document.createElement('button');
    addSection.type = 'button';
    addSection.className = 'fe-tree-add fe-tree-add-section';
    addSection.textContent = '+ Nova seção';
    addSection.disabled = !interactionPolicy.canAdd;
    addSection.onclick = () => openLibraryFor(wrapper);
    tree.append(addSection);
  }
  function formStyles() {
    normalizeForms(editor);
  }
  function blockStyles() {
    const existingCss = editor.getCss();
    if (/--alva-block-base\s*:\s*1/.test(existingCss) || existingCss.includes('.hero-grid')) return;
    // Fill the blank page with block defaults, preserving every user declaration.
    const custom = editor.Css.getAll().map((rule) => ({ rule, style: { ...rule.getStyle() } }));
    editor.addStyle(templateCss + ':root{--alva-block-base:1}');
    custom.forEach(({ rule, style }) => rule.addStyle(style));
  }
  function insertBlock(block) {
    if (!interactionPolicy.canAdd || !block) return;
    const selected = editor.getSelected();
    const wrapper = editor.getWrapper();
    const id = block.getId();
    if (id === 'vsl' && !canInsertVsl()) {
      announce('Você não tem permissão para inserir uma VSL.');
      return;
    }
    const structure = ['section', 'columns'].includes(id) || id.endsWith('-section') || id.startsWith('section-');
    blockStyles();
    if (id === 'bar-chart' || id === 'donut-chart') normalizeCharts(editor);
    let target = selected || wrapper;
    let at;
    const selectedChartTarget = chartInsertionTarget(selected, wrapper);
    // Whole sections belong next to the section being edited, never inside a paragraph.
    if (structure) {
      while (target.parent() && !['main', 'section'].includes(tagOf(target))) target = target.parent();
      if (tagOf(target) === 'section') {
        at = target.index() + 1;
        target = target.parent();
      }
    } else if (selectedChartTarget) {
      ({ target, at } = selectedChartTarget);
    } else {
      while (
        target !== wrapper &&
        (!['div', 'section', 'main', 'article', 'form', 'footer', 'nav'].includes(tagOf(target)) ||
          target.get('droppable') === false)
      ) {
        at = target.index() + 1;
        target = target.parent() || wrapper;
      }
      if (id === 'form') {
        let parentForm = target;
        while (parentForm && tagOf(parentForm) !== 'form') parentForm = parentForm.parent();
        if (parentForm) {
          at = parentForm.index() + 1;
          target = parentForm.parent();
        }
      }
    }
    const added = target.append(block.get('content'), at === undefined ? {} : { at });
    if (id === 'bar-chart' || id === 'donut-chart') normalizeCharts(editor);
    formStyles();
    if (added[0]) editor.select(added[0], { scroll: true });
    announce(`${block.get('label')} adicionado. Ajuste o conteúdo no painel lateral.`);
  }
  $('.fe-blocks').addEventListener('keydown', (event) => {
    if (!interactionPolicy.canAdd) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = event.target.closest('[data-block-id]');
    if (!element) return;
    event.preventDefault();
    insertBlock(editor.BlockManager.get(element.dataset.blockId));
  });
  editor.on('block:drag:stop', (component) => {
    if (!interactionPolicy.canAdd) return;
    if (component) {
      blockStyles();
      if (componentWithClass(component, 'alva-chart-bars') || componentWithClass(component, 'alva-donut')) normalizeCharts(editor);
      if (tagOf(component) === 'form' || component.find('form').length) formStyles();
      announce('Elemento adicionado. Selecione para personalizar.');
    }
  });
  function run(action) {
    try {
      if (!interactionPolicy.canEdit) return;
      action();
      render();
    } catch (error) {
      announce(error.message || 'Não foi possível alterar este elemento.');
    }
  }
  $('.fe-canvas-bar [data-undo]').onclick = () => {
    const selectedId = componentTreeId(editor.getSelected());
    run(() => editor.UndoManager.undo());
    restoreTreeSelection(editor, selectedId, treeComponents);
    render();
  };
  $('.fe-canvas-bar [data-redo]').onclick = () => {
    const selectedId = componentTreeId(editor.getSelected());
    run(() => editor.UndoManager.redo());
    restoreTreeSelection(editor, selectedId, treeComponents);
    render();
  };

  function section(title) {
    const el = document.createElement('section');
    el.className = 'fe-control-section';
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      el.append(h);
    }
    props.append(el);
    return el;
  }
  function help(parent, text) {
    const p = document.createElement('p');
    p.className = 'fe-help';
    p.textContent = text;
    parent.append(p);
  }
  function field(parent, label, value, change, options = {}) {
    const row = document.createElement('label');
    row.className = 'fe-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    row.append(caption);
    const input = document.createElement(options.choices ? 'select' : options.multiline ? 'textarea' : 'input');
    if (options.choices)
      for (const [val, text] of options.choices) {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = text;
        input.append(option);
      }
    else if (!options.multiline) input.type = options.type || 'text';
    input.value = value ?? '';
    if (options.type === 'checkbox') input.checked = Boolean(value);
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    input.onchange = () => {
      if (!interactionPolicy.canEdit) return;
      input.setCustomValidity('');
      try {
        change(options.type === 'checkbox' ? input.checked : input.value);
        announce('Alteração aplicada. Você pode desfazer a qualquer momento.');
      } catch (error) {
        input.setCustomValidity(error.message);
        input.reportValidity();
        announce(error.message);
      }
    };
    input.oninput = () => input.setCustomValidity('');
    row.append(input);
    parent.append(row);
    return input;
  }
  function chartItems(parent, rows, { item, addLabel, max = Infinity, change }) {
    let currentRows = validateChartRows(rows, max);
    const apply = (next) => {
      const validRows = validateChartRows(next, max);
      change(validRows);
      currentRows = validRows;
    };
    currentRows.forEach(([name, value], index) => {
      const itemEditor = document.createElement('div');
      itemEditor.className = 'fe-field';
      field(itemEditor, 'Nome', name, (next) => apply(updateChartRow(currentRows, index, { name: next }, max)));
      field(itemEditor, 'Valor', value, (next) => apply(updateChartRow(currentRows, index, { value: next }, max)), {
        type: 'number', min: 0, ...(max !== Infinity ? { max } : {}),
      });
      button(itemEditor, `Remover ${item}`, () => {
        apply(removeChartRow(currentRows, index, max));
      }, { className: 'fe-danger' });
      parent.append(itemEditor);
    });
    button(parent, addLabel, () => apply([...currentRows, [`${item[0].toUpperCase()}${item.slice(1)} ${currentRows.length + 1}`, 0]]));
  }
  function button(parent, text, action, options = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    if (options.icon) {
      b.classList.add('fe-icon-button');
      applyIconButton(b, options.icon);
    } else b.textContent = text;
    if (options.className) b.classList.add(...options.className.split(/\s+/).filter(Boolean));
    b.disabled = !!options.disabled || !interactionPolicy.canEdit;
    b.onclick = () => run(action);
    parent.append(b);
    return b;
  }
  function styleValue(model, property) {
    return (
      model.getStyle()[property] ||
      (model.getEl()
        ? model.getEl().ownerDocument.defaultView.getComputedStyle(model.getEl()).getPropertyValue(property)
        : '')
    );
  }
  function styleNumber(parent, model, label, property, fallback = '', max = 500) {
    const n = parseFloat(styleValue(model, property));
    return field(
      parent,
      label,
      Number.isFinite(n) ? inspectorNumber(n) : fallback,
      (value) => {
        if (value === '') {
          model.removeStyle(property);
          return;
        }
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`Use um valor entre 0 e ${max}.`);
        model.addStyle({ [property]: number + 'px' });
      },
      { type: 'number', min: 0, max },
    );
  }
  function color(parent, model, label, property) {
    const current = styleValue(model, property);
    const hex = colorToHex(current) || '#ffffff';
    const row = document.createElement('div');
    row.className = 'fe-color-control';
    const caption = document.createElement('span');
    caption.className = 'fe-color-label';
    caption.textContent = label;
    row.append(caption);
    const controls = document.createElement('div');
    controls.className = 'fe-color-controls';
    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'fe-color-swatch';
    swatch.value = hex;
    swatch.setAttribute('aria-label', `${label} (amostra)`);
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'fe-color-hex';
    hexInput.value = hex;
    hexInput.placeholder = '#RRGGBB';
    hexInput.setAttribute('aria-label', `${label} (HEX)`);
    const apply = (value, input) => {
      if (!interactionPolicy.canEdit) return;
      const next = String(value || '').trim().toLowerCase();
      input.setCustomValidity('');
      if (!isHexColor(next)) {
        input.setCustomValidity('Use uma cor hexadecimal no formato #RRGGBB.');
        input.reportValidity();
        return;
      }
      model.addStyle({ [property]: next });
      swatch.value = next;
      hexInput.value = next;
      announce('Alteração aplicada. Você pode desfazer a qualquer momento.');
    };
    swatch.oninput = () => {
      hexInput.value = swatch.value;
      hexInput.setCustomValidity('');
    };
    swatch.onchange = () => apply(swatch.value, swatch);
    hexInput.oninput = () => {
      if (isHexColor(hexInput.value.trim())) apply(hexInput.value, hexInput);
      else hexInput.setCustomValidity('Use uma cor hexadecimal no formato #RRGGBB.');
    };
    hexInput.onchange = () => apply(hexInput.value, hexInput);
    controls.append(swatch, hexInput);
    row.append(controls);
    parent.append(row);
    return hexInput;
  }
  function render() {
    clearTimeout(repaint);
    const model = editor.getSelected();
    if (!mediaEnabled() && (model?.is?.('vsl') || model?.get?.('type') === 'vsl')) {
      editor.select(editor.getWrapper());
      return render();
    }
    // Preserve the field and cursor while typing; repaint on selection, blur, undo or redo.
    if (
      model === activeModel &&
      props.contains(document.activeElement) &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    )
      return;
    activeModel = model;
    const mode = panelMode(model);
    renderTree();
    syncCanvasSelection(model);
    $('.fe-canvas-bar [data-undo]').disabled = !interactionPolicy.canEdit || !editor.UndoManager.hasUndo();
    $('.fe-canvas-bar [data-redo]').disabled = !interactionPolicy.canEdit || !editor.UndoManager.hasRedo();
    props.replaceChildren();
    if (mode === 'library') {
      const empty = document.createElement('div');
      empty.className = 'fe-inspector-empty';
      empty.innerHTML = '<h3>Selecione um elemento</h3><p class="fe-help">Escolha na estrutura ou clique no canvas para editar conteúdo, aparência e posição.</p>';
      props.append(empty);
      return;
    }
    const tag = tagOf(model);
    const attrs = model.getAttributes();
    const isVsl = model.is?.('vsl') || model.get?.('type') === 'vsl';
    const inspectorTitle = document.createElement('div');
    inspectorTitle.className = 'fe-inspector-title';
    inspectorTitle.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${editorTreeIcon(model)}</span><div><small>CONTEÚDO</small><h2></h2></div>`;
    inspectorTitle.querySelector('h2').textContent = editorialLabel(model);
    props.append(inspectorTitle);
    const head = section('');
    head.classList.add('fe-element-control');
    const backToLibrary = button(head, '← Adicionar elementos', () => {
      activateWorkspacePanel('structure', { focusTab: isCompactWorkspace() });
      editor.select(editor.getWrapper());
    }, {
      className: 'fe-back-library fe-visually-hidden',
    });
    head.prepend(backToLibrary);
    const actions = document.createElement('div');
    actions.className = 'fe-element-actions';
    head.append(actions);
    const parent = model.parent();
    button(actions, 'Mover acima', () => model.move(parent, { at: model.index() - 1 }), {
      disabled: !parent || model.index() === 0,
      icon: 'moveUp',
    });
    button(actions, 'Mover abaixo', () => model.move(parent, { at: model.index() + 2 }), {
      disabled: !parent || model.index() >= parent.components().length - 1,
      icon: 'moveDown',
    });
    button(actions, 'Selecionar grupo', () => editor.select(parent), { disabled: !parent, icon: 'selectParent' });
    button(
      actions,
      'Duplicar',
      () => {
        const copy = model.clone();
        parent.append(copy, { at: model.index() + 1 });
        editor.select(copy);
      },
      { icon: 'duplicate' },
    );
    button(
      actions,
      'Excluir',
      () => {
        model.remove();
        editor.select(parent);
        announce('Elemento excluído. Use Desfazer para recuperar.');
      },
      { className: 'fe-danger', icon: 'delete' },
    );

    const content = section('Conteúdo');
    if (isVsl) {
      const currentId = String(model.get('publicId') || attrs[VSL_ATTRIBUTE] || '').trim();
      if (canReadVsl() && !vslLoadError) {
        const label = document.createElement('h4');
        label.textContent = 'VSL publicada';
        content.append(label);
        content.insertAdjacentHTML('beforeend', renderVslOptionCards(vslVideos, currentId));
        const vslOptions = [...content.querySelectorAll('[data-vsl-option]')];
        const vslOptionIds = vslOptions.map((option) => String(option.dataset.vslOption || ''));
        vslOptions.forEach((option) => {
          option.onclick = () => {
            if (!canInsertVsl() || option.disabled) return;
            model.set('publicId', String(option.dataset.vslOption || '').trim());
            render();
          };
          option.onkeydown = (event) => {
            const nextId = vslOptionKeyboardAction(event, vslOptionIds, currentId, vslOptions.filter((candidate) => candidate.disabled).map((candidate) => candidate.dataset.vslOption));
            if (nextId === null) return;
            event.preventDefault();
            const next = vslOptions.find((candidate) => candidate.dataset.vslOption === nextId && !candidate.disabled);
            if (next) { pendingVslOptionFocusId = nextId; next.click(); }
          };
        });
        help(content, publishedVslById.size ? 'A prévia usa a versão publicada da VSL.' : 'Ainda não há VSLs publicadas neste projeto.');
      } else help(content, !canReadVsl() ? 'Você não tem permissão para visualizar VSLs.' : vslLoadError || 'Não foi possível carregar as VSLs. Tente novamente.');
    }
    const textTags = /^(h[1-6]|p|span|small|strong|em|a|button)$/;
    const isIcon = isMaterialIcon(model);
    const isHeading = /^h[1-6]$/.test(tag);
    const hasStructure = model.find('img,form,input,textarea,select,div,section').length > 0;
    if (textTags.test(tag) && !hasStructure && !isIcon) {
      field(
        content,
        tag === 'a' || tag === 'button' ? 'Texto do botão' : isHeading ? 'Texto' : 'Seu texto',
        model.getEl()?.innerText || model.getEl()?.textContent || model.get('content') || '',
        (value) => model.components(escapeText(value).replace(/\n/g, '<br>')),
        { multiline: true },
      );
      help(content, 'Você também pode dar dois cliques no texto da página.');
    }
    if (isHeading) {
      const level = document.createElement('div');
      level.className = 'fe-field';
      level.innerHTML = '<span>Nível do título</span><div class="fe-heading-levels" role="group" aria-label="Nível do título"></div>';
      const choices = level.querySelector('.fe-heading-levels');
      ['h1', 'h2', 'h3'].forEach((value) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = value.toUpperCase();
        option.setAttribute('aria-pressed', String(tag === value));
        option.disabled = !interactionPolicy.canEdit;
        option.onclick = () => run(() => setHeadingLevel(model, value));
        choices.append(option);
      });
      content.append(level);
    }
    if (isIcon) {
      field(content, 'Escolha o ícone', model.get('content') || model.getEl()?.textContent || 'star', (value) => model.components(escapeText(value)), {
        choices: [
          ['star', 'Estrela'], ['check_circle', 'Confirmação'], ['arrow_forward', 'Seta'], ['person', 'Pessoa'],
          ['phone', 'Telefone'], ['mail', 'E-mail'], ['location_on', 'Local'], ['calendar_month', 'Calendário'],
          ['analytics', 'Gráfico'], ['monitoring', 'Resultados'], ['play_circle', 'Vídeo'], ['image', 'Imagem'],
          ['cloud_upload', 'Enviar arquivo'], ['task_alt', 'Tarefa'], ['home', 'Início'], ['tune', 'Ajustes'],
        ],
      });
      help(content, 'Ícones fornecidos pelo Google Material Symbols.');
    }
    if (tag === 'a') {
      field(
        content,
        'Ao clicar, abrir',
        attrs.href || '',
        (value) => model.addAttributes({ href: safeDestination(value) }),
        { placeholder: 'https://seusite.com ou #contato' },
      );
      field(
        content,
        'Abrir em nova aba',
        attrs.target === '_blank',
        (checked) => {
          if (checked) model.addAttributes({ target: '_blank', rel: 'noopener noreferrer' });
          else model.removeAttributes('target');
        },
        { type: 'checkbox' },
      );
    }
    if (tag === 'img') {
      field(
        content,
        'Endereço da imagem',
        attrs.src || model.get('src') || '',
        (value) => model.set('src', safeDestination(value, true)),
        { placeholder: 'https://…/imagem.jpg' },
      );
      field(content, 'Descrição da imagem', attrs.alt || '', (value) => model.addAttributes({ alt: value }), {
        placeholder: 'Descreva o que aparece na imagem',
      });
      const upload = field(content, 'Escolher imagem do computador', '', () => {}, { type: 'file' });
      upload.accept = 'image/png,image/jpeg,image/webp,image/gif';
      upload.onchange = () => {
        if (!interactionPolicy.canEdit) return;
        const file = upload.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
          announce('Escolha PNG, JPG, WebP ou GIF de até 5 MB.');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          model.set('src', reader.result);
          announce('Imagem adicionada.');
          render();
        };
        reader.readAsDataURL(file);
      };
      field(
        content,
        'Encaixe da imagem',
        styleValue(model, 'object-fit') || 'cover',
        (value) => model.addStyle({ 'object-fit': value }),
        {
          choices: [
            ['cover', 'Preencher o espaço'],
            ['contain', 'Mostrar a imagem inteira'],
          ],
        },
      );
      styleNumber(content, model, 'Altura da imagem (px)', 'height', '', 2000);
    }
    const fieldLabel = tag === 'label' ? model : tagOf(model.parent()) === 'label' ? model.parent() : null;
    if (fieldLabel) {
      const textNode = fieldLabel.components().models.find((child) => child.is('textnode'));
      const labelText = textNode?.get('content') || fieldLabel.get('content') || '';
      field(content, 'Nome mostrado acima do campo', labelText, (value) => {
        if (textNode) textNode.set('content', value);
        else if (fieldLabel.get('content')) fieldLabel.set('content', escapeText(value));
        else fieldLabel.append({ type: 'textnode', content: value }, { at: 0 });
      });
    }
    if (['input', 'textarea', 'select'].includes(tag)) {
      field(content, 'Nome para identificar a resposta', attrs.name || '', (value) =>
        model.addAttributes({ name: value.trim() }),
      );
      field(content, 'Texto de ajuda no campo', attrs.placeholder || '', (value) =>
        model.addAttributes({ placeholder: value }),
      );
      if (tag === 'input')
        field(content, 'Tipo de resposta', attrs.type || 'text', (value) => model.addAttributes({ type: value }), {
          choices: [
            ['text', 'Texto'],
            ['email', 'E-mail'],
            ['tel', 'Telefone'],
            ['number', 'Número'],
            ['date', 'Data'],
          ],
        });
      field(
        content,
        'Resposta obrigatória',
        attrs.required !== undefined && attrs.required !== false,
        (checked) => (checked ? model.addAttributes({ required: true }) : model.removeAttributes('required')),
        { type: 'checkbox' },
      );
    }
    if (tag === 'label') {
      help(content, 'Selecione o campo abaixo para configurar o tipo de resposta e a obrigatoriedade.');
      const input = model.find('input,textarea,select')[0];
      if (input) button(content, 'Editar campo', () => editor.select(input));
    }
    const barChart = componentWithClass(model, 'alva-chart-bars');
    if (barChart) {
      const labels = componentsByTag(barChart, 'small');
      const bars = componentsByTag(barChart, 'i');
      const rows = labels.map((label, index) => {
        const name = label.getEl()?.textContent || label.get('content') || `Item ${index + 1}`;
        return [name, parseFloat(bars[index]?.getStyle()?.['--value']) || 0];
      });
      chartItems(content, rows, {
        item: 'barra', addLabel: '+ Adicionar barra', max: 100,
        change: (nextRows) => {
          barChart.components(nextRows.map(([name, number]) => `<div><i style="--value:${number}%"></i><small>${escapeText(name)}</small></div>`).join(''));
        },
      });
      help(content, 'Cada barra usa um nome e uma porcentagem entre 0 e 100.');
    }
    const donut = componentWithClass(model, 'alva-donut');
    if (donut) {
      const data = (() => {
        try { return JSON.parse(donut.getAttributes()['data-alva-chart-data'] || '[]'); }
        catch { return []; }
      })();
      const rows = data.length ? data : [['Visitas', 52], ['Contatos', 26], ['Vendas', 22]];
      const title = componentsByTag(donut, 'strong')[0];
      if (title) field(content, 'Título do gráfico', title.getEl()?.textContent || title.get('content') || 'Resultados', (value) => title.components(escapeText(value)));
      chartItems(content, rows, {
        item: 'fatia', addLabel: '+ Adicionar fatia',
        change: (nextRows) => {
          const segments = donutSegments(nextRows);
          donut.addAttributes({ 'data-alva-chart-data': JSON.stringify(nextRows) });
          donut.addStyle({ background: `conic-gradient(${segments})` });
        },
      });
      help(content, 'Cada fatia usa um nome e uma quantidade. As quantidades definem a proporção.');
    }
    let form = model;
    while (form && tagOf(form) !== 'form') form = form.parent();
    if (form) {
      button(content, 'Configurar recebimento das respostas', () => onOpenFormSettings(form));
      if (tag === 'form') {
        button(content, '+ Adicionar campo', () => {
          formStyles();
          const submit = form.components().models.find((child) => tagOf(child) === 'button');
          const added = form.append(blocks.find(([id]) => id === 'input')[3], {
            at: submit ? submit.index() : form.components().length,
          });
          editor.select(added[0]);
        });
        help(content, 'Selecione cada campo para mudar seu nome, tipo e obrigatoriedade.');
      }
    }
    if (!isVsl && ['section', 'main', 'div', 'article', 'nav', 'footer'].includes(tag)) {
      field(
        content,
        'Nome da seção (para links)',
        attrs.id || '',
        (value) => {
          if (value && !/^[a-zA-Z][\w-]*$/.test(value))
            throw new Error('Comece com uma letra e use letras, números ou hífen.');
          if (value) model.addAttributes({ id: value });
          else model.removeAttributes('id');
        },
        { placeholder: 'Ex.: contato' },
      );
      help(
        content,
        'Adicione elementos pelo painel à esquerda. Use #contato em um botão para levar até a seção contato.',
      );
    }
    if (content.children.length === 1)
      help(content, 'Selecione um elemento dentro deste grupo para editar seu conteúdo.');
    const hasTypography = (textTags.test(tag) && !isIcon) || ['input', 'textarea'].includes(tag);
    const appearance = section(hasTypography ? 'Tipografia' : 'Aparência');
    if (hasTypography) {
      styleNumber(appearance, model, 'Tamanho', 'font-size', 16, 200);
      const typographyRow = document.createElement('div');
      typographyRow.className = 'fe-color-grid';
      appearance.append(typographyRow);
      color(typographyRow, model, 'Cor', 'color');
      field(
        typographyRow,
        'Alinhamento',
        inspectorTextAlign(styleValue(model, 'text-align'), styleValue(model, 'direction') || attrs.dir),
        (value) => model.addStyle({ 'text-align': value }),
        {
          choices: [
            ['left', 'À esquerda'],
            ['center', 'Centralizado'],
            ['right', 'À direita'],
          ],
        },
      );
    }
    if (!hasTypography || ['a', 'button', 'input', 'textarea'].includes(tag)) color(appearance, model, 'Cor de fundo', 'background-color');
    if (isIcon) {
      color(appearance, model, 'Cor', 'color');
      styleNumber(appearance, model, 'Tamanho', 'font-size', 16, 200);
    }
    const space = section('Espaçamento');
    styleNumber(space, model, 'Distância abaixo', 'margin-bottom', 0);
    const motion = section('Movimento');
    motion.append(renderMotionPopover({
      value: attrs['data-alva-motion'] || 'none', canEdit: interactionPolicy.canEdit,
      onChange: (value) => run(() => {
        if (value === 'none') model.removeAttributes('data-alva-motion');
        else model.addAttributes({ 'data-alva-motion': value });
      }),
    }));
    const advanced = document.createElement('details');
    advanced.className = 'fe-advanced';
    advanced.innerHTML = '<summary>Mais ajustes</summary>';
    props.append(advanced);
    if (hasTypography) field(advanced, 'Peso do texto', styleValue(model, 'font-weight') || '400', (value) => model.addStyle({ 'font-weight': value }), { choices: [['400', 'Normal'], ['500', 'Médio'], ['600', 'Destaque'], ['700', 'Negrito']] });
    styleNumber(advanced, model, 'Cantos arredondados (px)', 'border-radius', 0);
    if (hasTypography && !['a', 'button', 'input', 'textarea'].includes(tag)) color(advanced, model, 'Cor de fundo', 'background-color');
    field(advanced, 'Duração (segundos)', parseFloat(styleValue(model, '--alva-duration')) || (attrs['data-alva-motion'] === 'float' ? 3 : 0.65), (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0.1 || number > 10) throw new Error('Use uma duração entre 0,1 e 10 segundos.');
      model.addStyle({ '--alva-duration': number + 's' });
    }, { type: 'number', min: 0.1, max: 10 });
    field(advanced, 'Atraso (segundos)', parseFloat(styleValue(model, '--alva-delay')) || 0, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 10) throw new Error('Use um atraso entre 0 e 10 segundos.');
      model.addStyle({ '--alva-delay': number + 's' });
    }, { type: 'number', min: 0, max: 10 });
    styleNumber(advanced, model, 'Respiro acima (px)', 'padding-top', 0);
    styleNumber(advanced, model, 'Respiro abaixo (px)', 'padding-bottom', 0);
    styleNumber(advanced, model, 'Respiro nas laterais (px)', 'padding-left', 0).onchange = (event) => {
      if (!interactionPolicy.canEdit) return;
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value >= 0 && value <= 500) model.addStyle({ 'padding-left': value + 'px', 'padding-right': value + 'px' });
    };
    field(
      advanced,
      'Largura',
      model.getStyle().width || '',
      (value) => {
        if (!value) model.removeStyle('width');
        else if (/^(auto|\d+(\.\d+)?(px|%|vw))$/.test(value)) model.addStyle({ width: value });
        else throw new Error('Use auto, 100%, 50% ou uma medida como 320px.');
      },
      { placeholder: 'Automática' },
    );
    help(advanced, 'Exemplos: 100% para ocupar o espaço; 320px para uma largura fixa.');
    styleNumber(advanced, model, 'Altura mínima (px)', 'min-height', '', 3000);
    if (['section', 'div', 'main', 'article'].includes(tag))
      styleNumber(advanced, model, 'Distância entre elementos (px)', 'gap', 0);
    if (!interactionPolicy.canEdit) props.querySelectorAll('input, select, textarea, .fe-element-actions button, .fe-vsl-option, .fe-heading-levels button, .fe-motion-select button').forEach((control) => { control.disabled = true; });
    if (pendingVslOptionFocusId !== null) {
      restoreVslOptionFocus(props.querySelectorAll('[data-vsl-option]'), pendingVslOptionFocusId);
      pendingVslOptionFocusId = null;
    }
  }
  cleanup.push(bindInspectorRepaintOnFocusout(props, () => {
    repaint = setTimeout(render, 100);
  }));
  editor.on('component:selected component:deselected', render);
  editor.on('update', () => {
    if (!interactionPolicy.canEdit) return;
    if (!loading) onChange();
    clearTimeout(repaint);
    repaint = setTimeout(render, 100);
  });
  editor.on('undo redo', () => {
    activeModel = null;
    render();
  });
  editor.on('load', () => {
    if (componentWithClass(editor.getWrapper(), 'alva-chart-bars') || componentWithClass(editor.getWrapper(), 'alva-donut')) normalizeCharts(editor);
    render();
  });
  function handleEditorKey(event, stopImmediate = false) {
    if (event.target?.closest?.('.fe-motion-select')) return;
    if (!interactionPolicy.canEdit) return;
    const action = editorKeyboardAction(event, editor.getSelected());
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (stopImmediate) event.stopImmediatePropagation();
    if (action === 'delete') {
      editor.getSelected().remove();
      announce('Elemento excluído. Use Desfazer para recuperar.');
    }
    editor.select(editor.getWrapper());
    activeModel = null;
    render();
  }
  const clearFromCanvasBackground = (event) => {
    if (!event.target.matches('.fe-canvas, .gjs-cv-canvas, .gjs-cv-canvas__frames')) return;
    activateWorkspacePanel('canvas', { focusTab: isCompactWorkspace() });
    editor.select(editor.getWrapper());
    render();
  };
  host.addEventListener('keydown', handleEditorKey, true);
  $('.fe-canvas').addEventListener('click', clearFromCanvasBackground);
  cleanup.push(() => host.removeEventListener('keydown', handleEditorKey, true));
  cleanup.push(() => $('.fe-canvas').removeEventListener('click', clearFromCanvasBackground));
  editor.on('destroy', () => {
    clearTimeout(repaint);
    cleanup.splice(0).forEach((dispose) => dispose());
  });
  render();
  return editor;
}
