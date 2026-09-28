// A página no esquema do Alva: o estado que o editor salva, o documento que vai ao ar e os
// formulários que a publicação valida. Roda no servidor (salvar e publicar) e no editor
// (pré-visualização) — um desenhador só, para o que se vê editando ser o que vai ao ar.
import { AVISO_DE_PRIVACIDADE, extrairCapturas, nomeDaEscolha, normalizeNode, renderTree, escapeHtml } from './page-schema.js';
import { elementosCss, escolhaCss } from './catalogo-elementos.js';
import { quizRuntimeCss, quizRuntimeScript } from './quiz-runtime.js';
import { normalizeQuizNavigation } from './quiz-navigation.js';
import { runtimeCss, templateCss } from './templates.js';
import { materialSymbolsFontCss } from './quiz-elements.js';

export const FORMATO_ALVA = 'alva/1';
export const FONTE_DO_CONTRATO = 'body{font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}';
export const ehEstadoAlva = (estado) => estado?.formato === FORMATO_ALVA;

const LOGO = /^(?:https:\/\/|\/i\/)[^\s"'()\\<>]{1,1000}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const novoId = () => globalThis.crypto.randomUUID();

// O estado limpo: cada nó normalizado e com identidade estável e única — o editor precisa
// dela para cada bloco, e o formulário, para a resposta publicada dizer de onde veio (no
// formulário, a identidade é um UUID, que é o que a publicação aceita).
export function normalizarEstadoAlva(estado, uuid = novoId) {
  const vistos = new Set();
  const garantir = (node) => {
    const limpo = normalizeNode(node);
    const valido = limpo.type === 'form' ? UUID.test(limpo.id ?? '') : Boolean(limpo.id);
    limpo.id = valido && !vistos.has(limpo.id) ? limpo.id : uuid();
    vistos.add(limpo.id);
    return { ...limpo, children: limpo.children.map(garantir) };
  };
  const titulo = String(estado?.root?.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  // O quiz é a página inteira como uma captura só: a identidade dela mora na raiz.
  // A marca do cabeçalho do quiz: texto (ou o título, se vazio) e, opcional, a logo.
  const marca = String(estado?.root?.marca ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  const logo = LOGO.test(String(estado?.root?.logo ?? '')) ? String(estado.root.logo) : '';
  const quiz = estado?.root?.tipo === 'quiz'
    ? { tipo: 'quiz', captureId: UUID.test(estado.root.captureId ?? '') ? estado.root.captureId : uuid(), ...(marca ? { marca } : {}), ...(logo ? { logo } : {}) }
    : {};
  return {
    formato: FORMATO_ALVA,
    root: { title: titulo, ...quiz },
    content: (Array.isArray(estado?.content) ? estado.content : []).map(garantir),
  };
}

export const ehQuiz = (estado) => estado?.root?.tipo === 'quiz';

export function documentoDaPagina(estado, { publicOrigin = '', previa = false } = {}) {
  const limpo = normalizarEstadoAlva(estado, () => { throw new Error('Estado sem identificadores: normalize antes de desenhar.'); });
  const quiz = ehQuiz(limpo);
  // A fonte do contrato visual (token --font-sans do Studio) vence a do modelo antigo.
  const folhas = materialSymbolsFontCss(publicOrigin) + runtimeCss + templateCss + FONTE_DO_CONTRATO + elementosCss + (quiz ? escolhaCss + quizRuntimeCss : '');
  const nomeDaMarca = limpo.root.marca || limpo.root.title || '';
  const topo = quiz
    ? `<header class="alva-quiz-topo"><span class="alva-quiz-marca">${limpo.root.logo ? `<img src="${escapeHtml(limpo.root.logo)}" alt="${escapeHtml(nomeDaMarca)}">` : escapeHtml(nomeDaMarca)}</span><div class="alva-quiz-progresso"><i></i></div><small class="alva-quiz-porcento">0%</small></header>`
    : '';
  // O quiz: todas as etapas dentro de uma captura (o runtime mostra uma por vez e envia no
  // fim). O script vai com o marcador de nonce que a publicação troca pelo da CSP — sem
  // ele, a página publicada bloquearia o próprio quiz.
  const corpo = quiz
    ? `<body data-alva-quiz="true" data-alva-quiz-voltar="true">${topo}<main class="alva-pagina"><form class="alva-quiz" data-alva-capture-id="${escapeHtml(limpo.root.captureId)}" action="#" method="post" novalidate>${renderTree(limpo.content)}</form></main>`
      + `<script nonce="__ALVA_RUNTIME_NONCE__">${quizRuntimeScript({ previa })}</script></body>`
    : `<body><main class="alva-pagina">${renderTree(limpo.content)}</main></body>`;
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">'
    + `<title>${escapeHtml(limpo.root.title)}</title><style>${folhas}</style></head>`
    + `${corpo}</html>`;
}

// O tipo de resposta do esquema no vocabulário que a validação da captura usa.
// `text` é o tipo do parágrafo, que não tem resposta: campo de texto é `short_text`.
const TIPO_DA_CAPTURA = Object.freeze({ text: 'short_text', email: 'email', tel: 'short_text', number: 'number', date: 'date', file: 'file', long_text: 'long_text' });

export function capturasDoEstado(estado, { webhook = '' } = {}) {
  if (ehQuiz(estado)) return { forms: [capturaDoQuiz(estado, webhook)] };
  return {
    forms: extrairCapturas(estado?.content).map((captura) => ({
      captureId: captura.id,
      name: captura.name,
      fields: captura.fields.map((campo) => ({ id: campo.name, type: TIPO_DA_CAPTURA[campo.type], title: campo.label, required: campo.required })),
      webhook,
      completion: {},
    })),
  };
}

// O começo de uma landing nova: topo com chamada e botão, e uma seção de contato com
// formulário — o mínimo para ela já capturar lead ao ser publicada.
export function paginaInicial(nome = '') {
  return {
    formato: FORMATO_ALVA,
    root: { title: String(nome).slice(0, 200) },
    content: [
      { type: 'section', props: {}, children: [
        { type: 'heading', props: { text: 'Diga em uma frase o que a pessoa ganha', level: 1 }, children: [] },
        { type: 'text', props: { text: 'Explique em duas linhas para quem é e por que agora.' }, children: [] },
        { type: 'button', props: { text: 'Quero saber mais', href: '#contato', newTab: false }, children: [] },
      ] },
      { type: 'section', props: {}, children: [
        { type: 'heading', props: { text: 'Fale com a gente', level: 2 }, children: [] },
        { type: 'form', props: { submitLabel: 'Enviar' }, children: [
          { type: 'field', props: { label: 'Nome', name: 'nome', fieldType: 'text', placeholder: 'Seu nome', required: true }, children: [] },
          { type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true }, children: [] },
          { type: 'field', props: { label: 'WhatsApp', name: 'whatsapp', fieldType: 'tel', placeholder: '(11) 91234-5678', required: false }, children: [] },
        ] },
      ] },
    ],
  };
}

// A captura do quiz: uma etapa da validação por etapa da página, com as perguntas dela e a
// regra de cada opção que leva a outra etapa. É o formato que `quiz-navigation` confere —
// o servidor aceita o caminho que pulou uma etapa e cobra só o que a pessoa viu.
function capturaDoQuiz(bruto, webhook) {
  const estado = normalizarEstadoAlva(bruto, () => { throw new Error('Estado sem identificadores: normalize antes de publicar.'); });
  const etapas = estado.content.filter((node) => node.type === 'etapa');
  const existentes = new Set(etapas.map((etapa) => etapa.id));
  const nomes = new Set();
  const falhar = (mensagem) => Object.assign(new Error(mensagem), { status: 400, statusCode: 400 });
  const steps = etapas.map((etapa) => {
    const elements = [];
    const rules = [];
    const descer = (node) => {
      for (const filho of node.children) {
        if (filho.type === 'field') {
          elements.push({ id: filho.props.name, type: TIPO_DA_CAPTURA[filho.props.fieldType], title: String(filho.props.label ?? '').slice(0, 200), required: filho.props.required === true });
        } else if (filho.type === 'escolha' && filho.props.opcoes.length) {
          const id = nomeDaEscolha(filho);
          elements.push({ id, type: filho.props.multipla ? 'multiple_choice' : 'single_choice', title: filho.props.pergunta || 'Pergunta', required: filho.props.obrigatoria, options: filho.props.opcoes.map((opcao) => opcao.rotulo) });
          // Destino de uma etapa que foi apagada não é regra: a opção segue para a próxima,
          // como o runtime faz.
          for (const opcao of filho.props.opcoes) if (opcao.destino && existentes.has(opcao.destino))
            rules.push({ fieldId: id, operator: filho.props.multipla ? 'includes' : 'equals', value: opcao.rotulo, nextScreenId: opcao.destino });
        } else descer(filho);
      }
    };
    descer(etapa);
    for (const elemento of elements) {
      if (nomes.has(elemento.id)) throw falhar(`Duas perguntas do quiz respondem no mesmo campo (“${elemento.id}”). Dê nomes diferentes.`);
      nomes.add(elemento.id);
    }
    return { id: etapa.id, elements, ...(rules.length ? { branching: { rules } } : {}) };
  });
  if (steps.length) {
    try { normalizeQuizNavigation(steps); } catch (erro) { throw falhar(erro.message); }
  }
  return {
    captureId: estado.root.captureId,
    name: estado.root.title || 'Quiz',
    fields: steps.flatMap((etapa) => etapa.elements),
    steps,
    webhook,
    completion: {},
  };
}

// O começo de um quiz novo: abertura, uma pergunta de escolha que avança sozinha, o
// contato e a tela final — publicado assim, já capta lead.
export function estadoDoQuiz(nome = '') {
  const etapa = (children) => ({ type: 'etapa', props: { alinhamento: 'centro' }, children });
  const no = (type, props) => ({ type, props, children: [] });
  return {
    formato: FORMATO_ALVA,
    root: { title: String(nome).slice(0, 200), tipo: 'quiz' },
    content: [
      etapa([
        no('heading', { text: 'Descubra em 1 minuto o melhor caminho para você', level: 1 }),
        no('text', { text: 'Responda três perguntas rápidas e receba uma recomendação.' }),
        no('button', { text: 'Começar', href: '#' }),
      ]),
      etapa([
        no('escolha', { pergunta: 'Qual é o seu objetivo agora?', obrigatoria: true, avancar: true, colunas: 2, opcoes: [
          { rotulo: 'Vender mais', icone: 'trending_up' },
          { rotulo: 'Atrair clientes', icone: 'groups' },
          { rotulo: 'Organizar a equipe', icone: 'task_alt' },
          { rotulo: 'Ainda estou pesquisando', icone: 'search' },
        ] }),
      ]),
      etapa([
        no('heading', { text: 'Para onde enviamos sua recomendação?', level: 2 }),
        no('field', { label: 'Nome', name: 'nome', fieldType: 'text', placeholder: 'Seu nome', required: true }),
        no('field', { label: 'E-mail', name: 'email', fieldType: 'email', placeholder: 'voce@exemplo.com', required: true }),
        no('field', { label: 'WhatsApp', name: 'whatsapp', fieldType: 'tel', placeholder: '(11) 91234-5678', required: false }),
        no('button', { text: 'Ver recomendação', href: '#' }),
        no('text', { text: AVISO_DE_PRIVACIDADE }),
      ]),
      etapa([
        no('heading', { text: 'Pronto! Recebemos suas respostas.', level: 2 }),
        no('text', { text: 'Em instantes você recebe a recomendação no seu e-mail.' }),
      ]),
    ],
  };
}
