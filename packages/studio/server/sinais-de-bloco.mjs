// O relatório de sinais de bloco: junta o que o banco agregou (por página e por id de bloco)
// com a estrutura da página salva, para a tela dizer "este título, este botão" em vez de um id.
//
// O banco só conhece ids. Quem dá nome a eles é o esquema da página (public/page-schema.js),
// lido aqui só para o dono do projeto — o visitante nunca manda texto, e o rótulo sai do que
// o próprio dono escreveu.

const NOMES = Object.freeze({
  section: 'Seção', etapa: 'Etapa', row: 'Linha', columns: 'Colunas', heading: 'Título', text: 'Texto',
  button: 'Botão', icon: 'Ícone', image: 'Imagem', video: 'Vídeo', vsl: 'VSL', form: 'Formulário', escolha: 'Pergunta',
});
const LIMITE_DO_TRECHO = 50;

function trecho(valor) {
  const texto = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return texto.length > LIMITE_DO_TRECHO ? `${texto.slice(0, LIMITE_DO_TRECHO - 1)}…` : texto;
}

// O texto que identifica o bloco para quem o escreveu: o do próprio bloco ou, numa seção, o
// do primeiro título dentro dela.
function textoDoBloco(node) {
  const { props = {} } = node;
  if (node.type === 'heading' || node.type === 'text' || node.type === 'button') return trecho(props.text);
  if (node.type === 'escolha') return trecho(props.pergunta);
  if (node.type === 'image') return trecho(props.alt);
  if (node.type === 'section' || node.type === 'etapa') {
    const titulo = primeiroTitulo(node);
    return titulo ? trecho(titulo.props?.text) : '';
  }
  return '';
}

function primeiroTitulo(node) {
  for (const filho of Array.isArray(node.children) ? node.children : []) {
    if (filho?.type === 'heading') return filho;
    const dentro = primeiroTitulo(filho ?? {});
    if (dentro) return dentro;
  }
  return null;
}

// Os blocos que a página publicada marca com data-alva-bloco, na ordem em que aparecem.
// O campo de captura não é bloco: nada do que a pessoa digita é medido.
export function blocosDaPagina(estado) {
  const blocos = [];
  const percorrer = (lista, profundidade) => {
    if (!Array.isArray(lista) || profundidade > 40) return;
    for (const node of lista) {
      if (!node || typeof node !== 'object' || node.type === 'field') continue;
      if (node.id) {
        const tipo = NOMES[node.type] ?? String(node.type ?? 'Bloco');
        const texto = textoDoBloco(node);
        blocos.push({ id: String(node.id), tipo, rotulo: texto ? `${tipo} · ${texto}` : tipo });
      }
      percorrer(node.children, profundidade + 1);
    }
  };
  percorrer(estado?.content, 0);
  return blocos;
}

// A rota da página e o caminho que o navegador reporta diferem em caixa e barra final.
const chaveDoCaminho = (caminho) => {
  const limpo = String(caminho ?? '').toLowerCase().replace(/\/+$/, '');
  return limpo || '/';
};

const porcentagem = (parte, total) => (total > 0 ? Math.min(100, Math.round((parte / total) * 100)) : 0);

// O tracker público é conhecido por qualquer um: dá para forjar ids válidos e caminhos
// arbitrários. Estes tetos mantêm a resposta pequena mesmo assim (conferência de 02/10/2026).
const MAX_PAGINAS = 50;
const MAX_ORFAOS_POR_PAGINA = 20;

export function montarRelatorioDeSinais({ visitas = [], blocos = [], rolagem = [], paginas = [] } = {}) {
  const dePagina = new Map(paginas.map((pagina) => [chaveDoCaminho(pagina.route), pagina]));
  // Só entram as páginas que enviaram sinais: o pageview de uma VSL avulsa não tem bloco a mostrar.
  const caminhos = new Set([...blocos.map((linha) => linha.urlPath), ...rolagem.map((linha) => linha.urlPath)]);

  const relatorio = [...caminhos].map((urlPath) => {
    const pagina = dePagina.get(chaveDoCaminho(urlPath)) ?? null;
    const doCaminho = blocos.filter((linha) => linha.urlPath === urlPath);
    const marcos = rolagem.filter((linha) => linha.urlPath === urlPath);
    const pageviews = visitas.find((linha) => linha.urlPath === urlPath)?.total ?? 0;
    // A visita pode ter sido medida sem o pageview ter entrado na janela (ou o contrário):
    // o denominador é o maior dos números que a própria medição já viu, para a conta nunca
    // passar de 100%.
    const total = Math.max(pageviews, ...doCaminho.map((linha) => linha.entradas), ...marcos.map((linha) => linha.total));

    const conhecidos = pagina ? blocosDaPagina(pagina.editorState) : [];
    const agregadoPorId = new Map(doCaminho.map((linha) => [linha.blockId, linha]));
    const montar = (id, descricao, naPagina) => {
      const linha = agregadoPorId.get(id);
      const entradas = linha?.entradas ?? 0;
      return {
        id,
        tipo: descricao?.tipo ?? 'Bloco',
        rotulo: descricao?.rotulo ?? `Bloco ${id.slice(0, 8)}`,
        naPagina,
        entradas,
        alcance: porcentagem(entradas, total),
        segundosMedios: entradas ? Math.round((linha.segundos / entradas) * 10) / 10 : 0,
        cliques: linha?.cliques ?? 0,
      };
    };
    // Na ordem da página. Quem tem dado mas saiu da página (bloco apagado ou refeito) vem depois.
    const naOrdem = conhecidos.filter((bloco) => agregadoPorId.has(bloco.id)).map((bloco) => montar(bloco.id, bloco, true));
    const sabidos = new Set(conhecidos.map((bloco) => bloco.id));
    const orfaos = doCaminho
      .filter((linha) => !sabidos.has(linha.blockId))
      .sort((a, b) => b.entradas - a.entradas || a.blockId.localeCompare(b.blockId))
      .slice(0, MAX_ORFAOS_POR_PAGINA)
      .map((linha) => montar(linha.blockId, null, false));

    const doMarco = (marco) => marcos.find((linha) => linha.marco === marco)?.total ?? 0;
    return {
      urlPath,
      nome: pagina?.name ?? null,
      visitas: total,
      // Mandou rolagem e nenhum bloco: foi publicada antes dos sinais. A tela explica o que fazer.
      semBlocos: doCaminho.length === 0,
      rolagem: [25, 50, 75, 100].map((marco) => ({ marco, visitas: doMarco(marco), percentual: porcentagem(doMarco(marco), total) })),
      blocos: [...naOrdem, ...orfaos],
    };
  });
  const maisVisitadas = relatorio.sort((a, b) => b.visitas - a.visitas || a.urlPath.localeCompare(b.urlPath));
  return { paginas: maisVisitadas.slice(0, MAX_PAGINAS) };
}
