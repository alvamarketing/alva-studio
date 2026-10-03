// As âncoras das seções, lidas do que está no editor agora (formato do Puck): para o campo
// de link do botão oferecer as que existem, e o campo da âncora avisar quando uma repete.
import { SLOT } from '../public/puck-conversao.js';
import { normalizarAncora } from '../public/page-schema.js';

const secoes = (dados) => (Array.isArray(dados?.root?.props?.[SLOT]) ? dados.root.props[SLOT] : []);
const ancoraDe = (item) => normalizarAncora(item?.props?.ancora);

export function ancorasDaPagina(dados) {
  return [...new Set(secoes(dados).map(ancoraDe).filter(Boolean))];
}

export function quantasVezesAAncoraAparece(dados, ancora) {
  const procurada = normalizarAncora(ancora);
  return procurada ? secoes(dados).filter((item) => ancoraDe(item) === procurada).length : 0;
}
