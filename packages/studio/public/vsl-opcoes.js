// As opções do player da VSL que vieram do que o VTurb faz e serve ao nosso objetivo:
// som inteligente, cor e subtexto do CTA, pergunta ao retomar, pausa fora da aba, trava de
// avanço e tempo oculto. Um lugar só: o servidor valida com isto, o formulário do Studio
// lê os padrões daqui e o player recebe o resultado.
export const OPCOES_PADRAO = Object.freeze({
  // O vídeo começa mudo (regra dos navegadores) com um aviso grande por cima; o toque no
  // aviso liga o som e recomeça do zero, para a pessoa não perder o começo.
  somInteligente: true,
  textoDoSom: 'Toque para ativar o som',
  // Vazio: a cor da VSL.
  ctaCor: '',
  ctaCorDoTexto: '#ffffff',
  ctaSubtexto: '',
  // Quem volta vê "Continuar de onde parou" e "Recomeçar", em vez de cair no meio sem aviso.
  perguntarAoRetomar: true,
  pausarForaDaAba: true,
  // A pessoa volta na barra, mas não pula para frente do que já assistiu.
  travarAvanco: false,
  ocultarTempo: false,
});

const COR = /^#[0-9a-f]{6}$/i;
const falhar = (mensagem) => Object.assign(new Error(mensagem), { status: 400, statusCode: 400 });
const booleano = (valor, padrao) => (typeof valor === 'boolean' ? valor : padrao);

function texto(valor, limite, padrao, mensagem) {
  if (valor === undefined || valor === null) return padrao;
  const limpo = String(valor).replace(/[\r\n]+/g, ' ').trim();
  if (limpo.length > limite) throw falhar(mensagem);
  return limpo || padrao;
}

function cor(valor, padrao, mensagem) {
  if (valor === undefined || valor === null) return padrao;
  const limpo = String(valor).trim();
  if (!limpo) return '';
  if (!COR.test(limpo)) throw falhar(mensagem);
  return limpo.toLowerCase();
}

export function normalizarOpcoesDaVsl(bruto) {
  const entrada = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  return {
    somInteligente: booleano(entrada.somInteligente, OPCOES_PADRAO.somInteligente),
    textoDoSom: texto(entrada.textoDoSom, 80, OPCOES_PADRAO.textoDoSom, 'O aviso de som tem no máximo 80 caracteres.'),
    ctaCor: cor(entrada.ctaCor, OPCOES_PADRAO.ctaCor, 'A cor do CTA precisa ser hexadecimal, como #286eea.'),
    ctaCorDoTexto: cor(entrada.ctaCorDoTexto, OPCOES_PADRAO.ctaCorDoTexto, 'A cor do texto do CTA precisa ser hexadecimal, como #ffffff.') || OPCOES_PADRAO.ctaCorDoTexto,
    ctaSubtexto: texto(entrada.ctaSubtexto, 120, OPCOES_PADRAO.ctaSubtexto, 'O subtexto do CTA tem no máximo 120 caracteres.'),
    perguntarAoRetomar: booleano(entrada.perguntarAoRetomar, OPCOES_PADRAO.perguntarAoRetomar),
    pausarForaDaAba: booleano(entrada.pausarForaDaAba, OPCOES_PADRAO.pausarForaDaAba),
    travarAvanco: booleano(entrada.travarAvanco, OPCOES_PADRAO.travarAvanco),
    ocultarTempo: booleano(entrada.ocultarTempo, OPCOES_PADRAO.ocultarTempo),
  };
}
