// "Onde a página perde gente": o relatório de sinais de bloco na tela de Analytics.
//
// Não há visual novo aqui. Cada linha tem o formato das listas que a tela já usa (rótulo,
// valor, barra) e as classes são as de `.rank-list`, `.list-card` e `.analytics-lists`. O
// wireframe não tem esta seção: ela precisa de aprovação do dono antes de ganhar desenho próprio.

const NUMERO = new Intl.NumberFormat('pt-BR');
const MARCOS = [25, 50, 75, 100];

const porcentagem = (valor, maior) => `${maior > 0 ? Math.max(0, Math.min(100, Math.round((valor / maior) * 100))) : 0}%`;

// Até dois minutos em segundos, depois em minutos: a coluna de valor é estreita.
function duracao(segundos) {
  const valor = Number(segundos) || 0;
  if (valor >= 120) return `${NUMERO.format(Math.round(valor / 60))} min`;
  return `${NUMERO.format(Math.round(valor * 10) / 10)} s`;
}

export function modeloDosSinais(relatorio) {
  const paginas = Array.isArray(relatorio?.paginas) ? relatorio.paginas : [];
  if (!paginas.length) {
    return {
      vazio: true,
      paginas: [],
      mensagem: 'Ainda não há sinais. Eles aparecem assim que uma página publicada, com o tracker, receber visitas.',
    };
  }
  return {
    vazio: false,
    paginas: paginas.map((pagina) => {
      const blocos = Array.isArray(pagina.blocos) ? pagina.blocos : [];
      const maiorTempo = Math.max(0, ...blocos.map((bloco) => Number(bloco.segundosMedios) || 0));
      const maiorCliques = Math.max(0, ...blocos.map((bloco) => Number(bloco.cliques) || 0));
      const nome = (bloco) => (bloco.naPagina === false ? `${bloco.rotulo} (saiu da página)` : bloco.rotulo);
      return {
        titulo: pagina.nome ? `${pagina.nome} · ${pagina.urlPath}` : pagina.urlPath,
        resumo: `${NUMERO.format(Number(pagina.visitas) || 0)} visitas medidas no período. Os blocos aparecem na ordem da página.`,
        rolagem: MARCOS.map((marco) => {
          const dado = (pagina.rolagem || []).find((linha) => linha.marco === marco) || { visitas: 0, percentual: 0 };
          return { label: `Chegou a ${marco}% da página`, value: NUMERO.format(dado.visitas), width: `${dado.percentual}%`, share: `${dado.percentual}%` };
        }),
        chegou: blocos.map((bloco) => ({ label: nome(bloco), value: NUMERO.format(bloco.entradas), width: `${bloco.alcance}%`, share: `${bloco.alcance}%` })),
        tempo: blocos.map((bloco) => ({ label: nome(bloco), value: duracao(bloco.segundosMedios), width: porcentagem(bloco.segundosMedios, maiorTempo), share: '' })),
        cliques: blocos.map((bloco) => ({ label: nome(bloco), value: NUMERO.format(bloco.cliques), width: porcentagem(bloco.cliques, maiorCliques), share: '' })),
      };
    }),
  };
}

function elemento(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

function listaDeLinhas(doc, linhas) {
  const lista = elemento(doc, 'div', 'rank-list');
  for (const linha of linhas) {
    const row = elemento(doc, 'div', 'rank-row');
    const rotulo = elemento(doc, 'span', '', linha.label);
    rotulo.title = linha.label;
    const parcela = elemento(doc, 'div', 'rank-value');
    parcela.style.setProperty('--p', linha.width);
    parcela.append(elemento(doc, 'span', '', linha.share));
    row.append(rotulo, elemento(doc, 'strong', '', linha.value), parcela);
    lista.append(row);
  }
  return lista;
}

function coluna(doc, titulo, linhas) {
  const cartao = elemento(doc, 'div', 'list-card');
  cartao.append(elemento(doc, 'h3', '', titulo), listaDeLinhas(doc, linhas));
  return cartao;
}

function cartaoVazio(doc, titulo, texto) {
  const cartao = elemento(doc, 'div', 'dashboard-empty');
  cartao.append(elemento(doc, 'h3', '', titulo), elemento(doc, 'p', '', texto));
  return cartao;
}

export function pintarSinaisDeBloco(alvo, relatorio, { doc = globalThis.document, erro = '' } = {}) {
  alvo.replaceChildren();
  if (erro) return alvo.append(cartaoVazio(doc, 'Não foi possível carregar os sinais', erro));
  const modelo = modeloDosSinais(relatorio);
  if (modelo.vazio) return alvo.append(cartaoVazio(doc, 'Nenhum sinal registrado', modelo.mensagem));
  for (const pagina of modelo.paginas) {
    const cabeca = elemento(doc, 'div', 'block-head');
    cabeca.append(elemento(doc, 'h3', '', pagina.titulo), elemento(doc, 'p', 'helper', pagina.resumo));
    const cartao = elemento(doc, 'div', 'list-card');
    cartao.append(cabeca, listaDeLinhas(doc, pagina.rolagem));
    const colunas = elemento(doc, 'div', 'analytics-lists analytics-lists-3');
    colunas.append(
      coluna(doc, 'Quem chegou ao bloco', pagina.chegou),
      coluna(doc, 'Tempo médio à vista', pagina.tempo),
      coluna(doc, 'Cliques no bloco', pagina.cliques),
    );
    alvo.append(cartao, colunas);
  }
}

// `aindaVale` é a guarda de requisição mais recente de Analytics: trocar de projeto ou de
// período no meio da chamada não pode pintar o relatório do projeto anterior.
export async function carregarSinaisDeBloco({ api, projectId, from, to, alvo, doc = globalThis.document, aindaVale = () => true }) {
  try {
    const relatorio = await api(`/projects/${projectId}/analytics/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (aindaVale()) pintarSinaisDeBloco(alvo, relatorio, { doc });
  } catch (error) {
    if (aindaVale()) pintarSinaisDeBloco(alvo, null, { doc, erro: error?.message || 'Tente de novo em instantes.' });
  }
}
