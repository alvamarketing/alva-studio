// A prévia da tela de configuração é o player de verdade, com o que está no formulário:
// quem muda o texto do CTA, a cor ou o aviso de som vê o resultado ali, do jeito que a
// pessoa que visitar a página vai ver. Antes era um cartão com um resumo em texto, que não
// mostrava nada do que estava sendo configurado.
import { normalizarOpcoesDaVsl } from './vsl-opcoes.js';

const texto = (valor) => String(valor ?? '').trim();

export function configDaPrevia(valores = {}) {
  const ctaText = texto(valores.ctaText);
  const segundos = Number(valores.ctaSeconds);
  return {
    publicId: 'previa',
    versionNumber: 0,
    sourceUrl: texto(valores.sourceUrl),
    sourceType: texto(valores.sourceType) || 'mp4',
    posterUrl: texto(valores.posterUrl),
    captionsUrl: texto(valores.captionsUrl),
    accentColor: texto(valores.accentColor) || '#286eea',
    aspectRatio: texto(valores.aspectRatio) || '16:9',
    autoplayMuted: valores.autoplayMuted !== false,
    resumeEnabled: valores.resumeEnabled !== false,
    ctaText,
    // Sem destino ainda: o botão aparece na prévia mesmo assim, sem levar a lugar nenhum.
    ctaUrl: ctaText ? (texto(valores.ctaUrl) || '#') : '',
    ctaSeconds: Number.isFinite(segundos) && texto(valores.ctaSeconds) !== '' ? segundos : null,
    opcoes: normalizarOpcoesDaVsl(valores.opcoes),
    // O CTA aparece desde o primeiro quadro: esperar o tempo configurado para vê-lo na
    // prévia seria esconder justamente o que se está configurando.
    mostrarCtaSempre: true,
    // A retomada não escreve no navegador de quem edita: a prévia não é uma visita.
    storage: null,
  };
}

// Recarregar o vídeo a cada tecla digitada no nome ou no CTA piscaria a prévia inteira. Só
// mídia, capa e legenda pedem o vídeo de novo; o resto o player redesenha.
const DA_MIDIA = ['sourceUrl', 'sourceType', 'posterUrl', 'captionsUrl'];
export function midiaMudou(anterior, atual) {
  if (!anterior || !atual) return true;
  return DA_MIDIA.some((campo) => anterior[campo] !== atual[campo]);
}

const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const IMAGEM = /^https:\/\/[^\s"'<>]{1,1000}$/i;

// O mesmo cartão das páginas e dos quizzes (.page-card), com a capa do vídeo no lugar da
// miniatura: quem olha a lista reconhece a VSL pela imagem, não por uma linha de texto.
export function cartaoDaVsl(vsl = {}, { podeEditar = false } = {}) {
  const capa = IMAGEM.test(String(vsl.posterUrl ?? '')) ? String(vsl.posterUrl) : '';
  const miniatura = capa
    ? `<img src="${escapar(capa)}" alt="" loading="lazy">`
    : '<div class="blank"><span class="material-symbols-outlined" aria-hidden="true">movie</span></div>';
  const acoes = podeEditar
    ? `<button type="button" class="card-action alva-tooltip edit" data-vsl="${escapar(vsl.id)}" data-tooltip="Editar" aria-label="Editar ${escapar(vsl.name)}"><span class="material-symbols-outlined" aria-hidden="true">edit</span></button>`
    : `<button type="button" class="card-action-texto" data-vsl="${escapar(vsl.id)}">Visualizar</button>`;
  return `<article class="page-card vsl-card">`
    + `<div class="thumbnail">${miniatura}</div>`
    + `<div class="card-content"><div class="card-top"><h3>${escapar(vsl.name)}</h3>`
    + `<span class="badge">${escapar(vsl.status)}</span></div>`
    + `<p>${escapar(String(vsl.sourceType ?? '').toUpperCase())} · ${escapar(vsl.aspectRatio ?? '16:9')}</p>`
    + `<div class="card-actions">${acoes}</div></div></article>`;
}
