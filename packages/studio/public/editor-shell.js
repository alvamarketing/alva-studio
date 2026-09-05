import { blocks, normalizeForms, templateCss } from './templates.js';

const svg = (body) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const blockIcons = {
  section: '▤',
  columns: '▥',
  heading: 'T',
  text: '≡',
  image: '▧',
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

export function createFriendlyEditor({
  container,
  project,
  html = '',
  css = '',
  onChange = () => {},
  onOpenFormSettings = () => {},
}) {
  const host = typeof container === 'string' ? document.querySelector(container) : container;
  if (!host) throw new Error('Não foi possível abrir a área de edição.');
  host.classList.add('friendly-editor');
  host.innerHTML = `
    <aside class="fe-sidebar" data-editor-panel="structure">
      <div class="fe-panel-heading">
        <span class="fe-eyebrow">CONSTRUA SUA PÁGINA</span>
        <h2>Estrutura</h2>
        <p>Selecione um elemento para editar ou mude sua ordem pelos controles de edição.</p>
      </div>
      <div class="fe-tree" role="tree" aria-label="Estrutura da página"></div>
      <details class="fe-library" open>
        <summary>Adicionar elementos</summary>
        <div class="fe-blocks"></div>
        <div class="fe-library-tip"><strong>Comece pelo essencial</strong><p>Um título claro, uma imagem e um convite para conversar.</p></div>
      </details>
    </aside>
    <div class="fe-workspace" data-editor-panel="canvas">
      <div class="fe-canvas-bar" aria-label="Histórico de edição"><button type="button" class="fe-icon-button" data-undo></button><button type="button" class="fe-icon-button" data-redo></button></div>
      <div class="fe-canvas"></div>
      <div class="fe-status" role="status" aria-live="polite">Dica: dê dois cliques em um texto para escrever diretamente na página.</div>
    </div>
    <aside class="fe-inspector" data-editor-panel="inspector" aria-label="Editar elemento"><div class="fe-properties"></div></aside>`;
  const $ = (selector) => host.querySelector(selector);
  const props = $('.fe-properties');
  const status = $('.fe-status');
  const tree = $('.fe-tree');
  let loading = true;
  let repaint;
  let activeModel;
  let treeComponents = new Map();
  const cleanup = [];
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
      appendOnClick: (block) => insertBlock(block),
      blocks: blocks.map(([id, label, category, content]) => ({
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
    const handleCanvasKey = (event) => handleEditorKey(event, true);
    const clearSelection = (event) => {
      if (isCanvasBackgroundElement(event.target)) {
        editor.select(editor.getWrapper());
        render();
      }
    };
    doc.addEventListener('keydown', handleCanvasKey, true);
    doc.addEventListener('click', clearSelection);
    cleanup.push(() => {
      doc.removeEventListener('keydown', handleCanvasKey, true);
      doc.removeEventListener('click', clearSelection);
    });
  });
  editor.DomComponents.addType('alva-field', {
    isComponent: (element) => element.tagName === 'INPUT',
    model: { defaults: { tagName: 'input', void: true, droppable: false, traits: [] } },
  });
  if (project) editor.loadProjectData(project);
  else {
    editor.setComponents(html);
    editor.setStyle(css);
  }
  const beforeMigration = project ? JSON.stringify(editor.getProjectData()) : null;
  normalizeForms(editor);
  editor.__alvaMigrated = !!project && beforeMigration !== JSON.stringify(editor.getProjectData());
  loading = false;
  if (editor.__alvaMigrated) onChange();

  function announce(message) {
    status.textContent = message;
  }
  function focusTreeItem(id, activeItem) {
    return restoreTreeFocus(tree.querySelectorAll('[data-tree-id]'), id, activeItem);
  }
  function selectTreeItem(id, activeItem = null) {
    const component = treeComponents.get(id);
    if (!component) return;
    editor.select(component, { scroll: true });
    activeModel = null;
    render();
    focusTreeItem(id, activeItem);
  }
  function renderTree() {
    const wrapper = editor.getWrapper();
    const nodes = componentTreeNodes(wrapper, editor.getSelected());
    treeComponents = new Map();
    const collect = (component) => {
      const id = componentTreeId(component);
      if (id) treeComponents.set(id, component);
      componentChildren(component).forEach(collect);
    };
    componentChildren(wrapper).forEach(collect);
    tree.replaceChildren();
    if (!nodes.length) {
      const empty = document.createElement('p');
      empty.className = 'fe-tree-empty';
      empty.textContent = 'Adicione um elemento para começar a montar sua página.';
      tree.append(empty);
      return;
    }
    const visibleIds = nodes.map((node) => node.id);
    for (const node of nodes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'fe-tree-item';
      item.dataset.treeId = node.id;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(node.level));
      item.setAttribute('aria-selected', String(node.selected));
      item.style.setProperty('--fe-tree-level', String(node.level));
      item.textContent = node.label;
      bindTreeItemActivation(item, (activeItem) => selectTreeItem(node.id, activeItem));
      item.onkeydown = (event) => {
        const next = treeKeyAction(event, visibleIds, node.id);
        if (!next) return;
        event.preventDefault();
        selectTreeItem(next, item);
      };
      tree.append(item);
    }
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
    const selected = editor.getSelected();
    const wrapper = editor.getWrapper();
    const id = block.getId();
    const structure = ['section', 'columns'].includes(id) || id.endsWith('-section') || id.startsWith('section-');
    blockStyles();
    let target = selected || wrapper;
    let at;
    // Whole sections belong next to the section being edited, never inside a paragraph.
    if (structure) {
      while (target.parent() && !['main', 'section'].includes(tagOf(target))) target = target.parent();
      if (tagOf(target) === 'section') {
        at = target.index() + 1;
        target = target.parent();
      }
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
    formStyles();
    if (added[0]) editor.select(added[0], { scroll: true });
    announce(`${block.get('label')} adicionado. Ajuste o conteúdo no painel lateral.`);
  }
  $('.fe-blocks').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = event.target.closest('[data-block-id]');
    if (!element) return;
    event.preventDefault();
    insertBlock(editor.BlockManager.get(element.dataset.blockId));
  });
  editor.on('block:drag:stop', (component) => {
    if (component) {
      blockStyles();
      if (tagOf(component) === 'form' || component.find('form').length) formStyles();
      announce('Elemento adicionado. Selecione para personalizar.');
    }
  });
  function run(action) {
    try {
      action();
      render();
    } catch (error) {
      announce(error.message || 'Não foi possível alterar este elemento.');
    }
  }
  $('.fe-canvas-bar [data-undo]').onclick = () => run(() => editor.UndoManager.undo());
  $('.fe-canvas-bar [data-redo]').onclick = () => run(() => editor.UndoManager.redo());

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
  function button(parent, text, action, options = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    if (options.icon) {
      b.classList.add('fe-icon-button');
      applyIconButton(b, options.icon);
    } else b.textContent = text;
    if (options.className) b.classList.add(...options.className.split(/\s+/).filter(Boolean));
    b.disabled = !!options.disabled;
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
      Number.isFinite(n) ? n : fallback,
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
    const rgb = current.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    const hex = rgb
      ? '#' +
        rgb
          .slice(1)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')
      : /^#[a-f\d]{6}$/i.test(current)
        ? current
        : '#ffffff';
    field(parent, label, hex, (value) => model.addStyle({ [property]: value }), { type: 'color' });
  }
  function render() {
    clearTimeout(repaint);
    const model = editor.getSelected();
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
    $('.fe-canvas-bar [data-undo]').disabled = !editor.UndoManager.hasUndo();
    $('.fe-canvas-bar [data-redo]').disabled = !editor.UndoManager.hasRedo();
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
    const head = section('Editar ' + componentLabel(model).toLocaleLowerCase('pt-BR'));
    const backToLibrary = button(head, '← Adicionar elementos', () => editor.select(editor.getWrapper()), {
      className: 'fe-back-library',
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
    const textTags = /^(h[1-6]|p|span|small|strong|em|a|button)$/;
    const hasStructure = model.find('img,form,input,textarea,select,div,section').length > 0;
    if (textTags.test(tag) && !hasStructure) {
      field(
        content,
        tag === 'a' || tag === 'button' ? 'Texto do botão' : 'Seu texto',
        model.getEl()?.innerText || model.getEl()?.textContent || model.get('content') || '',
        (value) => model.components(escapeText(value).replace(/\n/g, '<br>')),
        { multiline: true },
      );
      help(content, 'Você também pode dar dois cliques no texto da página.');
    }
    if (tag === 'span' && String(attrs.class || '').includes('material-symbols-outlined')) {
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
    if (String(attrs.class || '').includes('alva-chart-bars')) {
      const labels = model.find('small');
      const bars = model.find('i');
      const value = labels.map((label, index) => {
        const name = label.getEl()?.textContent || label.get('content') || `Item ${index + 1}`;
        return `${name}: ${parseFloat(bars[index]?.getStyle()?.['--value']) || 0}`;
      }).join('\n');
      field(content, 'Dados do gráfico', value, (next) => {
        const rows = next.split('\n').map((row) => row.match(/^\s*(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)).filter(Boolean).slice(0, 8);
        if (rows.length < 2) throw new Error('Use pelo menos duas linhas no formato Nome: 72.');
        model.components(rows.map((row) => `<div><i style="--value:${Math.min(100, Number(row[2]))}%"></i><small>${escapeText(row[1].trim())}</small></div>`).join(''));
      }, { multiline: true });
      help(content, 'Uma linha por barra. Exemplo: Contatos: 72');
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
    if (['section', 'main', 'div', 'article', 'nav', 'footer'].includes(tag)) {
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
    const appearance = section('Aparência');
    const colors = document.createElement('div');
    colors.className = 'fe-color-grid';
    appearance.append(colors);
    color(colors, model, 'Cor do texto', 'color');
    color(colors, model, 'Cor de fundo', 'background-color');
    if (textTags.test(tag) || ['input', 'textarea'].includes(tag)) {
      styleNumber(appearance, model, 'Tamanho do texto (px)', 'font-size', 16, 200);
      field(
        appearance,
        'Peso do texto',
        styleValue(model, 'font-weight') || '400',
        (value) => model.addStyle({ 'font-weight': value }),
        {
          choices: [
            ['400', 'Normal'],
            ['500', 'Médio'],
            ['600', 'Destaque'],
            ['700', 'Negrito'],
          ],
        },
      );
      field(
        appearance,
        'Alinhamento do texto',
        styleValue(model, 'text-align') || 'left',
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
    styleNumber(appearance, model, 'Cantos arredondados (px)', 'border-radius', 0);
    const space = section('Espaçamento');
    styleNumber(space, model, 'Respiro acima (px)', 'padding-top', 0);
    styleNumber(space, model, 'Respiro abaixo (px)', 'padding-bottom', 0);
    styleNumber(space, model, 'Respiro nas laterais (px)', 'padding-left', 0).onchange = (event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value >= 0 && value <= 500)
        model.addStyle({ 'padding-left': value + 'px', 'padding-right': value + 'px' });
    };
    styleNumber(space, model, 'Distância do próximo elemento (px)', 'margin-bottom', 0);
    const motion = section('Movimento');
    field(
      motion,
      'Como este elemento aparece',
      attrs['data-alva-motion'] || 'none',
      (value) => {
        if (value === 'none') model.removeAttributes('data-alva-motion');
        else model.addAttributes({ 'data-alva-motion': value });
      },
      { choices: [['none', 'Sem movimento'], ['fade-up', 'Subir suavemente'], ['slide-left', 'Entrar pela lateral'], ['zoom-in', 'Aproximar'], ['float', 'Flutuar']] },
    );
    field(motion, 'Duração (segundos)', parseFloat(styleValue(model, '--alva-duration')) || (attrs['data-alva-motion'] === 'float' ? 3 : 0.65), (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0.1 || number > 10) throw new Error('Use uma duração entre 0,1 e 10 segundos.');
      model.addStyle({ '--alva-duration': number + 's' });
    }, { type: 'number', min: 0.1, max: 10 });
    field(motion, 'Atraso (segundos)', parseFloat(styleValue(model, '--alva-delay')) || 0, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 10) throw new Error('Use um atraso entre 0 e 10 segundos.');
      model.addStyle({ '--alva-delay': number + 's' });
    }, { type: 'number', min: 0, max: 10 });
    const advanced = document.createElement('details');
    advanced.className = 'fe-advanced';
    advanced.innerHTML = '<summary>Mais ajustes</summary>';
    props.append(advanced);
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
  }
  props.addEventListener('focusout', () => {
    repaint = setTimeout(render, 100);
  });
  editor.on('component:selected component:deselected', render);
  editor.on('update', () => {
    if (!loading) onChange();
    clearTimeout(repaint);
    repaint = setTimeout(render, 100);
  });
  editor.on('undo redo', () => {
    activeModel = null;
    render();
  });
  editor.on('load', render);
  function handleEditorKey(event, stopImmediate = false) {
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
