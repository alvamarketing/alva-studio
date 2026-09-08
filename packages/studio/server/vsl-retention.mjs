// A curva de retenção de uma VSL: de cem pessoas que apertaram play, quantas ainda
// estavam lá aos 25%, 50%, 75% e no fim.
//
// Os eventos já chegavam do player — início, marcos de 25 em 25, conclusão e clique no
// CTA. O que faltava era juntá-los numa curva. Sem ela o vídeo é publicado no escuro:
// dá para saber quantos assistiram, nunca onde desistiram.

const MARCOS = [0, 25, 50, 75, 100];

export function curvaDeRetencao(linhas = []) {
  const total = (nome, marco) => (linhas || [])
    .filter((linha) => linha?.eventName === nome && (marco === undefined || Number(linha.milestone) === marco))
    .reduce((soma, linha) => soma + (Number(linha.total) || 0), 0);

  const inicios = total('vsl_start');
  // O último marco vem de vsl_complete: quem chegou ao fim dispara a conclusão, não um
  // marco de 100. Contar os dois somaria a mesma pessoa duas vezes.
  const espectadoresEm = (marco) => {
    if (marco === 0) return inicios;
    if (marco === 100) return total('vsl_complete') || total('vsl_progress', 100);
    return total('vsl_progress', marco);
  };

  const pontos = MARCOS.map((marco) => {
    const espectadores = espectadoresEm(marco);
    return {
      marco,
      espectadores,
      retencao: inicios ? Math.round((espectadores / inicios) * 100) : 0,
    };
  });

  // A maior queda é o que se olha primeiro: é ali que o vídeo perde gente, e é ali que
  // vale reescrever.
  let maiorQueda = null;
  for (let i = 1; i < pontos.length; i += 1) {
    const perdidos = pontos[i - 1].espectadores - pontos[i].espectadores;
    if (perdidos <= 0) continue;
    if (!maiorQueda || perdidos > maiorQueda.perdidos)
      maiorQueda = { de: pontos[i - 1].marco, para: pontos[i].marco, perdidos };
  }

  const cliquesNoCta = total('vsl_cta_click');
  return {
    inicios,
    pontos,
    maiorQueda,
    cliquesNoCta,
    conversao: inicios ? Math.round((cliquesNoCta / inicios) * 100) : 0,
  };
}
