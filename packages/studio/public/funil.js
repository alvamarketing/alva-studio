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
