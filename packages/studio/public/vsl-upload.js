// Envio do vídeo da VSL para a conta Cloudflare de quem opera o Studio.
//
// São três tempos: o arquivo sobe, a Cloudflare converte, e só então existe endereço
// para tocar. Sem mostrar em qual deles está, a tela parece travada e a pessoa recarrega
// no meio, perdendo o envio.

export function estadoDoEnvio(situacao = {}) {
  if (situacao.falhou)
    return {
      fase: 'erro',
      motivo: situacao.motivo || 'A conversão do vídeo falhou.',
      // Insistir num vídeo que falhou é esperar por algo que nunca fica pronto.
      continuarConsultando: false,
    };
  if (situacao.pronto)
    return {
      fase: 'pronto',
      continuarConsultando: false,
      sourceUrl: situacao.hlsUrl || '',
      // O Stream entrega HLS, que é o formato que se ajusta à internet de quem assiste.
      sourceType: 'hls',
      posterUrl: situacao.miniaturaUrl || '',
      duracaoSegundos: situacao.duracaoSegundos || 0,
    };
  return { fase: 'convertendo', continuarConsultando: true };
}

export function mensagemDoEnvio(estado = {}) {
  if (estado.fase === 'enviando') return `Enviando o vídeo… ${Math.round(estado.progresso || 0)}%`;
  if (estado.fase === 'convertendo') return 'Preparando o vídeo para tocar em qualquer conexão. Isso leva alguns minutos.';
  if (estado.fase === 'pronto') return 'Vídeo pronto. O endereço já foi preenchido abaixo.';
  if (estado.fase === 'erro') return `Não foi possível usar este vídeo: ${estado.motivo || 'erro desconhecido'}`;
  return '';
}

// O arquivo vai do navegador direto para a Cloudflare. Passá-lo pelo nosso servidor
// limitaria o tamanho e ocuparia disco à toa.
export function enviarArquivo({ uploadUrl, arquivo, aoProgredir = () => {}, XHR = XMLHttpRequest }) {
  return new Promise((resolve, reject) => {
    const requisicao = new XHR();
    requisicao.open('POST', uploadUrl);
    requisicao.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir((evento.loaded / evento.total) * 100);
    };
    requisicao.onload = () =>
      (requisicao.status >= 200 && requisicao.status < 300
        ? resolve()
        : reject(new Error(`O envio falhou (${requisicao.status}).`)));
    requisicao.onerror = () => reject(new Error('O envio foi interrompido. Verifique a conexão e tente de novo.'));
    const formulario = new FormData();
    formulario.append('file', arquivo);
    requisicao.send(formulario);
  });
}
