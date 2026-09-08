// Motor da jornada: transforma o que cada visita fez no grafo de navegação do projeto.
// Cada sessão é um caminho ordenado no tempo. Páginas viram nós de página, ações (lead,
// compra, checkout, marcos de VSL) viram nós de evento no ponto em que aconteceram, e a
// passagem entre eles vira aresta. O identificador de sessão nunca sai daqui — só as
// contagens derivadas dele.

const vazio = (valor) => valor === undefined || valor === null || valor === '';
const chaveUtm = (evento) => [evento.utmSource, evento.utmMedium, evento.utmCampaign, evento.utmContent, evento.utmTerm].join(' ');
const idDoEvento = (nome) => `evento:${nome}`;

function origemDa(evento) {
  if (!vazio(evento.utmSource)) return evento.utmSource;
  if (!vazio(evento.referrerDomain)) return evento.referrerDomain;
  return 'direct';
}

export function buildJourneyGraph(events, { source = '' } = {}) {
  const lista = Array.isArray(events) ? events : [];
  const vistos = new Set();
  const porSessao = new Map();

  for (const evento of lista) {
    const acao = evento?.eventType === 'custom' && !vazio(evento?.eventName);
    if (!acao && evento?.eventType !== 'pageview') continue;
    if (vazio(evento?.sessionId) || (!acao && vazio(evento?.urlPath))) continue;
    const identidade = evento.id ?? `${evento.sessionId} ${evento.urlPath} ${evento.eventName ?? ''} ${new Date(evento.at).getTime()}`;
    if (vistos.has(identidade)) continue;
    vistos.add(identidade);
    if (!porSessao.has(evento.sessionId)) porSessao.set(evento.sessionId, []);
    porSessao.get(evento.sessionId).push(evento);
  }

  const origensDisponiveis = new Set();
  for (const eventos of porSessao.values()) {
    eventos.sort((a, b) => new Date(a.at) - new Date(b.at));
    origensDisponiveis.add(origemDa(eventos[0]));
  }
  const filtradas = [...porSessao.entries()].filter(([, eventos]) => !source || origemDa(eventos[0]) === source);

  const nos = new Map();
  const arestas = new Map();
  const atribuicoes = new Map();
  let totalPageviews = 0;
  let sessoesQueConverteram = 0;

  const no = (id, tipo, rotulo) => {
    if (!nos.has(id)) nos.set(id, { id, type: tipo, label: rotulo, pageviews: 0, sessions: 0, entries: 0, exits: 0, sessoes: new Set() });
    return nos.get(id);
  };

  for (const [sessionId, eventos] of filtradas) {
    const passos = eventos.map((evento) => (evento.eventType === 'custom'
      ? { id: idDoEvento(evento.eventName), type: 'event', label: evento.eventName }
      : { id: evento.urlPath, type: 'page', label: evento.urlPath }));

    const paginas = eventos.filter((evento) => evento.eventType === 'pageview');
    totalPageviews += paginas.length;
    if (passos.some((passo) => passo.type === 'event')) sessoesQueConverteram += 1;

    for (const passo of passos) {
      const atual = no(passo.id, passo.type, passo.label);
      if (passo.type === 'page') atual.pageviews += 1;
      atual.sessoes.add(sessionId);
    }
    if (paginas.length) {
      no(paginas[0].urlPath, 'page', paginas[0].urlPath).entries += 1;
      no(paginas.at(-1).urlPath, 'page', paginas.at(-1).urlPath).exits += 1;
    }

    for (let i = 1; i < passos.length; i += 1) {
      const origem = passos[i - 1];
      const destino = passos[i];
      if (origem.id === destino.id) continue;
      const chave = `${origem.id} ${destino.id}`;
      if (!arestas.has(chave)) arestas.set(chave, { source: origem.id, target: destino.id, transitions: 0, sessions: 0, sessoes: new Set() });
      const aresta = arestas.get(chave);
      aresta.transitions += 1;
      aresta.sessoes.add(sessionId);
    }

    const primeiro = eventos[0];
    const entrada = paginas[0]?.urlPath ?? passos[0].id;
    const chave = `${origemDa(primeiro)} ${chaveUtm(primeiro)} ${entrada}`;
    if (!atribuicoes.has(chave)) {
      atribuicoes.set(chave, {
        source: origemDa(primeiro),
        medium: vazio(primeiro.utmMedium) ? null : primeiro.utmMedium,
        campaign: vazio(primeiro.utmCampaign) ? null : primeiro.utmCampaign,
        content: vazio(primeiro.utmContent) ? null : primeiro.utmContent,
        term: vazio(primeiro.utmTerm) ? null : primeiro.utmTerm,
        entry: entrada,
        sessions: 0,
      });
    }
    atribuicoes.get(chave).sessions += 1;
  }

  const nodes = [...nos.values()]
    .map(({ sessoes, ...no }) => ({ ...no, sessions: sessoes.size }))
    .sort((a, b) => b.pageviews - a.pageviews || b.sessions - a.sessions || a.id.localeCompare(b.id));
  const edges = [...arestas.values()]
    .map(({ sessoes, ...aresta }) => ({ ...aresta, sessions: sessoes.size }))
    .sort((a, b) => b.transitions - a.transitions || a.source.localeCompare(b.source));
  const attributions = [...atribuicoes.values()].sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source));
  const sessoes = filtradas.length;

  return {
    nodes,
    edges,
    attributions,
    sources: [...origensDisponiveis].sort(),
    totals: {
      pageviews: totalPageviews,
      sessions: sessoes,
      pages: nodes.filter((no) => no.type === 'page').length,
      conversions: sessoesQueConverteram,
      conversionRate: sessoes ? Math.round((sessoesQueConverteram / sessoes) * 100) : 0,
    },
  };
}
