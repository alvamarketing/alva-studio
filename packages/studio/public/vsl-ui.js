import { modeloDaCurva } from './vsl-retention-ui.js';
import { estadoDoEnvio, mensagemDoEnvio, enviarArquivo } from './vsl-upload.js';

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
    const screen = document.querySelector('.vsl-preview-screen');
    if (!target || !title || !meta || !playback || !cta || !poster || !screen) return;
    title.textContent = field(target, 'name').value.trim() || 'Sua VSL';
    const aspectRatio = field(target, 'aspectRatio').value || '16:9';
    meta.textContent = `${field(target, 'sourceType').value.toUpperCase()} · ${aspectRatio}`;
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
  };
  // A curva só existe para VSL já salva: antes disso não há público nem eventos.
  const pintarRetencao = async (video) => {
    const secao = document.querySelector('#vsl-retention');
    if (!secao) return;
    secao.hidden = !video;
    if (!video) return;
    let retencao = { inicios: 0, pontos: [], maiorQueda: null, cliquesNoCta: 0, conversao: 0 };
    try {
      const projectId = currentShell().state().currentProject.id;
      const janela = new URLSearchParams({
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      });
      const todas = await api(`/projects/${projectId}/analytics/vsl-retention?${janela}`);
      retencao = todas.find((linha) => linha.publicId === video.publicId) || retencao;
    } catch {
      // Sem analytics a VSL continua editável: a curva é informação, não pré-requisito.
    }
    const modelo = modeloDaCurva(retencao);
    const grafico = document.querySelector('#vsl-retention-chart');
    if (grafico) {
      grafico.replaceChildren();
      for (const barra of modelo.barras) {
        const coluna = document.createElement('div');
        coluna.className = 'vsl-retention-bar';
        coluna.dataset.queda = String(barra.queda);
        const valor = document.createElement('strong');
        valor.textContent = String(barra.espectadores);
        const desenho = document.createElement('i');
        desenho.style.height = barra.altura;
        const rotulo = document.createElement('small');
        rotulo.textContent = barra.rotulo;
        coluna.append(valor, desenho, rotulo);
        grafico.append(coluna);
      }
      grafico.setAttribute('aria-label', `Retenção da VSL: ${modelo.resumo}`);
    }
    const resumo = document.querySelector('#vsl-retention-summary');
    if (resumo) resumo.textContent = modelo.resumo;
    const cta = document.querySelector('#vsl-retention-cta');
    if (cta) { cta.textContent = modelo.cta; cta.hidden = !modelo.cta; }
  };

  // Envio do vídeo: pedimos o endereço, o navegador manda o arquivo direto para a
  // Cloudflare e depois perguntamos, de tempos em tempos, se a conversão terminou.
  const ligarEnvioDeVideo = () => {
    const escolher = document.querySelector('#vsl-upload-input');
    const aviso = document.querySelector('#vsl-upload-status');
    if (!escolher || escolher.dataset.ligado === 'true') return;
    escolher.dataset.ligado = 'true';

    const mostrar = (estado) => {
      if (!aviso) return;
      aviso.textContent = mensagemDoEnvio(estado);
      aviso.dataset.erro = String(estado.fase === 'erro');
    };

    escolher.onchange = async () => {
      const arquivo = escolher.files?.[0];
      if (!arquivo) return;
      const projectId = currentShell().state().currentProject.id;
      escolher.disabled = true;
      try {
        mostrar({ fase: 'enviando', progresso: 0 });
        const envio = await api(`/projects/${projectId}/videos/upload-url`, 'POST', {
          nome: document.querySelector('#vsl-form')?.elements?.name?.value || arquivo.name,
        });
        await enviarArquivo({
          uploadUrl: envio.uploadUrl,
          arquivo,
          aoProgredir: (progresso) => mostrar({ fase: 'enviando', progresso }),
        });
        mostrar({ fase: 'convertendo' });
        // A conversão leva minutos; perguntar de 4 em 4 segundos é suficiente e não
        // martela a API. O teto evita esperar para sempre por um vídeo travado.
        const limite = Date.now() + 20 * 60 * 1000;
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          const estado = estadoDoEnvio(await api(`/projects/${projectId}/videos/upload-status/${envio.uid}`));
          mostrar(estado);
          if (estado.fase === 'pronto') {
            const formulario = document.querySelector('#vsl-form');
            formulario.elements.sourceUrl.value = estado.sourceUrl;
            formulario.elements.sourceType.value = estado.sourceType;
            if (estado.posterUrl && !formulario.elements.posterUrl.value)
              formulario.elements.posterUrl.value = estado.posterUrl;
            formulario.elements.sourceUrl.dispatchEvent(new Event('input', { bubbles: true }));
            break;
          }
          if (!estado.continuarConsultando) break;
          if (Date.now() > limite) {
            mostrar({ fase: 'erro', motivo: 'a conversão demorou mais que o esperado. Confira na Cloudflare.' });
            break;
          }
        }
      } catch (erro) {
        mostrar({ fase: 'erro', motivo: erro?.message || 'erro desconhecido' });
      } finally {
        escolher.disabled = false;
        escolher.value = '';
      }
    };
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
    ligarEnvioDeVideo();
    pintarRetencao(video);
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
      current = saved; showForm(saved); toast('VSL salva.'); await load();
    };
    field(form(), 'publish').onclick = async () => {
      if (!current) throw new Error('Salve a VSL antes de publicar.');
      if (!vslUiAccessPolicy({ hasVideo: true, can: (capability) => currentShell()?.can?.(capability) ?? false }).canPublish)
        throw new Error('Você não tem permissão para publicar VSLs neste projeto.');
      const projectId = currentShell().state().currentProject.id;
      await api(`/projects/${projectId}/videos/${current.id}/publish`, 'POST', { lockVersion: current.lockVersion });
      toast('VSL publicada.'); await load();
    };
  }
  return { show: async () => { root().hidden = false; await load(); }, hide: () => { if (root()) root().hidden = true; }, edit: showForm, editById, reload: load };
}
