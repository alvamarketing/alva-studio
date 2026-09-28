// O esquema do Alva de um lado, o formato do Puck do outro.
//
// O esquema é a fonte da verdade: é ele que o servidor salva, desenha e publica. O Puck é
// só o editor, e guarda os filhos de um componente dentro das props dele (slots). Esta é a
// única ponte entre os dois.
//
// O formulário carrega o identificador da captura (`captureId`) como prop: o Puck dá ao
// componente um id próprio, que não serve à publicação, e o da captura precisa ser um UUID
// estável — é por ele que a resposta publicada diz de qual formulário veio.

export const SLOT = 'itens';
import { TIPOS_DE_SECAO_PRONTA } from './secoes-prontas.js';

export const CONTEINERES = new Set(['section', 'etapa', 'row', 'columns', 'form', ...TIPOS_DE_SECAO_PRONTA]);
const UUID_NO_FIM = /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function alvaParaPuck(estado) {
  const converter = (node) => {
    const props = { ...(node.props ?? {}) };
    // O Puck não aceita item sem id.
    props.id = node.id || globalThis.crypto.randomUUID();
    if (node.type === 'form' && node.id) props.captureId = node.id;
    if (CONTEINERES.has(node.type)) props[SLOT] = (node.children ?? []).map(converter);
    return { type: node.type, props };
  };
  // As seções moram num slot da raiz: é como o editor restringe a página a receber só
  // seções — bloco solto na raiz ficava sem espaçamento e sem layout.
  return {
    root: { props: { ...(estado?.root ?? {}), title: estado?.root?.title ?? '', [SLOT]: (estado?.content ?? []).map(converter) } },
    content: [],
  };
}

export function puckParaAlva(dados) {
  const converter = (item) => {
    const { id, captureId, [SLOT]: filhos, ...props } = item.props ?? {};
    // O formulário que entrou dentro de uma seção pronta não passou pelo resolveData e
    // chega sem captureId: o UUID do fim do id que o Puck deu serve, e é estável entre
    // salvamentos — sem isso, cada salvamento trocaria a captura.
    const identificador = item.type === 'form' ? captureId || String(id ?? '').match(UUID_NO_FIM)?.[1] : id;
    // Seção pronta é uma seção: o tipo dela só existe na biblioteca do editor.
    const tipo = TIPOS_DE_SECAO_PRONTA.has(item.type) ? 'section' : item.type;
    return {
      ...(identificador ? { id: identificador } : {}),
      type: tipo,
      props,
      children: CONTEINERES.has(item.type) ? (filhos ?? []).map(converter) : [],
    };
  };
  return {
    formato: 'alva/1',
    // O quiz leva o tipo e a captura na raiz; a landing, só o título.
    root: { title: dados?.root?.props?.title ?? '', ...(dados?.root?.props?.tipo === 'quiz' ? { tipo: 'quiz', captureId: dados.root.props.captureId } : {}) },
    content: [...(dados?.root?.props?.[SLOT] ?? []), ...(dados?.content ?? [])].map(converter),
  };
}
