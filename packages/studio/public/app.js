import { flushChanges } from './save-cycle.js';
import { templates, getTemplate, normalizeForms } from './templates.js';
import { createFriendlyEditor } from './editor-shell.js';
import { createOwnerUI } from './owner.js';
import { createUIPreferences } from './ui-preferences.js';
import { createFormsUI } from './forms.js';
import { createStudioShell } from './studio-shell.js';
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
  config = { vercelConnected: false };
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 6000);
}
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && /^\/(pages|config|settings)/.test(path)) ownerUI?.sessionExpired();
    throw Object.assign(new Error(result.error || 'Não foi possível concluir.'), { status: response.status });
  }
  return result;
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
async function loadList() {
  pages = await api('/pages');
  renderList();
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
      '</p><div class="card-actions"><button class="edit">Editar página ↗</button><button class="duplicate" title="Duplicar página">Duplicar</button><button class="delete" title="Excluir página">Excluir</button></div></div>';
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
  formsUI.showPages();
  await loadList();
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
  config = await api('/config');
  if (page) {
    $('#publish').disabled = !config.vercelConnected;
    $('#publish').title = config.vercelConnected ? 'Publicar na Vercel' : 'Conecte a Vercel nas configurações do app';
  }
}
async function closeOpenEditors() {
  await save();
  clearTimeout(timer);
  if (editor) editor.destroy();
  editor = null;
  page = null;
  pages = [];
  dirty = false;
  $('#editing').hidden = true;
  $('#page-list').replaceChildren();
  await formsUI.closeEditor();
}
async function returnToProject(projectId) {
  if (projectId && studioShell?.state().currentProject?.id !== projectId) await studioShell.selectProject(projectId);
}
formsUI = createFormsUI({ api, toast, onReturnToProject: returnToProject });
studioShell = createStudioShell({
  api,
  beforeContextChange: closeOpenEditors,
  onContextChanged: async () => {
    formsUI.showPages();
    await loadList();
  },
});
ownerUI = createOwnerUI({
  api,
  toast,
  onAuthenticated: async () => {
    await studioShell.initialize();
    await refreshConfig();
    if (page) {
      $('#editing').hidden = false;
      $('#dashboard').hidden = true;
    } else {
      $('#dashboard').hidden = false;
      formsUI.showPages();
      await loadList();
    }
  },
  beforeLogout: save,
  onLoggedOut: async () => {
    clearTimeout(timer);
    editor?.destroy();
    editor = null;
    page = null;
    pages = [];
    dirty = false;
    $('#page-list').replaceChildren();
    $('#editing').hidden = true;
    $('#dashboard').hidden = true;
    formsUI.reset();
  },
  onSettingsChanged: refreshConfig,
});
$('#app-settings').onclick = () => ownerUI.openSettings();
$('#page-vercel-settings').onclick = () => {
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
