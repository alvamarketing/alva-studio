const ALLOWED_QUERY_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id',
]);

function filteredQueryString(search) {
  const params = new URLSearchParams(search || '');
  const query = new URLSearchParams();
  for (const key of ALLOWED_QUERY_KEYS) {
    const found = params.get(key);
    if (found) query.set(key, found);
  }
  return query.toString();
}

function referrerOrigin(referrer) {
  if (!referrer) return '';
  try { return new URL(referrer).origin; } catch { return ''; }
}

// Formato plano exigido por parseCollectPayload (server/analytics-collect.mjs): allowlist fechada
// de chaves no nível raiz, sem aninhamento — trackerPublicId, event_name, url_path, url_query, referrer.
function buildPayload({ trackerPublicId, location, document: doc, eventName, eventData }) {
  const payload = { trackerPublicId, event_name: eventName, url_path: location?.pathname || '/' };
  const query = filteredQueryString(location?.search);
  if (query) payload.url_query = query;
  const referrer = referrerOrigin(doc?.referrer);
  if (referrer) payload.referrer = referrer;
  if (eventData !== undefined) payload.event_data = eventData;
  return payload;
}

export function createTracker({
  trackerPublicId,
  endpoint = '/api/public/collect',
  send = typeof fetch === 'function' ? fetch : undefined,
  location = typeof globalThis !== 'undefined' ? globalThis.location : undefined,
  navigator = typeof globalThis !== 'undefined' ? globalThis.navigator : undefined,
  document: doc = typeof globalThis !== 'undefined' ? globalThis.document : undefined,
} = {}) {
  const deliver = (payload) => {
    const body = JSON.stringify(payload);
    try {
      const beaconSent = typeof navigator?.sendBeacon === 'function' && navigator.sendBeacon(endpoint, body);
      if (beaconSent) return Promise.resolve();
    } catch { /* cai para o fallback abaixo */ }
    try {
      const result = send?.(endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
      });
      return Promise.resolve(result).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };
  return {
    pageview() {
      return deliver(buildPayload({ trackerPublicId, location, document: doc, eventName: 'pageview' }));
    },
    track(name, data) {
      return deliver(buildPayload({ trackerPublicId, location, document: doc, eventName: name, eventData: data }));
    },
  };
}

// ---- Sinais de bloco: onde a página perde gente --------------------------------------------
//
// A página publicada marca cada bloco com `data-alva-bloco="<id do nó>"` (public/page-schema.js).
// Aqui se mede, por esse id e só por ele: se o bloco entrou na tela, quanto tempo ficou à vista,
// quantos cliques em link ou botão caíram dentro dele e até onde a página foi rolada. Não se lê
// texto, valor de campo nem posição de clique: privacidade é não ter o dado, e não filtrá-lo.
//
// Nada é enviado enquanto a pessoa rola ou olha. Os números se acumulam aqui e vão num lote só
// quando a aba some (visibilitychange) ou a página fecha (pagehide) — um evento por pixel
// derrubaria o limitador do coletor e a bateria do celular. Cada lote leva só o que mudou desde
// o anterior, então somar os lotes no servidor nunca conta a mesma entrada duas vezes.
// Teto de lotes por visita: cada `visibilitychange` para "hidden" manda um.
const MAX_LOTES_POR_VISITA = 6;
const SELETOR_DE_BLOCO = '[data-alva-bloco]';
const SELETOR_DE_ACAO = 'a[href], button';
// Mesmo formato do id do nó que o coletor aceita (FORMATO_ID_DE_BLOCO em page-schema.js).
const FORMATO_ID_DE_BLOCO = /^[A-Za-z0-9_-]{1,80}$/;
const MARCOS_DE_ROLAGEM = [25, 50, 75, 100];
// Teto do que cabe num lote: a mesma conta que o coletor faz ao validar.
const MAX_BLOCOS_POR_LOTE = 100;
const MAX_SEGUNDOS_POR_BLOCO = 3600;
const MAX_CLIQUES_POR_BLOCO = 100;
// 50% do bloco à vista conta como "entrou". Em passos de 5% o navegador reavalia a cada passo.
const LIMIARES = Array.from({ length: 21 }, (_, indice) => indice / 20);

export function criarSinaisDeBloco({
  document: doc,
  window: janela,
  track,
  now = () => Date.now(),
  IntersectionObserverImpl = typeof IntersectionObserver === 'function' ? IntersectionObserver : undefined,
} = {}) {
  if (!doc || !janela || typeof track !== 'function' || typeof IntersectionObserverImpl !== 'function' || typeof doc.querySelectorAll !== 'function') return null;

  const blocos = new Map();
  const lista = [];
  const idDoElemento = new Map();
  let marcoAtingido = 0;
  const marcosNovos = [];
  let observador = null;
  let lotesEnviados = 0;

  const abaVisivel = () => doc.visibilityState !== 'hidden';
  const abrir = (bloco, agora) => { if (bloco.desde === null && bloco.noVisor && abaVisivel()) bloco.desde = agora; };
  const fechar = (bloco, agora) => {
    if (bloco.desde === null) return;
    bloco.ms += Math.max(0, agora - bloco.desde);
    bloco.desde = null;
  };

  // "À vista" é metade do bloco na tela; um bloco mais alto que duas telas nunca teria metade
  // de si visível, então vale também ocupar metade da altura da tela.
  const aVista = (entrada) => entrada.isIntersecting && (
    entrada.intersectionRatio >= 0.5
    || (entrada.rootBounds && entrada.rootBounds.height > 0 && entrada.intersectionRect.height >= entrada.rootBounds.height * 0.5)
  );

  const aoInterceptar = (entradas) => {
    const agora = now();
    for (const entrada of entradas) {
      const bloco = blocos.get(idDoElemento.get(entrada.target));
      if (!bloco) continue;
      bloco.noVisor = aVista(entrada);
      if (bloco.noVisor) {
        if (!bloco.entrou) { bloco.entrou = true; bloco.entrouNovo = true; }
        abrir(bloco, agora);
      } else fechar(bloco, agora);
    }
  };

  const medirRolagem = () => {
    const raiz = doc.documentElement;
    const total = Math.max(raiz?.scrollHeight || 0, doc.body?.scrollHeight || 0);
    const topo = Number(janela.scrollY ?? raiz?.scrollTop ?? 0);
    const alcancado = total > 0 ? ((topo + Number(janela.innerHeight || 0)) / total) * 100 : 100;
    for (const marco of MARCOS_DE_ROLAGEM) {
      // 100% com folga de um ponto: o arredondamento de subpixel não pode esconder o fim da página.
      if (marco > marcoAtingido && alcancado >= (marco === 100 ? 99 : marco)) {
        marcoAtingido = marco;
        marcosNovos.push(marco);
      }
    }
  };
  let rolagemAgendada = false;
  const agendarRolagem = () => {
    if (rolagemAgendada) return;
    rolagemAgendada = true;
    const rodar = () => { rolagemAgendada = false; medirRolagem(); };
    if (typeof janela.requestAnimationFrame === 'function') janela.requestAnimationFrame(rodar); else rodar();
  };

  // Um clique conta para o bloco em que caiu e para os blocos que o contêm: a seção "teve" o
  // clique do botão que está dentro dela.
  const aoClicar = (evento) => {
    const acao = evento?.target?.closest?.(SELETOR_DE_ACAO);
    let atual = acao?.closest?.(SELETOR_DE_BLOCO);
    while (atual) {
      const bloco = blocos.get(idDoElemento.get(atual));
      if (bloco) bloco.cliques += 1;
      atual = atual.parentElement?.closest?.(SELETOR_DE_BLOCO) ?? null;
    }
  };

  const enviar = () => {
    // O quadro de animação que mediria a última rolagem pode não ter rodado (a aba está
    // sumindo): mede de novo aqui, para o ponto mais fundo não se perder.
    medirRolagem();
    const agora = now();
    const itens = [];
    for (const bloco of lista) {
      // Intervalo ainda aberto entra na conta e recomeça de agora: o próximo lote não repete.
      if (bloco.desde !== null) { bloco.ms += Math.max(0, agora - bloco.desde); bloco.desde = agora; }
      const segundos = Math.min(MAX_SEGUNDOS_POR_BLOCO, Math.floor(bloco.ms / 1000));
      bloco.ms -= Math.floor(bloco.ms / 1000) * 1000;
      const cliques = Math.min(MAX_CLIQUES_POR_BLOCO, bloco.cliques);
      bloco.cliques = 0;
      if (!bloco.entrouNovo && !segundos && !cliques) continue;
      itens.push({ id: bloco.id, entrou: bloco.entrouNovo ? 1 : 0, segundos, cliques });
      bloco.entrouNovo = false;
    }
    const rolagem = marcosNovos.splice(0);
    if (!itens.length && !rolagem.length) return;
    // Quem alterna de aba dezenas de vezes no celular gerava um lote a cada volta. O que sobra
    // depois do teto continua somando e vai no próximo lote que couber — e, se não couber
    // nenhum, a visita já disse o que tinha de mais importante.
    if (lotesEnviados >= MAX_LOTES_POR_VISITA) return;
    for (let inicio = 0; inicio === 0 || inicio < itens.length; inicio += MAX_BLOCOS_POR_LOTE) {
      if (lotesEnviados >= MAX_LOTES_POR_VISITA) break;
      lotesEnviados += 1;
      const lote = itens.slice(inicio, inicio + MAX_BLOCOS_POR_LOTE);
      const dados = {};
      if (inicio === 0 && rolagem.length) dados.rolagem = rolagem;
      if (lote.length) dados.blocos = lote;
      track('bloco_sinais', dados);
    }
  };

  const aoMudarDeAba = () => {
    const agora = now();
    if (doc.visibilityState === 'hidden') {
      for (const bloco of lista) fechar(bloco, agora);
      enviar();
    } else for (const bloco of lista) abrir(bloco, agora);
  };

  const iniciar = () => {
    observador = new IntersectionObserverImpl(aoInterceptar, { threshold: LIMIARES });
    for (const elemento of doc.querySelectorAll(SELETOR_DE_BLOCO)) {
      const id = elemento.getAttribute('data-alva-bloco');
      if (!FORMATO_ID_DE_BLOCO.test(String(id)) || blocos.has(id)) continue;
      const bloco = { id, ms: 0, desde: null, noVisor: false, entrou: false, entrouNovo: false, cliques: 0 };
      blocos.set(id, bloco);
      lista.push(bloco);
      idDoElemento.set(elemento, id);
      observador.observe(elemento);
    }
    // Sem nenhum bloco (página publicada antes dos sinais, ou o player da VSL embutido) não há
    // o que medir: antes, mandava só a rolagem, e a página antiga aparecia no relatório com
    // barras e cartões vazios, gastando uma chamada do limitador por visita.
    if (!blocos.size) { observador.disconnect?.(); return; }
    doc.addEventListener('click', aoClicar, true);
    doc.addEventListener('visibilitychange', aoMudarDeAba);
    janela.addEventListener('pagehide', enviar);
    janela.addEventListener('scroll', agendarRolagem, { passive: true });
    janela.addEventListener('resize', agendarRolagem);
    janela.addEventListener('load', agendarRolagem);
    medirRolagem();
  };

  return { iniciar, enviar, blocosObservados: () => blocos.size };
}

export function bootTracker({ doc = typeof document !== 'undefined' ? document : undefined, win = typeof window !== 'undefined' ? window : undefined, ...trackerOptions } = {}) {
  const trackerPublicId = doc?.currentScript?.dataset?.alvaTracker;
  if (!trackerPublicId) return null;
  // Numa página publicada (domínio do cliente, na Vercel) o coletor não existe: ele mora no
  // Studio que serviu este script, e é para lá que os eventos vão.
  const host = doc?.currentScript?.dataset?.hostUrl;
  const endpoint = /^https?:\/\/[^/\s]+$/.test(String(host || '')) ? `${host}/api/public/collect` : undefined;
  const tracker = createTracker({ trackerPublicId, document: doc, ...(endpoint ? { endpoint } : {}), ...trackerOptions });
  tracker.pageview();
  // O player de VSL (public/vsl-player.js) não conhece o tracker: ele só despacha
  // CustomEvent('alva:track', {detail:{name,data}}), que borbulha até aqui. Isso mantém o
  // player utilizável fora de uma página com tracker (ex.: prévia no editor) sem enviar nada.
  doc?.addEventListener?.('alva:track', (event) => {
    const detail = event?.detail;
    if (detail?.name) tracker.track(detail.name, detail.data);
  });
  // Os sinais de bloco só existem numa página publicada com tracker: o editor, a prévia e as
  // telas do Studio não carregam este script, e sem `data-alva-tracker` nada chega até aqui.
  const sinais = criarSinaisDeBloco({ document: doc, window: win, track: (nome, dados) => tracker.track(nome, dados) });
  if (sinais) {
    const comecar = () => sinais.iniciar();
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', comecar, { once: true }); else comecar();
  }
  return tracker;
}

if (typeof document !== 'undefined') bootTracker();
