// Quanto de correspondência o Studio conseguiu mandar junto com a conversão.
//
// Isto **não** é a nota da Meta. A Meta calcula a dela com dados que não temos e por
// critérios que ela não publica; copiar o nome dela seria dar como medido o que é
// estimado. O que dá para afirmar com honestidade é outra coisa, e é a que serve para
// agir: quais sinais de identificação saíram daqui, e quais não saíram porque falta
// alguma coisa que alguém pode resolver.
//
// O peso de cada sinal segue o que as plataformas descrevem como determinante para
// casar a conversão com a pessoa: o identificador do clique amarra o evento ao anúncio
// e vale mais que tudo; o contato hasheado casa a pessoa entre dispositivos; o
// identificador do navegador reforça a sessão; o endereço da página situa o evento.

const HASH = /^[a-f0-9]{64}$/i;
const FBC = /^fb\.\d\.\d+\..+$/;
const FBP = /^fb\.\d\.\d+\.\d+$/;

const SINAIS = [
  {
    chave: 'clique',
    sinal: 'Identificador do clique no anúncio',
    peso: 40,
    presente: (evento) => FBC.test(String(evento?.click_ids?.fbc ?? ''))
      || Boolean(evento?.click_ids?.gclid || evento?.click_ids?.ttclid
        || evento?.click_ids?.linkedin_tracking_uuid || evento?.click_ids?.taboola_click_id),
    oQueFazer: 'Quem converteu chegou sem identificador de clique: ou entrou por link direto, ou o anúncio aponta para um endereço que perde os parâmetros no caminho. Confira se o destino do anúncio é a página publicada, sem redirecionamento no meio.',
  },
  {
    chave: 'email',
    sinal: 'E-mail da pessoa',
    peso: 25,
    exigeConsentimento: true,
    presente: (evento) => HASH.test(String(evento?.user?.email_sha256 ?? '')),
    oQueFazer: 'Se o formulário da página não pede e-mail, acrescentar o campo é o que mais aumenta a correspondência: o e-mail é o que casa a mesma pessoa entre o celular e o computador.',
  },
  {
    chave: 'telefone',
    sinal: 'Telefone da pessoa',
    peso: 15,
    exigeConsentimento: true,
    presente: (evento) => HASH.test(String(evento?.user?.phone_sha256 ?? '')),
    oQueFazer: 'Um campo de telefone no formulário costuma ser aceito bem em oferta com contato por WhatsApp, e soma correspondência junto com o e-mail.',
  },
  {
    chave: 'navegador',
    sinal: 'Identificador do navegador',
    peso: 12,
    presente: (evento) => FBP.test(String(evento?.click_ids?.fbp ?? '')),
    oQueFazer: 'O identificador que o pixel escreve no navegador não chegou. Ele só existe se o pixel da plataforma estiver na página publicada: confira se o pixel está ativo nesta página, além da entrega pelo servidor.',
  },
  {
    chave: 'endereco',
    sinal: 'Endereço da página',
    peso: 8,
    presente: (evento) => /^https:\/\//.test(String(evento?.source_url ?? '')),
    oQueFazer: 'A conversão chegou sem dizer em qual página aconteceu, o que ocorre quando ela vem de uma origem que não é a publicação verificada do projeto.',
  },
];

const TOTAL = SINAIS.reduce((soma, item) => soma + item.peso, 0);

export function qualidadeDaCorrespondencia(evento) {
  // Consentimento negado não é configuração errada: é a pessoa exercendo um direito, e o
  // servidor nem gera os hashes nesse caso. Cobrar o e-mail aqui mandaria alguém tentar
  // consertar o que não está quebrado.
  const semContato = String(evento?.consent_state ?? 'pending') === 'denied';
  const avaliados = SINAIS.filter((item) => !(semContato && item.exigeConsentimento));
  const total = avaliados.reduce((soma, item) => soma + item.peso, 0);
  const presentes = avaliados.filter((item) => item.presente(evento));
  const pontos = presentes.reduce((soma, item) => soma + item.peso, 0);
  const percentual = total ? Math.round((pontos / total) * 100) : 0;
  return {
    pontos,
    total,
    percentual,
    nivel: percentual >= 70 ? 'boa' : percentual >= 40 ? 'parcial' : 'fraca',
    faltando: avaliados.filter((item) => !item.presente(evento)).map(({ chave, sinal, oQueFazer, peso }) => ({ chave, sinal, oQueFazer, peso })),
    ...(semContato ? { observacao: 'Consentimento negado: e-mail e telefone não são enviados, e isso é o comportamento correto — não uma falha de configuração.' } : {}),
  };
}

export function resumoDaCorrespondencia(entregas) {
  const linhas = (Array.isArray(entregas) ? entregas : []).map((linha) => linha?.payload).filter(Boolean);
  if (!linhas.length) return { eventos: 0, media: null, nivel: null, faltando: [] };
  const notas = linhas.map(qualidadeDaCorrespondencia);
  const media = Math.round(notas.reduce((soma, nota) => soma + nota.percentual, 0) / notas.length);
  // A tela mostra o conjunto: quem cuida de um projeto precisa saber onde está perdendo
  // correspondência, não a nota de uma conversão específica. Por isso a falta que mais se
  // repete vem primeiro — é a que, resolvida, muda mais evento de uma vez.
  const contagem = new Map();
  for (const nota of notas) {
    for (const item of nota.faltando) {
      const atual = contagem.get(item.chave) ?? { ...item, eventos: 0 };
      atual.eventos += 1;
      contagem.set(item.chave, atual);
    }
  }
  return {
    eventos: linhas.length,
    media,
    nivel: media >= 70 ? 'boa' : media >= 40 ? 'parcial' : 'fraca',
    faltando: [...contagem.values()].sort((a, b) => b.eventos - a.eventos || b.peso - a.peso),
  };
}

export const TOTAL_DA_CORRESPONDENCIA = TOTAL;
