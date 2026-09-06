import { mountVslPlayer } from './vsl-player.js';

const SOURCE_INPUTS = Object.freeze({
  mp4: Object.freeze({ label: 'URL da mídia', placeholder: 'https://…', inputMode: 'url' }),
  hls: Object.freeze({ label: 'URL da mídia', placeholder: 'https://…/video.m3u8', inputMode: 'url' }),
  youtube: Object.freeze({ label: 'URL ou ID do YouTube', placeholder: 'https://youtu.be/… ou ID', inputMode: 'text' }),
  vimeo: Object.freeze({ label: 'URL ou ID do Vimeo', placeholder: 'https://vimeo.com/… ou ID', inputMode: 'text' }),
});

export function sourceInputModel(sourceType) {
  return SOURCE_INPUTS[sourceType] ?? SOURCE_INPUTS.mp4;
}

function providerId(sourceType, value) {
  const text = String(value ?? '').trim();
  if (sourceType === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  if (sourceType === 'vimeo' && /^\d{6,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (sourceType === 'youtube') {
      if (host === 'youtu.be' || host === 'www.youtu.be') return url.pathname.slice(1);
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) return url.pathname === '/watch' ? url.searchParams.get('v') || '' : url.pathname.replace(/^\/embed\//, '');
    }
    if (sourceType === 'vimeo' && ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) return url.pathname.replace(/^\/video\//, '').replace(/^\//, '');
  } catch { /* the server will report invalid URLs on save */ }
  return '';
}

export function previewVslSource(sourceType, sourceUrl) {
  const source = String(sourceUrl ?? '').trim();
  if (sourceType === 'youtube') {
    const id = providerId(sourceType, source);
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}?enablejsapi=1` : '';
  }
  if (sourceType === 'vimeo') {
    const id = providerId(sourceType, source);
    return /^\d{6,12}$/.test(id) ? `https://player.vimeo.com/video/${id}` : '';
  }
  try { return new URL(source).protocol === 'https:' ? source : ''; } catch { return ''; }
}

export function mountVslPreview({ container, sourceType, sourceUrl, config = {}, mountPlayer = mountVslPlayer } = {}) {
  const resolvedSource = previewVslSource(sourceType, sourceUrl);
  if (!container || !resolvedSource) return null;
  return mountPlayer(container, { ...config, sourceType, sourceUrl: resolvedSource, autoplayMuted: false, resumeEnabled: false });
}

export function vslStatusLabel(video = {}) {
  if (!video.publishedVersionId) return 'Rascunho';
  if (video.publishedLockVersion !== undefined && video.publishedLockVersion !== null && video.lockVersion !== video.publishedLockVersion)
    return 'Alterações não publicadas';
  return 'Publicada';
}

export function vslListModel(videos = []) {
  return videos.map((video) => ({ ...video, status: vslStatusLabel(video) }));
}

export async function fetchVslForEdit({ api, projectId, videoId }) {
  return api(`/projects/${projectId}/videos/${videoId}`);
}

export function normalizeCtaUrl(value) {
  const text = String(value ?? '').trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text) ? `https://${text}` : text;
}

export function parseVslFormValues(values = {}) {
  return {
    ...values,
    ctaUrl: normalizeCtaUrl(values.ctaUrl),
    ctaSeconds: values.ctaSeconds === '' || values.ctaSeconds === null || values.ctaSeconds === undefined ? null : Number(values.ctaSeconds),
    autoplayMuted: values.autoplayMuted === true || values.autoplayMuted === 'on',
    resumeEnabled: values.resumeEnabled === true || values.resumeEnabled === 'on',
  };
}

export function vslUiAccessPolicy({ can = () => false, hasVideo = false } = {}) {
  return { canEdit: Boolean(can('video.write')), canPublish: Boolean(hasVideo && can('deployment.publish')) };
}

function field(form, name) { return form.elements.namedItem(name); }

export function createVslUI({ api, shell, getShell, toast = () => {} }) {
  const resolveShell = typeof getShell === 'function' ? getShell : () => shell;
  const currentShell = () => resolveShell();
  let current = null;
  let preview = null;
  const root = () => document.querySelector('#vsl-view');
  const list = () => document.querySelector('#vsl-list');
  const form = () => document.querySelector('#vsl-form');
  const status = () => document.querySelector('#vsl-status');
  const updatePreview = () => {
    const target = form();
    const title = document.querySelector('#vsl-preview-title');
    const meta = document.querySelector('#vsl-preview-meta');
    const playback = document.querySelector('#vsl-preview-playback');
    const cta = document.querySelector('#vsl-preview-cta');
    const poster = document.querySelector('#vsl-preview-poster');
    const previewMedia = document.querySelector('#vsl-preview-media');
    const screen = document.querySelector('.vsl-preview-screen');
    if (!target || !title || !meta || !playback || !cta || !poster || !screen) return;
    title.textContent = field(target, 'name').value.trim() || 'Sua VSL';
    const sourceType = field(target, 'sourceType').value;
    const sourceField = field(target, 'sourceUrl');
    const sourceModel = sourceInputModel(sourceType);
    const sourceLabel = document.querySelector('#vsl-source-label');
    if (sourceLabel) sourceLabel.firstChild.textContent = sourceModel.label;
    sourceField.placeholder = sourceModel.placeholder;
    sourceField.inputMode = sourceModel.inputMode;
    const aspectRatio = field(target, 'aspectRatio').value || '16:9';
    meta.textContent = `${sourceType.toUpperCase()} · ${aspectRatio}`;
    screen.style.aspectRatio = aspectRatio.replace(':', ' / ');
    const color = field(target, 'accentColor').value.trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) screen.style.setProperty('--vsl-preview-accent', color);
    playback.textContent = `${field(target, 'autoplayMuted').checked ? 'Sem som' : 'Som ativado'} · ${field(target, 'resumeEnabled').checked ? 'Retomada ativada' : 'Retomada desativada'}`;
    const ctaText = field(target, 'ctaText').value.trim() || 'a configurar';
    const ctaSeconds = field(target, 'ctaSeconds').value;
    cta.textContent = `CTA: ${ctaText} · ${ctaSeconds === '' ? 'tempo a configurar' : `após ${ctaSeconds}s`}`;
    const url = field(target, 'posterUrl').value.trim();
    poster.hidden = !url;
    if (url) poster.src = url;
    preview?.destroy?.();
    preview = mountVslPreview({
      container: previewMedia,
      sourceType,
      sourceUrl: sourceField.value,
      config: { aspectRatio, posterUrl: url, captionsUrl: field(target, 'captionsUrl').value.trim() },
    });
  };
  const showForm = (video = null) => {
    if (!video && !currentShell()?.can?.('video.write')) return;
    current = video;
    const target = form();
    if (!target) return;
    target.hidden = false;
    const preview = document.querySelector('#vsl-preview');
    if (preview) preview.hidden = false;
    const policy = vslUiAccessPolicy({ hasVideo: Boolean(video), can: (capability) => currentShell()?.can?.(capability) ?? false });
    for (const name of ['name', 'sourceUrl', 'sourceType', 'posterUrl', 'captionsUrl', 'accentColor', 'aspectRatio', 'ctaText', 'ctaUrl', 'ctaSeconds']) field(target, name).value = video?.[name] ?? ({ accentColor: '#286eea', aspectRatio: '16:9', sourceType: 'mp4' }[name] ?? '');
    field(target, 'autoplayMuted').checked = video?.autoplayMuted ?? true;
    field(target, 'resumeEnabled').checked = video?.resumeEnabled ?? true;
    updatePreview();
    for (const control of target.querySelectorAll('input, select, textarea')) control.disabled = !policy.canEdit;
    const submit = target.querySelector('[type="submit"]');
    if (submit) submit.hidden = !policy.canEdit;
    field(target, 'publish').hidden = !policy.canPublish;
    field(target, 'publish').disabled = !policy.canPublish;
  };
  const editById = async (videoId) => {
    const video = await fetchVslForEdit({ api, projectId: currentShell().state().currentProject.id, videoId });
    showForm(video);
    return video;
  };
  const render = (videos = []) => {
    const target = list();
    if (!target) return;
    target.replaceChildren();
    if (!videos.length) { target.textContent = 'Ainda não há VSLs neste projeto.'; return; }
    for (const video of vslListModel(videos)) {
      const row = document.createElement('article'); row.className = 'vsl-list-row';
      const heading = document.createElement('strong'); heading.textContent = video.name;
      const meta = document.createElement('span'); meta.textContent = `${video.sourceType.toUpperCase()} · ${video.status}`;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = currentShell()?.can?.('video.write') ? 'Editar' : 'Visualizar'; edit.onclick = () => editById(video.id);
      row.append(heading, meta, edit); target.append(row);
    }
  };
  const load = async () => {
    const projectId = currentShell()?.state?.().currentProject?.id;
    if (!projectId) return;
    const newButton = document.querySelector('#new-vsl');
    if (newButton) newButton.hidden = !currentShell()?.can?.('video.write');
    status().textContent = 'Carregando VSLs…';
    try { render(await api(`/projects/${projectId}/videos`)); status().textContent = ''; }
    catch (error) { status().textContent = error.message; }
  };
  const collect = () => {
    const target = form();
    const values = Object.fromEntries(new FormData(target));
    return parseVslFormValues({ ...values, autoplayMuted: field(target, 'autoplayMuted').checked, resumeEnabled: field(target, 'resumeEnabled').checked });
  };
  if (typeof document !== 'undefined' && form()) {
    form().addEventListener('input', updatePreview);
    form().onsubmit = async (event) => {
      event.preventDefault();
      if (!vslUiAccessPolicy({ hasVideo: Boolean(current), can: (capability) => currentShell()?.can?.(capability) ?? false }).canEdit) return;
      const projectId = currentShell().state().currentProject.id;
      const saved = current
        ? await api(`/projects/${projectId}/videos/${current.id}`, 'PUT', { ...collect(), lockVersion: current.lockVersion })
        : await api(`/projects/${projectId}/videos`, 'POST', collect());
      current = saved; toast('VSL salva.'); await load();
    };
    field(form(), 'publish').onclick = async () => {
      if (!current || !vslUiAccessPolicy({ hasVideo: true, can: (capability) => currentShell()?.can?.(capability) ?? false }).canPublish) return;
      const projectId = currentShell().state().currentProject.id;
      await api(`/projects/${projectId}/videos/${current.id}/publish`, 'POST', { lockVersion: current.lockVersion });
      toast('VSL publicada.'); await load();
    };
  }
  return { show: async () => { root().hidden = false; await load(); }, hide: () => { if (root()) root().hidden = true; }, edit: showForm, editById, reload: load };
}
