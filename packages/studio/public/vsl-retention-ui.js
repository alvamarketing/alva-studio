// A leitura da curva de retenção. O dado bruto diz quantos sobraram em cada marco; o que
// a pessoa precisa é ver onde o vídeo perde gente — e ler isso em uma frase, porque é a
// frase que diz o que reescrever.

const ROTULOS = { 0: 'Início', 25: '25%', 50: '50%', 75: '75%', 100: 'Fim' };

export function modeloDaCurva(retencao = {}) {
  const inicios = Number(retencao.inicios) || 0;
  const pontos = Array.isArray(retencao.pontos) ? retencao.pontos : [];
  const queda = retencao.maiorQueda;
  const cliques = Number(retencao.cliquesNoCta) || 0;

  const barras = pontos.map((ponto) => ({
    marco: ponto.marco,
    rotulo: ROTULOS[ponto.marco] ?? `${ponto.marco}%`,
    espectadores: ponto.espectadores,
    altura: `${Math.max(0, Math.min(100, Number(ponto.retencao) || 0))}%`,
    // a queda se enxerga na barra onde a gente sumiu, não na que ainda estava cheia
    queda: Boolean(queda && ponto.marco === queda.para),
  }));

  if (!inicios) {
    return {
      vazio: true,
      barras,
      resumo: 'Ainda não há quem tenha assistido. A curva aparece assim que a VSL receber as primeiras visualizações.',
      cta: '',
    };
  }

  const trecho = (marco) => ROTULOS[marco] ?? `${marco}%`;
  return {
    vazio: false,
    barras,
    resumo: queda
      ? `A maior perda é entre ${trecho(queda.de)} e ${trecho(queda.para)}: ${queda.perdidos} de ${inicios} pararam de assistir aí.`
      : `${inicios} começaram a assistir e ninguém desistiu num ponto claro.`,
    cta: `${cliques} clicaram no botão (${Number(retencao.conversao) || 0}% de quem começou).`,
  };
}
