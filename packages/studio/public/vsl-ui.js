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

export function parseVslFormValues(values = {}) {
  return {
    ...values,
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
  const root = () => document.querySelector('#vsl-view');
  const list = () => document.querySelector('#vsl-list');
  const form = () => document.querySelector('#vsl-form');
  const status = () => document.querySelector('#vsl-status');
  const showForm = (video = null) => {
    if (!video && !currentShell()?.can?.('video.write')) return;
    current = video;
    const target = form();
    if (!target) return;
    target.hidden = false;
    const policy = vslUiAccessPolicy({ hasVideo: Boolean(video), can: (capability) => currentShell()?.can?.(capability) ?? false });
    for (const name of ['name', 'sourceUrl', 'sourceType', 'posterUrl', 'captionsUrl', 'accentColor', 'aspectRatio', 'ctaText', 'ctaUrl', 'ctaSeconds']) field(target, name).value = video?.[name] ?? ({ accentColor: '#286eea', aspectRatio: '16:9', sourceType: 'mp4' }[name] ?? '');
    field(target, 'autoplayMuted').checked = video?.autoplayMuted ?? true;
    field(target, 'resumeEnabled').checked = video?.resumeEnabled ?? true;
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
