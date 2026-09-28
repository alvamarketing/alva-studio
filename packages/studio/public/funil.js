// O desenho de um funil: etapas (nós) e setas. Roda no servidor (salvar, criar páginas) e
// no editor do canvas — uma validação só, para o que se desenha ser o que se salva.
import { TIPOS_DE_ETAPA, etapaViraPagina } from './funis-etapas.js';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINK = /^(?:https:\/\/|mailto:|tel:)[^\s"'<>]{1,1000}$/i;
export const LIMITE_DE_ETAPAS = 100;
const LIMITE_DE_SETAS = 200;

const falhar = (mensagem) => Object.assign(new Error(mensagem), { status: 400, statusCode: 400 });
const texto = (valor, limite) => String(valor ?? '').slice(0, limite);
const numero = (valor) => (Number.isFinite(Number(valor)) ? Math.round(Number(valor)) : 0);

export function normalizarGrafo(bruto) {
  const nosBrutos = Array.isArray(bruto?.nos) ? bruto.nos : [];
  const setasBrutas = Array.isArray(bruto?.setas) ? bruto.setas : [];
  if (nosBrutos.length > LIMITE_DE_ETAPAS) throw falhar(`Um funil tem no máximo ${LIMITE_DE_ETAPAS} etapas.`);
  if (setasBrutas.length > LIMITE_DE_SETAS) throw falhar(`Um funil tem no máximo ${LIMITE_DE_SETAS} setas.`);
  const ids = new Set();
  const nos = nosBrutos.map((no) => {
    const id = String(no?.id ?? '');
    if (!ID.test(id) || ids.has(id)) throw falhar('Etapa do funil com identificador inválido ou repetido.');
    ids.add(id);
    const k = Object.hasOwn(TIPOS_DE_ETAPA, no?.k) ? no.k : 'nota';
    return {
      id, k,
      nome: texto(no?.nome, 120),
      texto: texto(no?.texto, 2000),
      x: numero(no?.x), y: numero(no?.y),
      ...(UUID.test(String(no?.pageId ?? '')) ? { pageId: no.pageId } : {}),
      ...(LINK.test(String(no?.link ?? '')) ? { link: no.link } : {}),
    };
  });
  const setas = setasBrutas
    .filter((seta) => ids.has(seta?.de) && ids.has(seta?.para) && seta.de !== seta.para)
    .map((seta, indice) => ({ id: ID.test(String(seta?.id ?? '')) ? seta.id : `s${indice}`, de: seta.de, para: seta.para, rotulo: texto(seta?.rotulo, 60) }));
  return { nos, setas };
}

// Um modelo vira o desenho de um funil novo: as posições do modelo são compactas (a aba da
// Jornada desenha em blocos de 200px) e ganham espaço para os cartões do canvas.
export function grafoDoModelo(modelo) {
  return normalizarGrafo({
    nos: modelo.nos.map((no) => ({ ...no, x: no.x * 1.4, y: no.y * 1.6 })),
    setas: modelo.setas,
  });
}

const RECUSA = /n[ãa]o|recus|nega/i;

// Para onde levam os botões da página de uma etapa: `proxima` é a primeira saída; no upsell
// e no downsell, a saída para o downsell (ou rotulada "não") é a `alternativa`. Uma etapa
// que não é página (checkout, WhatsApp) leva ao link dela, se houver; senão, o botão fica
// com "#" para a pessoa preencher.
export function destinosDaEtapa(grafo, etapaId, enderecoDaPagina = () => '') {
  const porId = new Map(grafo.nos.map((no) => [no.id, no]));
  const saidas = grafo.setas.filter((seta) => seta.de === etapaId);
  const endereco = (seta) => {
    const alvo = porId.get(seta?.para);
    if (!alvo) return '#';
    if (etapaViraPagina(alvo.k)) return enderecoDaPagina(alvo) || '#';
    return alvo.link || '#';
  };
  const recusa = saidas.find((seta) => porId.get(seta.para)?.k === 'downsell' || RECUSA.test(seta.rotulo));
  const aceite = saidas.find((seta) => seta !== recusa) ?? (recusa && saidas.length === 1 ? null : saidas[0]);
  return { proxima: aceite ? endereco(aceite) : '#', alternativa: recusa ? endereco(recusa) : '#' };
}

// "Organizar": coloca as etapas em colunas pela ordem das setas. A coluna de uma etapa é o
// caminho mais longo desde o começo do funil; seta que volta (laço: "não fechou, volta")
// não empurra a etapa para frente. Dentro da coluna, a ordem segue a média da posição das
// etapas de onde as setas vêm, para as setas se cruzarem menos.
export const ESPACO_ENTRE_COLUNAS = 300;
export const ESPACO_ENTRE_LINHAS = 150;
export function organizarGrafo(grafo) {
  const ids = grafo.nos.map((no) => no.id);
  const entradas = new Map(ids.map((id) => [id, []]));
  const saidas = new Map(ids.map((id) => [id, []]));
  for (const seta of grafo.setas) {
    if (!entradas.has(seta.para) || !saidas.has(seta.de) || seta.de === seta.para) continue;
    saidas.get(seta.de).push(seta.para);
    entradas.get(seta.para).push(seta.de);
  }
  // Setas de retorno: as que fecham um ciclo numa busca a partir das origens.
  const retorno = new Set();
  const estado = new Map();
  const visitar = (id) => {
    estado.set(id, 'aberto');
    for (const alvo of saidas.get(id)) {
      if (estado.get(alvo) === 'aberto') retorno.add(`${id}>${alvo}`);
      else if (!estado.has(alvo)) visitar(alvo);
    }
    estado.set(id, 'fechado');
  };
  const origens = ids.filter((id) => !entradas.get(id).length);
  for (const id of [...origens, ...ids]) if (!estado.has(id)) visitar(id);
  const coluna = new Map();
  const colunaDe = (id, pilha = new Set()) => {
    if (coluna.has(id)) return coluna.get(id);
    pilha.add(id);
    const anteriores = entradas.get(id).filter((de) => !retorno.has(`${de}>${id}`) && !pilha.has(de));
    const valor = anteriores.length ? Math.max(...anteriores.map((de) => colunaDe(de, pilha) + 1)) : 0;
    pilha.delete(id);
    coluna.set(id, valor);
    return valor;
  };
  ids.forEach((id) => colunaDe(id));
  const colunas = [];
  for (const id of ids) (colunas[coluna.get(id)] ||= []).push(id);
  const linha = new Map();
  colunas.forEach((lista = [], indice) => {
    if (indice > 0) {
      const media = (id) => {
        const vindos = entradas.get(id).filter((de) => linha.has(de) && coluna.get(de) < indice);
        return vindos.length ? vindos.reduce((soma, de) => soma + linha.get(de), 0) / vindos.length : Number.MAX_SAFE_INTEGER;
      };
      lista.sort((a, b) => media(a) - media(b));
    }
    lista.forEach((id, i) => linha.set(id, i - (lista.length - 1) / 2));
  });
  return {
    ...grafo,
    nos: grafo.nos.map((no) => ({ ...no, x: coluna.get(no.id) * ESPACO_ENTRE_COLUNAS, y: Math.round(linha.get(no.id) * ESPACO_ENTRE_LINHAS) })),
  };
}
