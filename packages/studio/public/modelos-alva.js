// Os modelos de landing do editor novo, como árvores do esquema do Alva.
//
// Como nos modelos antigos, o texto é para editar: nenhum número de resultado nem
// depoimento inventado. Todo modelo já nasce com um formulário, para a landing capturar
// lead no minuto em que for publicada.
import { FORMATO_ALVA } from './pagina-alva.js';

const no = (type, props = {}, children = []) => ({ type, props, children });
const titulo = (text, level = 2) => no('heading', { text, level });
const texto = (text) => no('text', { text });
const botao = (text, href = '#contato') => no('button', { text, href, newTab: false });
const icone = (name) => no('icon', { name });
const campo = (label, name, fieldType, placeholder, required = true) => no('field', { label, name, fieldType, placeholder, required });
const formulario = (submitLabel, campos) => no('form', { submitLabel }, campos);
// Nascem centralizadas: numa seção de uma coluna, é o que fica organizado sem esforço
// (regra 2 de docs/specs/2026-09-27-ux-do-editor.md).
const secao = (fundo, filhos) => no('section', { fundo, alinhamento: 'centro' }, filhos);
const colunas = (quantidade, filhos) => no('columns', { quantidade }, filhos);
const cartao = (nomeDoIcone, cabecalho, corpo) => no('section', { fundo: 'branco' }, [icone(nomeDoIcone), titulo(cabecalho, 3), texto(corpo)]);

const contatoPadrao = (chamada, rotulo) => secao('suave', [
  titulo(chamada),
  texto('Deixe seu contato e respondemos em até um dia útil.'),
  formulario(rotulo, [
    campo('Nome', 'nome', 'text', 'Seu nome'),
    campo('E-mail', 'email', 'email', 'voce@exemplo.com'),
    campo('WhatsApp', 'whatsapp', 'tel', '(11) 91234-5678', false),
  ]),
]);

export const modelosAlva = [
  {
    id: 'rapido',
    name: 'Começo rápido',
    category: 'Captação',
    description: 'Chamada, botão e formulário de contato. O mínimo para começar a captar.',
    conteudo: () => [
      secao('branco', [titulo('Diga em uma frase o que a pessoa ganha', 1), texto('Explique em duas linhas para quem é e por que agora.'), botao('Quero saber mais')]),
      contatoPadrao('Fale com a gente', 'Enviar'),
    ],
  },
  {
    id: 'captura',
    name: 'Captura de leads',
    category: 'Captação',
    description: 'Oferta clara, três motivos para aceitar e o formulário logo abaixo.',
    conteudo: () => [
      secao('escuro', [titulo('[Sua oferta] para [quem ela serve]', 1), texto('Uma frase sobre o resultado que a pessoa leva, sem prometer número que você não pode provar.'), botao('Quero receber')]),
      secao('branco', [
        titulo('Por que vale a pena'),
        colunas(3, [
          cartao('bolt', '[Primeiro motivo]', 'Explique o benefício em uma ou duas frases.'),
          cartao('schedule', '[Segundo motivo]', 'O que a pessoa economiza: tempo, dinheiro ou esforço.'),
          cartao('verified', '[Terceiro motivo]', 'Por que confiar em você para isso.'),
        ]),
      ]),
      contatoPadrao('Receba agora', 'Quero receber'),
    ],
  },
  {
    id: 'servico',
    name: 'Serviços',
    category: 'Serviços',
    description: 'Apresenta o que você faz, como funciona e convida para uma conversa.',
    conteudo: () => [
      secao('suave', [titulo('[Seu serviço] feito para [seu cliente]', 1), texto('Conte em poucas palavras o problema que você resolve.'), botao('Pedir uma proposta')]),
      secao('branco', [
        titulo('Como funciona'),
        colunas(3, [
          cartao('forum', '1. Conversa', 'Entendemos o que você precisa.'),
          cartao('edit_note', '2. Proposta', 'Você recebe o plano e o prazo.'),
          cartao('rocket_launch', '3. Entrega', 'Fazemos e acompanhamos o resultado.'),
        ]),
      ]),
      contatoPadrao('Vamos conversar?', 'Pedir proposta'),
    ],
  },
  {
    id: 'evento',
    name: 'Evento',
    category: 'Eventos',
    description: 'Data, o que a pessoa vai aprender e a inscrição.',
    conteudo: () => [
      secao('escuro', [titulo('[Nome do evento]', 1), texto('[Data] · [Horário] · [Online ou local]'), botao('Garantir minha vaga', '#inscricao')]),
      secao('branco', [
        titulo('O que você vai levar'),
        colunas(2, [
          cartao('school', '[Tema um]', 'O que a pessoa sai sabendo fazer.'),
          cartao('lightbulb', '[Tema dois]', 'Uma ideia que ela aplica no dia seguinte.'),
        ]),
      ]),
      secao('suave', [
        titulo('Inscrição'),
        formulario('Garantir minha vaga', [campo('Nome', 'nome', 'text', 'Seu nome'), campo('E-mail', 'email', 'email', 'voce@exemplo.com')]),
      ]),
    ],
  },
];

export function estadoDoModelo(id, nome = '') {
  const modelo = modelosAlva.find((item) => item.id === id) ?? modelosAlva[0];
  return { formato: FORMATO_ALVA, root: { title: String(nome).slice(0, 200) }, content: modelo.conteudo() };
}
