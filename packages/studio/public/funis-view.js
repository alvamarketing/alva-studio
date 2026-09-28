// A aba Funis do projeto: os funis já desenhados e a galeria de modelos para começar um.
// Abrir ou criar leva ao canvas (/funil.html), que é onde o funil é desenhado.
//
// Cada cartão mostra a miniatura do desenho (etapas e setas, na cor do grupo de cada
// etapa), como na aba Funis da Jornada da Alva: dá para reconhecer o funil antes de abrir.
import { modelosDeFunil } from './funis-modelos.js';
import { etapaViraPagina, tipoDaEtapa } from './funis-etapas.js';

const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enderecoDoFunil = (projectId, funnelId) => `/funil.html?projeto=${encodeURIComponent(projectId)}&funil=${encodeURIComponent(funnelId)}`;
const semAcento = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// O desenho em miniatura: cada etapa vira um retângulo e cada seta, uma linha da saída de
// uma etapa até a entrada da outra. As coordenadas são as do próprio funil.
const LARGURA = 150;
const ALTURA = 70;
export function miniaturaDoFunil({ nos = [], setas = [] }) {
  if (!nos.length) return '<svg class="funil-mini" viewBox="0 0 10 10" aria-hidden="true"></svg>';
  const xs = nos.map((no) => Number(no.x) || 0);
  const ys = nos.map((no) => Number(no.y) || 0);
  const margem = 24;
  const x0 = Math.min(...xs) - margem;
  const y0 = Math.min(...ys) - margem;
  const largura = Math.max(...xs) + LARGURA + margem - x0;
  const altura = Math.max(...ys) + ALTURA + margem - y0;
  const porId = new Map(nos.map((no) => [no.id, no]));
  const linhas = setas.map((seta) => {
    const de = porId.get(seta.de);
    const para = porId.get(seta.para);
    if (!de || !para) return '';
    return `<line x1="${de.x + LARGURA}" y1="${de.y + ALTURA / 2}" x2="${para.x}" y2="${para.y + ALTURA / 2}"/>`;
  }).join('');
  const caixas = nos.map((no) => `<rect class="funil-mini-${tipoDaEtapa(no.k).grupo}" x="${no.x}" y="${no.y}" width="${LARGURA}" height="${ALTURA}" rx="10"/>`).join('');
  return `<svg class="funil-mini" viewBox="${x0} ${y0} ${largura} ${altura}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="funil-mini-setas">${linhas}</g>${caixas}</svg>`;
}

function cartaoDoModelo(modelo) {
  const paginas = modelo.nos.filter((no) => etapaViraPagina(no.k)).length;
  return `<button type="button" class="funil-modelo" data-modelo="${escapar(modelo.id)}" data-tipo="${escapar(modelo.tipo)}" data-busca="${escapar(semAcento(`${modelo.nome} ${modelo.tipo} ${modelo.para} ${(modelo.tags || []).join(' ')}`))}">
    <span class="funil-modelo-previa">${miniaturaDoFunil(modelo)}</span>
    <span class="funil-modelo-tipo">${escapar(modelo.tipo)}</span>
    <strong>${escapar(modelo.nome)}</strong>
    <span class="funil-modelo-para">${escapar(modelo.para)}</span>
    <small>${modelo.nos.length} etapas · ${paginas} ${paginas === 1 ? 'página' : 'páginas'}</small>
  </button>`;
}

function cartaoDoFunil(projectId, funil) {
  const paginas = funil.graph.nos.filter((no) => etapaViraPagina(no.k));
  const criadas = paginas.filter((no) => no.pageId).length;
  return `<a class="funil-modelo funil-do-projeto" href="${enderecoDoFunil(projectId, funil.id)}" data-busca="${escapar(semAcento(funil.name))}">
    <span class="funil-modelo-previa">${miniaturaDoFunil(funil.graph)}</span>
    <strong>${escapar(funil.name)}</strong>
    <small>${funil.graph.nos.length} etapas · ${criadas} de ${paginas.length} páginas criadas</small>
  </a>`;
}

// Só entram na galeria os modelos com ao menos uma página do Studio: um funil feito só de
// etapas que acontecem fora (agenda, WhatsApp, reunião) serve para entender, não para
// trabalhar aqui. Os outros continuam em funis-modelos.js para quando houver integração.
export const modelosDaGaleria = modelosDeFunil.filter((modelo) => modelo.nos.some((no) => etapaViraPagina(no.k)));

export async function renderFunis({ root, api, projectId, podeEscrever, onError = () => {} }) {
  const lista = root.querySelector('#funnels-list');
  const galeria = root.querySelector('#funnels-models');
  const filtros = root.querySelector('#funnels-filters');
  const tipos = [...new Set(modelosDaGaleria.map((modelo) => modelo.tipo))].sort((a, b) => a.localeCompare(b));
  let tipoAtivo = '';
  let busca = '';

  filtros.innerHTML = `<label class="funnels-busca"><span class="material-symbols-outlined" aria-hidden="true">search</span><input type="search" placeholder="Buscar funil ou modelo" aria-label="Buscar funil ou modelo"></label>`
    + `<div class="funnels-tipos" role="group" aria-label="Filtrar modelos por tipo"><button type="button" class="funnels-tipo" aria-pressed="true" data-tipo="">Todos</button>`
    + tipos.map((tipo) => `<button type="button" class="funnels-tipo" aria-pressed="false" data-tipo="${escapar(tipo)}">${escapar(tipo)} <b>${modelosDaGaleria.filter((m) => m.tipo === tipo).length}</b></button>`).join('')
    + '</div>';

  const aplicar = () => {
    const termo = semAcento(busca.trim());
    for (const cartao of root.querySelectorAll('.funil-modelo[data-busca]')) {
      const tipoOk = !tipoAtivo || !cartao.dataset.tipo || cartao.dataset.tipo === tipoAtivo;
      const buscaOk = !termo || cartao.dataset.busca.includes(termo);
      cartao.hidden = !(tipoOk && buscaOk);
    }
    const vazio = root.querySelector('#funnels-models-vazio');
    if (vazio) vazio.hidden = [...galeria.querySelectorAll('.funil-modelo[data-tipo]')].some((cartao) => !cartao.hidden);
  };
  filtros.querySelector('input').oninput = (evento) => { busca = evento.target.value; aplicar(); };
  filtros.querySelector('.funnels-tipos').onclick = (evento) => {
    const botao = evento.target.closest('[data-tipo]');
    if (!botao) return;
    tipoAtivo = botao.dataset.tipo;
    for (const item of filtros.querySelectorAll('.funnels-tipo')) item.setAttribute('aria-pressed', String(item === botao));
    aplicar();
  };

  lista.innerHTML = '<p class="empty-state">Carregando funis…</p>';
  galeria.innerHTML = `<button type="button" class="funil-modelo funil-em-branco" data-modelo=""><span class="funil-modelo-previa"><span class="material-symbols-outlined" aria-hidden="true">add</span></span><strong>Funil em branco</strong><span class="funil-modelo-para">Comece com um anúncio e uma página, e desenhe o resto.</span></button>`
    + [...modelosDaGaleria].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome)).map(cartaoDoModelo).join('')
    + '<p id="funnels-models-vazio" class="empty-state" hidden>Nenhum modelo com esse filtro.</p>';
  galeria.hidden = !podeEscrever;
  root.querySelector('#funnels-models-title').hidden = !podeEscrever;

  galeria.onclick = async (evento) => {
    const cartao = evento.target.closest('[data-modelo]');
    if (!cartao || cartao.disabled) return;
    cartao.disabled = true;
    try {
      const modelId = cartao.dataset.modelo || undefined;
      const funil = await api(`/projects/${projectId}/funnels`, 'POST', { modelId });
      location.href = enderecoDoFunil(projectId, funil.id);
    } catch (erro) {
      cartao.disabled = false;
      onError(erro);
    }
  };

  try {
    const funis = await api(`/projects/${projectId}/funnels`);
    lista.innerHTML = funis.length
      ? funis.map((funil) => cartaoDoFunil(projectId, funil)).join('')
      : `<p class="empty-state">Nenhum funil ainda. ${podeEscrever ? 'Escolha um modelo abaixo ou comece em branco.' : ''}</p>`;
    lista.classList.toggle('funnels-models', funis.length > 0);
  } catch (erro) {
    lista.innerHTML = '<p class="empty-state">Não foi possível carregar os funis.</p>';
    onError(erro);
  }
  aplicar();
}
