// A aba Funis do projeto: os funis já desenhados e a galeria de modelos para começar um.
// Abrir ou criar leva ao canvas (/funil.html), que é onde o funil é desenhado.
import { modelosDeFunil } from './funis-modelos.js';
import { etapaViraPagina } from './funis-etapas.js';

const escapar = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enderecoDoFunil = (projectId, funnelId) => `/funil.html?projeto=${encodeURIComponent(projectId)}&funil=${encodeURIComponent(funnelId)}`;

function cartaoDoModelo(modelo) {
  const paginas = modelo.nos.filter((no) => etapaViraPagina(no.k)).length;
  return `<button type="button" class="funil-modelo" data-modelo="${escapar(modelo.id)}">
    <span class="funil-modelo-tipo">${escapar(modelo.tipo)}</span>
    <strong>${escapar(modelo.nome)}</strong>
    <span class="funil-modelo-para">${escapar(modelo.para)}</span>
    <small>${modelo.nos.length} etapas · ${paginas} ${paginas === 1 ? 'página' : 'páginas'}</small>
  </button>`;
}

export async function renderFunis({ root, api, projectId, podeEscrever, onError = () => {} }) {
  const lista = root.querySelector('#funnels-list');
  const galeria = root.querySelector('#funnels-models');
  lista.innerHTML = '<p class="empty-state">Carregando funis…</p>';
  galeria.innerHTML = `<button type="button" class="funil-modelo funil-em-branco" data-modelo=""><span class="material-symbols-outlined" aria-hidden="true">add</span><strong>Funil em branco</strong><span class="funil-modelo-para">Comece com um anúncio e uma página, e desenhe o resto.</span></button>`
    + [...modelosDeFunil].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome)).map(cartaoDoModelo).join('');
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
      ? funis.map((funil) => {
        const paginas = funil.graph.nos.filter((no) => etapaViraPagina(no.k));
        const criadas = paginas.filter((no) => no.pageId).length;
        return `<a class="funil-linha" href="${enderecoDoFunil(projectId, funil.id)}">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          <strong>${escapar(funil.name)}</strong>
          <small>${funil.graph.nos.length} etapas · ${criadas} de ${paginas.length} páginas criadas</small>
        </a>`;
      }).join('')
      : `<p class="empty-state">Nenhum funil ainda. ${podeEscrever ? 'Escolha um modelo abaixo ou comece em branco.' : ''}</p>`;
  } catch (erro) {
    lista.innerHTML = '<p class="empty-state">Não foi possível carregar os funis.</p>';
    onError(erro);
  }
}
