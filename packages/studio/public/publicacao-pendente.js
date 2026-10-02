// O botão Publicar avisa quando há algo no ar que ficou desatualizado — como no RD Station,
// ele muda de cor. A página no ar só muda quando se publica de novo: o HTML publicado é o
// que foi gerado quando ela foi salva, e os pixels ficam gravados na hora da publicação.
//
// Uma página que nunca foi publicada não acende o aviso: não há nada no ar para estar
// desatualizado, é só um rascunho.
export function estadoDoPublicar({ publicada = false, alteracoesNaoPublicadas = false, alteracoesNaoSalvas = false, pixelsPendentes = false } = {}) {
  if (!publicada) return { pendente: false, rotulo: 'Publicar', dica: '' };
  const motivos = [];
  if (alteracoesNaoSalvas) motivos.push('há alterações que ainda nem foram salvas');
  else if (alteracoesNaoPublicadas) motivos.push('há alterações salvas que ainda não foram publicadas');
  if (pixelsPendentes) motivos.push('os pixels mudaram depois da última publicação');
  if (!motivos.length) return { pendente: false, rotulo: 'Publicar', dica: '' };
  return {
    pendente: true,
    rotulo: 'Publicar alterações',
    dica: `A página está no ar, mas ${motivos.join(' e ')}. Publique de novo para valer para quem visita.`,
  };
}
