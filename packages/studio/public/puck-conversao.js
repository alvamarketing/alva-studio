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
export const CONTEINERES = new Set(['section', 'columns', 'form']);

export function alvaParaPuck(estado) {
  const converter = (node) => {
    const props = { ...(node.props ?? {}) };
    // O Puck não aceita item sem id.
    props.id = node.id || globalThis.crypto.randomUUID();
    if (node.type === 'form' && node.id) props.captureId = node.id;
    if (CONTEINERES.has(node.type)) props[SLOT] = (node.children ?? []).map(converter);
    return { type: node.type, props };
  };
  return {
    root: { props: { title: estado?.root?.title ?? '' } },
    content: (estado?.content ?? []).map(converter),
  };
}

export function puckParaAlva(dados) {
  const converter = (item) => {
    const { id, captureId, [SLOT]: filhos, ...props } = item.props ?? {};
    const identificador = item.type === 'form' ? captureId : id;
    return {
      ...(identificador ? { id: identificador } : {}),
      type: item.type,
      props,
      children: CONTEINERES.has(item.type) ? (filhos ?? []).map(converter) : [],
    };
  };
  return {
    formato: 'alva/1',
    root: { title: dados?.root?.props?.title ?? '' },
    content: (dados?.content ?? []).map(converter),
  };
}
