import { flushChanges } from './save-cycle.js';
import { services, templateCss, blocks } from './templates.js';
const $ = (s) => document.querySelector(s);
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
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir.');
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
    '</title><style>' +
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
        frame.srcdoc =
          full.html ||
          '<!doctype html><style>' +
            templateCss +
            '</style>' +
            (full.template === 'blank' ? '<h1>Nova página</h1>' : services);
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
  editor = grapesjs.init({
    container: '#editor',
    height: 'calc(100vh - 66px)',
    width: 'auto',
    storageManager: false,
    noticeOnUnload: false,
    fromElement: false,
    assetManager: { upload: false, embedAsBase64: true },
    i18n: { locale: 'pt', localeFallback: 'en', messages: { pt: window.alvaLocale } },
    deviceManager: {
      devices: [
        { id: 'Desktop', name: 'Computador', width: '' },
        { id: 'Tablet', name: 'Tablet', width: '768px', widthMedia: '992px' },
        { id: 'Mobile', name: 'Celular', width: '375px', widthMedia: '760px' },
      ],
    },
    blockManager: { blocks: blocks.map(([id, label, category, content]) => ({ id, label, category, content })) },
  });
  editor.DomComponents.addType('alva-field', {
    isComponent: (el) => el.tagName === 'INPUT',
    model: {
      defaults: {
        tagName: 'input',
        void: true,
        droppable: false,
        traits: [
          { type: 'text', name: 'name', label: 'Nome do campo' },
          { type: 'text', name: 'placeholder', label: 'Texto de ajuda' },
          {
            type: 'select',
            name: 'type',
            label: 'Tipo',
            options: [
              { id: 'text', label: 'Texto' },
              { id: 'email', label: 'E-mail' },
              { id: 'tel', label: 'Telefone' },
              { id: 'number', label: 'Número' },
            ],
          },
          { type: 'checkbox', name: 'required', label: 'Obrigatório' },
        ],
      },
    },
  });
  if (page.project) editor.loadProjectData(page.project);
  else {
    editor.setComponents(
      page.template === 'blank'
        ? '<main style="min-height:700px;padding:60px"><h1>Uma nova página começa aqui.</h1><p>Arraste os blocos ao lado e dê forma à sua ideia.</p></main>'
        : services,
    );
    editor.setStyle(templateCss);
  }
  editor.on('update', markDirty);
  loading = false;
  if (!page.project) markDirty();
  $('#device').value = 'Desktop';
  $('#publish').disabled = !config.vercelConnected;
  $('#publish').title = config.vercelConnected ? 'Publicar na Vercel' : 'Configure a conexão com a Vercel no servidor';
}
$('#new-page').onclick = () => $('#create-dialog').showModal();
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
  await save();
  clearTimeout(timer);
  if (editor) {
    editor.destroy();
    editor = null;
  }
  page = null;
  $('#editing').hidden = true;
  $('#dashboard').hidden = false;
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
    ? 'Publicação: ' + p.state + ' · ' + (p.url || '')
    : 'Nenhuma publicação enviada.';
  $('#check-publication').disabled = !p || !config.vercelConnected;
  $('#connect-domain').disabled = !p || p.state !== 'READY' || !config.vercelConnected;
}
$('#settings').onclick = () => {
  const form = $('#settings-form');
  form.elements.webhook.value = page.webhook;
  form.elements.domain.value = page.domain;
  $('#vercel-state').textContent = config.vercelConnected
    ? '● Vercel conectada'
    : '○ Vercel não conectada. Configure VERCEL_TOKEN no ambiente do servidor.';
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
try {
  config = await api('/config');
  await loadList();
} catch (error) {
  toast(error.message);
}
