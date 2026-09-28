import { modeloDaCurva } from './vsl-retention-ui.js';
import { normalizarOpcoesDaVsl } from './vsl-opcoes.js';
import { cartaoDaVsl, configDaPrevia, midiaMudou } from './vsl-previa.js';
import { cssDoPlayer } from './vsl-player-css.js';
import { mountVslPlayer } from './vsl-player.js';
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

// Os campos das opções do player se chamam `opcoes.<nome>` e viram o objeto `opcoes`.
const OPCOES_MARCADAS = ['somInteligente', 'perguntarAoRetomar', 'pausarForaDaAba', 'travarAvanco', 'ocultarTempo'];
export function parseVslFormValues(values = {}) {
  const opcoes = {};
  const resto = {};
  for (const [chave, valor] of Object.entries(values)) {
    if (chave.startsWith('opcoes.')) opcoes[chave.slice(7)] = valor;
    else resto[chave] = valor;
  }
  return {
    ...resto,
    ...(Object.keys(opcoes).length ? { opcoes } : {}),
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
  // A prévia é o player de verdade, com a configuração que está no formulário: mudou a cor,
  // o texto do CTA ou o aviso de som, a prévia mostra na hora. O que ela mostra é o que a
  // pessoa que visitar a página vai ver — por isso o mesmo módulo do player publicado.
  let playerDaPrevia = null;
  let configAtual = null;
  const updatePreview = () => {
    const target = form();
    const caixa = document.querySelector('#vsl-preview-player');
    if (!target || !caixa) return;
    const config = configDaPrevia(collect());
    const proporcao = String(config.aspectRatio).replace(':', ' / ');
    caixa.style.aspectRatio = proporcao;
    document.querySelector('#vsl-preview-css').textContent = cssDoPlayer(config.accentColor);
    if (!config.sourceUrl) {
      playerDaPrevia?.destroy?.();
      playerDaPrevia = null;
      configAtual = null;
      caixa.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'vsl-preview-vazia',
        textContent: 'Envie um vídeo ou cole o endereço para ver a prévia.',
      }));
      return;
    }
    // Trocar só a cor ou o texto não pode recomeçar o vídeo do zero: nesse caso o player é
    // remontado no mesmo ponto em que estava.
    const segundo = playerDaPrevia?.video?.currentTime ?? 0;
    const recarrega = midiaMudou(configAtual, config);
    playerDaPrevia?.destroy?.();
    try {
      playerDaPrevia = mountVslPlayer(caixa, config);
      if (!recarrega && segundo > 0) playerDaPrevia.video.addEventListener('loadedmetadata', () => { playerDaPrevia.video.currentTime = segundo; }, { once: true });
    } catch { caixa.textContent = 'Não foi possível montar a prévia.'; }
    configAtual = config;
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
    const opcoes = normalizarOpcoesDaVsl(video?.opcoes);
    for (const [nome, valor] of Object.entries(opcoes)) {
      const campo = field(target, `opcoes.${nome}`);
      if (!campo) continue;
      if (campo.type === 'checkbox') campo.checked = valor; else campo.value = valor;
    }
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
    const podeEditar = Boolean(currentShell()?.can?.('video.write'));
    if (!videos.length) {
      target.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-symbols-outlined" aria-hidden="true">movie</span></div><h2>Nenhuma VSL ainda</h2><p>Crie a primeira para hospedar seu vídeo de vendas e acompanhar quem assiste.</p></div>';
      return;
    }
    target.innerHTML = vslListModel(videos).map((video) => cartaoDaVsl(video, { podeEditar })).join('');
    target.onclick = (evento) => {
      const botao = evento.target.closest('[data-vsl]');
      if (botao) editById(botao.dataset.vsl);
    };
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
    const marcadas = Object.fromEntries(OPCOES_MARCADAS.map((nome) => [`opcoes.${nome}`, Boolean(field(target, `opcoes.${nome}`)?.checked)]));
    return parseVslFormValues({ ...values, ...marcadas, autoplayMuted: field(target, 'autoplayMuted').checked, resumeEnabled: field(target, 'resumeEnabled').checked });
  };
  if (typeof document !== 'undefined' && form()) {
    // Endereço .m3u8 é HLS: o seletor acompanha, para ninguém salvar HLS como MP4.
    form().addEventListener('input', (event) => {
      if (event.target?.name === 'sourceUrl' && /\.m3u8(?:$|[?#])/i.test(event.target.value)) field(form(), 'sourceType').value = 'hls';
    });
    form().addEventListener('input', updatePreview);
    // Campo obrigatório vazio: o navegador só pintava de vermelho. Agora diz qual falta.
    let avisouCampo = false;
    form().addEventListener('invalid', (event) => {
      if (avisouCampo) return;
      avisouCampo = true;
      setTimeout(() => { avisouCampo = false; }, 300);
      const rotulo = event.target.closest('label')?.childNodes?.[0]?.textContent?.trim() || event.target.name;
      toast(`Falta preencher: ${rotulo}.`);
    }, true);
    // O erro do servidor (endereço inválido, VSL mudou em outra aba…) vira aviso na tela;
    // antes, ele se perdia e o botão parecia não fazer nada.
    const comAviso = (tarefa) => async (event) => {
      try { await tarefa(event); } catch (erro) { toast(erro?.message || 'Não foi possível salvar a VSL.'); }
    };
    form().onsubmit = comAviso(async (event) => {
      event.preventDefault();
      if (!vslUiAccessPolicy({ hasVideo: Boolean(current), can: (capability) => currentShell()?.can?.(capability) ?? false }).canEdit) return;
      const projectId = currentShell().state().currentProject.id;
      const saved = current
        ? await api(`/projects/${projectId}/videos/${current.id}`, 'PUT', { ...collect(), lockVersion: current.lockVersion })
        : await api(`/projects/${projectId}/videos`, 'POST', collect());
      current = saved; showForm(saved); toast('VSL salva.'); await load();
    });
    field(form(), 'publish').onclick = comAviso(async () => {
      if (!current) throw new Error('Salve a VSL antes de publicar.');
      if (!vslUiAccessPolicy({ hasVideo: true, can: (capability) => currentShell()?.can?.(capability) ?? false }).canPublish)
        throw new Error('Você não tem permissão para publicar VSLs neste projeto.');
      const projectId = currentShell().state().currentProject.id;
      await api(`/projects/${projectId}/videos/${current.id}/publish`, 'POST', { lockVersion: current.lockVersion });
      toast('VSL publicada.'); await load();
    });
  }
  return { show: async () => { root().hidden = false; await load(); }, hide: () => { if (root()) root().hidden = true; }, edit: showForm, editById, reload: load };
}
