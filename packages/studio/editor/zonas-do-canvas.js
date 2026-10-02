// A geometria das zonas de soltar no canvas do editor (só no iframe do Puck; a página
// publicada não carrega isto).
//
// O Puck 0.23 decide onde um bloco entra, ao arrastar entre zonas ou da biblioteca, pelo
// fluxo que lê no CSS da zona: flex em linha é horizontal, e a linha de inserção vira um
// traço vertical na borda esquerda ou direita do bloco — quem decide antes ou depois é a
// posição horizontal do mouse (resolveZoneFlow e getNearestGapIndex, em
// @puckeditor/core/dist/chunk-55V3NZVF.mjs). As nossas zonas são flex em linha com quebra
// só para aceitar larguras parciais; com todo bloco na linha inteira, a zona é uma pilha,
// e aqui ela é declarada coluna — a linha de inserção passa a ficar entre um bloco e outro.
//
// O Puck também dá height:100% a toda zona. Numa zona flex com quebra, a sobra de altura é
// dividida entre as linhas: as seções esticavam até o fim do canvas e os blocos ficavam
// espaçados como a página publicada não fica. As zonas internas medem o que o conteúdo mede.
//
// Medindo o conteúdo, a zona da seção acaba no último bloco, e soltar "logo abaixo dele"
// caía no respiro da seção, fora de qualquer zona. A zona avança 32px (o menor respiro) por
// cima e por baixo, com margem negativa do mesmo tamanho: nada muda de lugar na tela.
const LARGURAS_PARCIAIS = ['3-4', '2-3', '1-2', '1-3', '1-4'].map((l) => `>.alva-l-${l}`).join(',');

export const ZONAS_DO_CANVAS = [
  '.alva-pagina[data-puck-dropzone]{flex-direction:column;flex-wrap:nowrap}',
  '.alva-pagina[data-puck-dropzone]>[data-puck-component]{flex:none;width:100%}',
  '.alva-conteudo[data-puck-dropzone],.alva-colunas[data-puck-dropzone],.alva-linha[data-puck-dropzone]{height:auto}',
  '.alva-pagina>.alva-secao>.alva-conteudo[data-puck-dropzone]{padding-top:32px;padding-bottom:32px;margin-top:-32px;margin-bottom:-32px}',
  `.alva-conteudo[data-puck-dropzone]:not(:has(${LARGURAS_PARCIAIS})){flex-direction:column;flex-wrap:nowrap;justify-content:flex-start}`,
  `.alva-conteudo[data-puck-dropzone]:not(:has(${LARGURAS_PARCIAIS}))>[data-puck-component]{flex:none;width:100%}`,
].join('\n');
