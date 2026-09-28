// Os tipos de etapa de um funil e a página de exemplo de cada um.
//
// A etapa é o que a pessoa desenha no canvas da aba Funis. Algumas viram página do Studio
// (landing ou quiz) e ganham um botão para abrir no editor; as outras acontecem fora dele
// (anúncio, e-mail, WhatsApp, checkout da plataforma de pagamento) e ficam no desenho para
// o funil fazer sentido. Os tipos (`k`) são os mesmos da aba Funis da Jornada da Alva.
//
// As páginas são modelos para editar, não copy final: título, texto e botão no lugar certo,
// com o que a etapa descreve no funil.
import { estadoDoQuiz, FORMATO_ALVA } from './pagina-alva.js';

export const TIPOS_DE_ETAPA = Object.freeze({
  meta: { rotulo: 'Anúncio (Meta)', grupo: 'trafego' },
  anuncio: { rotulo: 'Anúncio', grupo: 'trafego' },
  instagram: { rotulo: 'Instagram', grupo: 'trafego' },
  conteudo: { rotulo: 'Conteúdo orgânico', grupo: 'trafego' },
  indicacao: { rotulo: 'Indicação', grupo: 'trafego' },
  prospeccao: { rotulo: 'Prospecção', grupo: 'trafego' },
  dm: { rotulo: 'Mensagem direta', grupo: 'trafego' },
  pagina: { rotulo: 'Página de vendas', grupo: 'pagina', cria: 'landing' },
  captura: { rotulo: 'Página de captura', grupo: 'pagina', cria: 'landing' },
  webinar: { rotulo: 'Página com vídeo', grupo: 'pagina', cria: 'landing' },
  formulario: { rotulo: 'Formulário / aplicação', grupo: 'pagina', cria: 'quiz' },
  upsellpg: { rotulo: 'Upsell', grupo: 'pagina', cria: 'landing' },
  downsell: { rotulo: 'Downsell', grupo: 'pagina', cria: 'landing' },
  obrigado: { rotulo: 'Obrigado', grupo: 'pagina', cria: 'landing' },
  checkout: { rotulo: 'Checkout', grupo: 'fora' },
  pagamento: { rotulo: 'Pagamento', grupo: 'fora' },
  agenda: { rotulo: 'Agendamento', grupo: 'fora' },
  whatsapp: { rotulo: 'WhatsApp', grupo: 'fora' },
  email: { rotulo: 'E-mail', grupo: 'fora' },
  reuniao: { rotulo: 'Reunião / call', grupo: 'fora' },
  proposta: { rotulo: 'Proposta', grupo: 'fora' },
  contrato: { rotulo: 'Contrato', grupo: 'fora' },
  crm: { rotulo: 'CRM / medição', grupo: 'fora' },
  cliente: { rotulo: 'Cliente', grupo: 'resultado' },
  sucesso: { rotulo: 'Venda', grupo: 'resultado' },
  perda: { rotulo: 'Perda / escala humano', grupo: 'resultado' },
  nota: { rotulo: 'Nota', grupo: 'fora' },
});

export const tipoDaEtapa = (k) => TIPOS_DE_ETAPA[k] ?? { rotulo: 'Etapa', grupo: 'fora' };
export const etapaViraPagina = (k) => Boolean(tipoDaEtapa(k).cria);

const no = (type, props = {}, children = []) => ({ type, props, children });
const secao = (props, children) => no('section', props, children);

// A descrição da etapa no funil vem em linhas com marcador ("• ..."): cada uma vira um
// texto da página, que é o que a pessoa vai reescrever.
function linhas(texto) {
  return String(texto ?? '').split(/\n+/).map((linha) => linha.replace(/^\s*[•\-*]\s*/, '').trim()).filter(Boolean).slice(0, 4);
}

function beneficios(etapa) {
  const itens = linhas(etapa.texto);
  const textos = itens.length ? itens : ['[Primeiro ponto, em uma frase]', '[Segundo ponto, em uma frase]', '[Terceiro ponto, em uma frase]'];
  return secao({ fundo: 'branco', alinhamento: 'centro' }, [
    no('heading', { text: 'O que você leva', level: 2 }),
    ...textos.map((text) => no('text', { text })),
  ]);
}

const topo = (titulo, subtitulo, botao, href = '#') => secao({ fundo: 'escuro', respiro: 'g', alinhamento: 'centro' }, [
  no('heading', { text: titulo, level: 1 }),
  no('text', { text: subtitulo }),
  ...(botao ? [no('button', { text: botao, href, newTab: false })] : []),
]);

const depoimento = () => secao({ fundo: 'suave', alinhamento: 'centro' }, [
  no('icon', { name: 'format_quote' }),
  no('text', { text: '"[Cole aqui um depoimento real de um cliente, com a autorização dele.]"' }),
  no('text', { text: '[Nome do cliente] · [Empresa]' }),
]);

const chamada = (titulo, botao, href) => secao({ fundo: 'escuro', respiro: 'g', alinhamento: 'centro' }, [
  no('heading', { text: titulo, level: 2 }),
  no('button', { text: botao, href, newTab: false }),
]);

const formulario = (botao, campos) => secao({ fundo: 'suave', alinhamento: 'centro' }, [
  no('heading', { text: 'Preencha para continuar', level: 2 }),
  no('form', { submitLabel: botao, avancado: { largura: '2/3' } }, campos.map(([label, name, fieldType, placeholder, required]) => no('field', { label, name, fieldType, placeholder, required }))),
]);

const NOME = ['Nome', 'nome', 'text', 'Seu nome', true];
const EMAIL = ['E-mail', 'email', 'email', 'voce@exemplo.com', true];

// O conteúdo de cada tipo de página. `proxima` é o endereço para onde o botão principal
// leva (a próxima etapa do funil); `alternativa`, o do "não, obrigado" do upsell.
const CONTEUDO = {
  pagina: (etapa, { proxima }) => [
    topo(`[Sua oferta]: ${etapa.nome}`, 'Uma frase sobre o resultado que a pessoa leva, sem prometer o que você não pode provar.', 'Quero garantir', proxima),
    beneficios(etapa),
    depoimento(),
    chamada('Pronto para começar?', 'Quero garantir', proxima),
  ],
  captura: (etapa) => [
    topo(`[Material gratuito]: ${etapa.nome}`, 'Deixe seu e-mail e receba agora. Sem spam: um e-mail por semana, no máximo.', ''),
    beneficios(etapa),
    formulario('Quero receber', [NOME, EMAIL]),
  ],
  webinar: (etapa, { proxima }) => [
    topo(etapa.nome, 'Assista até o fim: a oferta aparece no final do vídeo.', ''),
    secao({ fundo: 'branco', alinhamento: 'centro' }, [
      no('video', { url: '', title: etapa.nome }),
      no('button', { text: 'Quero aproveitar', href: proxima, newTab: false }),
    ]),
    beneficios(etapa),
  ],
  upsellpg: (etapa, { proxima, alternativa }) => [
    topo('Espere! Sua compra ainda não terminou', `[Oferta complementar]: ${etapa.nome}. Só nesta página, por um valor especial.`, ''),
    beneficios(etapa),
    secao({ fundo: 'suave', alinhamento: 'centro' }, [
      no('heading', { text: 'Adicione ao seu pedido com um clique', level: 2 }),
      no('button', { text: 'Sim, quero adicionar', href: proxima, newTab: false }),
      no('button', { text: 'Não, obrigado', href: alternativa, newTab: false, corDoBotao: '#ffffff', corDoTextoDoBotao: '#667085' }),
    ]),
  ],
  downsell: (etapa, { proxima, alternativa }) => [
    topo('Uma última opção para você', `[Versão mais simples]: ${etapa.nome}, por um valor menor.`, ''),
    beneficios(etapa),
    secao({ fundo: 'suave', alinhamento: 'centro' }, [
      no('button', { text: 'Sim, quero esta opção', href: proxima, newTab: false }),
      no('button', { text: 'Não, obrigado', href: alternativa, newTab: false, corDoBotao: '#ffffff', corDoTextoDoBotao: '#667085' }),
    ]),
  ],
  obrigado: (etapa, { proxima }) => [
    topo('Pronto! Está tudo certo.', 'Enviamos os detalhes para o seu e-mail. Confira também a caixa de spam.', ''),
    secao({ fundo: 'branco', alinhamento: 'centro' }, [
      no('heading', { text: 'Próximo passo', level: 2 }),
      ...linhas(etapa.texto).map((text) => no('text', { text })),
      no('button', { text: 'Continuar', href: proxima, newTab: false }),
    ]),
  ],
};

// A página de uma etapa, no esquema do Alva (landing) — ou o quiz de aplicação.
export function paginaDaEtapa(etapa, { proxima = '#', alternativa = '#' } = {}) {
  const tipo = tipoDaEtapa(etapa.k);
  if (tipo.cria === 'quiz') return quizDeAplicacao(etapa);
  const montar = CONTEUDO[etapa.k] ?? CONTEUDO.pagina;
  return {
    kind: 'page',
    editorState: { formato: FORMATO_ALVA, root: { title: String(etapa.nome ?? '').slice(0, 200) }, content: montar(etapa, { proxima, alternativa }) },
  };
}

// O formulário de aplicação é um quiz: uma pergunta de qualificação por etapa, o contato e
// a tela final — o mesmo quiz novo, com perguntas de quem está se candidatando.
function quizDeAplicacao(etapa) {
  const estado = estadoDoQuiz(etapa.nome);
  estado.content[0].children[0].props.text = `Aplicação: ${etapa.nome}`;
  estado.content[0].children[1].props.text = 'Responda com sinceridade: usamos as respostas para ver se faz sentido conversarmos.';
  estado.content[1].children[0].props = {
    ...estado.content[1].children[0].props,
    pergunta: 'Qual é o faturamento mensal da sua empresa hoje?',
    opcoes: [
      { rotulo: 'Até R$ 30 mil', icone: 'savings' },
      { rotulo: 'De R$ 30 mil a R$ 100 mil', icone: 'payments' },
      { rotulo: 'De R$ 100 mil a R$ 500 mil', icone: 'trending_up' },
      { rotulo: 'Acima de R$ 500 mil', icone: 'workspace_premium' },
    ],
  };
  return { kind: 'quiz', editorState: estado };
}
