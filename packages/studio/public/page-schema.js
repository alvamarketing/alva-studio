// O esquema de página do Alva, e como ele vira HTML.
//
// Isto é a fonte da verdade do que uma página é. O editor lê e escreve este formato; o
// servidor desenha o HTML publicado a partir dele. Antes, o que era salvo era o formato
// interno do editor, e o HTML publicado vinha pronto do navegador — o servidor confiava
// num artefato do cliente para servir ao público.
//
// Um nó é `{ id, type, props, children }`. `type` vem do vocabulário do Alva, não de tag
// HTML: uma seção é `section`, não `<section>`, e um campo de captura é `field`, não um
// `<input>` a ser descoberto dentro de marcação. É essa diferença que faz descobrir os
// campos de um formulário virar uma caminhada pela árvore, em vez de um parser.
//
// Como o servidor passou a desenhar, escapar deixou de ser detalhe de renderização e
// virou fronteira: nada que uma pessoa digita pode virar marcação.

// O aviso de privacidade que acompanha todo formulário que capta lead: diz para que os
// dados servem e aponta a política. Vazio de propósito ("") some; ausente, vale o padrão.
// É verdade o que ele diz: o contato vai, protegido (hash), às plataformas de anúncio.
export const AVISO_DE_PRIVACIDADE = 'Ao enviar, você concorda com o uso dos seus dados para entrarmos em contato e para medir, de forma protegida, os resultados dos nossos anúncios.';
export function avisoDePrivacidade(props = {}) {
  const aviso = props.aviso === undefined ? AVISO_DE_PRIVACIDADE : texto(props.aviso, 400).trim();
  if (!aviso) return '';
  const politica = /^https:\/\/[^\s"'<>]{1,1000}$/i.test(String(props.politica ?? '')) ? props.politica : '';
  return `<p class="alva-aviso-privacidade">${escapeHtml(aviso)}${politica ? ` <a href="${escapeHtml(politica)}" target="_blank" rel="noopener noreferrer">Política de privacidade</a>` : ''}</p>`;
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// Uma árvore vinda de fora não pode travar quem a desenha.
const PROFUNDIDADE_MAXIMA = 40;

// Os esquemas de endereço que navegam. `javascript:` e `data:` executam, e um deles num
// href transformaria o botão de uma página publicada em execução de código.
const ESQUEMA_SEGURO = /^(?:https?:\/\/|mailto:|tel:|#|\/)/i;

// Os tipos de resposta que a captura aceita — os mesmos que o servidor valida.
const FIELD_TYPES = new Set(['text', 'email', 'tel', 'number', 'date', 'file', 'long_text']);

function falhar(mensagem) {
  return Object.assign(new Error(mensagem), { status: 400, statusCode: 400 });
}

function texto(valor, limite = 2000) {
  return String(valor ?? '').replace(/[\r\n]+/g, ' ').slice(0, limite);
}

function endereco(valor) {
  const limpo = String(valor ?? '').trim();
  return limpo && ESQUEMA_SEGURO.test(limpo) ? limpo : '#';
}

// O endereço de uma imagem: http(s) ou caminho do próprio domínio (/i/... é a imagem
// anexada no Studio). Vazio quando não há o que carregar — "#", mailto: e tel: passam como
// link, mas viravam `<img src="#">`, uma imagem sem tamanho.
export function enderecoDaImagem(valor) {
  const limpo = String(valor ?? '').trim();
  return /^(?:https?:\/\/|\/)\S/i.test(limpo) ? limpo : '';
}

function nomeDeCampo(valor) {
  const limpo = String(valor ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return limpo.slice(0, 60) || 'campo';
}

// O nome da resposta de uma pergunta de escolha: o que a pessoa escreveu, ou um derivado
// da identidade do nó — duas perguntas sem nome não podem cair na mesma resposta.
export function nomeDaEscolha(node) {
  const dado = String(node?.props?.name ?? '').trim();
  return dado ? nomeDeCampo(dado) : nomeDeCampo(`pergunta_${String(node?.id ?? '').slice(-12)}`);
}

// As classes dos contêineres, numa função só: o servidor desenha com elas e o editor (Puck)
// também — duas listas divergiriam.
const FUNDOS = { branco: '', suave: ' alva-secao-suave', escuro: ' alva-secao-escura' };
export const classeDaSecao = (props = {}) => `alva-secao${FUNDOS[props.fundo] ?? ''}${['p', 'g'].includes(props.respiro) ? ` alva-respiro-${props.respiro}` : ''}`;
export const classeDoConteudo = (props = {}) => `alva-conteudo${['p', 'g'].includes(props.espacamento) ? ` alva-espaco-${props.espacamento}` : ''}${props.alinhamento === 'centro' ? ' alva-conteudo-centro' : ''}`;

// O layout de cada bloco, como no Elementor: ocupa a linha inteira por padrão, e a pessoa
// escolhe a largura e o alinhamento. Movimento de entrada é opcional.
const COR = /^#[0-9a-f]{6}$/i;
const LARGURAS = Object.freeze({ inteira: '', '3/4': ' alva-l-3-4', '2/3': ' alva-l-2-3', '1/2': ' alva-l-1-2', '1/3': ' alva-l-1-3', '1/4': ' alva-l-1-4' });
const ALINHAMENTOS = Object.freeze({ esquerda: '', centro: ' alva-a-centro', direita: ' alva-a-direita' });
export const MOVIMENTOS = Object.freeze(['fade-up', 'slide-left', 'zoom-in']);
const ESCALA = Object.freeze({ p: 'p', m: 'm', g: 'g' });
// O que é ajuste fino (largura, movimento, margem) mora em `avancado`, que o editor mostra
// recolhido; páginas salvas antes, com essas props soltas, continuam valendo.
const ajustes = (props = {}) => ({ ...props, ...(props.avancado && typeof props.avancado === 'object' ? props.avancado : {}) });
export const classesDoBloco = (bruto = {}) => {
  const props = ajustes(bruto);
  const topo = ESCALA[props.espacoAcima] ? ` alva-m-topo-${props.espacoAcima}` : '';
  const base = ESCALA[props.espacoAbaixo] ? ` alva-m-base-${props.espacoAbaixo}` : '';
  return `alva-bloco${LARGURAS[props.largura] ?? ''}${ALINHAMENTOS[props.alinhamento] ?? ''}${topo}${base}`;
};
export const movimentoDoBloco = (bruto = {}) => { const props = ajustes(bruto); return MOVIMENTOS.includes(props.movimento) ? props.movimento : ''; };
// Seção que só aparece quando a VSL da página chega ao segundo escolhido (o preço, a
// oferta). O script da página (pagina-alva.js) é quem revela.
export const atributoDeRevelar = (props = {}) => {
  const segundo = Number(props.revelarNoSegundo);
  return Number.isInteger(segundo) && segundo >= 1 && segundo <= 86400 ? ` data-alva-revelar="${segundo}"` : '';
};
const atributoDeMovimento = (props) => (movimentoDoBloco(props) ? ` data-alva-motion="${movimentoDoBloco(props)}"` : '');

// A âncora da seção: o nome que o botão usa em "#contato" para rolar até ela. Só letra
// minúscula sem acento, número e hífen — o que cabe num id e num endereço sem escape.
// Digitando, o hífen do fim fica (é o espaço antes da próxima palavra); salvo, ele sai.
export function normalizarAncora(valor, { digitando = false } = {}) {
  const limpo = String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 40);
  return digitando ? limpo : limpo.replace(/-+$/, '');
}
const atributoDeAncora = (props = {}) => {
  const ancora = normalizarAncora(props.ancora);
  return ancora ? ` id="${ancora}"` : '';
};

// A identidade de cada bloco na página publicada: é o id do nó, o mesmo que o editor guarda
// e que sobrevive aos salvamentos. O tracker mede por ele (rolagem, tempo à vista, clique) e
// nunca lê o conteúdo do bloco. O formato é o que o coletor aceita (server/analytics-collect.mjs
// importa esta mesma expressão): um id que o servidor recusaria nem vira atributo.
// Sem id, sem atributo — o HTML de quem renderiza um nó solto continua o de sempre.
export const FORMATO_ID_DE_BLOCO = /^[A-Za-z0-9_-]{1,80}$/;
export const atributoDeBloco = (node) => (FORMATO_ID_DE_BLOCO.test(String(node?.id ?? '')) ? ` data-alva-bloco="${node.id}"` : '');

// Degradê: duas cores e uma direção.
const DIRECOES = Object.freeze({ vertical: '180deg', horizontal: '90deg', diagonal: '135deg' });
function fundoDeCores(cor, cor2, direcao) {
  if (COR.test(cor ?? '') && COR.test(cor2 ?? '')) return [`background-image:linear-gradient(${DIRECOES[direcao] ?? '180deg'},${cor},${cor2})`];
  return COR.test(cor ?? '') ? [`background-color:${cor}`] : [];
}

// O fundo livre da seção vira CSS dentro de um atributo: só entra cor no formato #rrggbb e
// imagem de endereço https sem aspas, parênteses ou espaço — qualquer um deles fecharia o
// url() e abriria CSS de quem digitou.
const IMAGEM_DE_FUNDO = /^(?:https:\/\/|\/i\/)[^\s"'()\\<>]{1,1000}$/i;
export function estiloDaSecao(props = {}) {
  const partes = [];
  // Imagem de fundo vence o degradê; a cor de fundo fica por baixo enquanto ela carrega.
  if (IMAGEM_DE_FUNDO.test(props.imagemDeFundo ?? '')) {
    if (COR.test(props.corDeFundo ?? '')) partes.push(`background-color:${props.corDeFundo}`);
    partes.push(`background-image:url("${props.imagemDeFundo}")`, 'background-size:cover', 'background-position:center');
  } else partes.push(...fundoDeCores(props.corDeFundo, props.corDeFundo2, props.direcaoDoDegrade));
  if (COR.test(props.corDoTexto ?? '')) partes.push(`color:${props.corDoTexto}`);
  return partes.join(';');
}

// O botão com cor própria ou degradê, e a cor do texto dele.
export function estiloDoBotao(props = {}) {
  const partes = fundoDeCores(props.corDoBotao, props.corDoBotao2, props.direcaoDoDegrade);
  if (COR.test(props.corDoTextoDoBotao ?? '')) partes.push(`color:${props.corDoTextoDoBotao}`);
  return partes.join(';');
}

// O link que a pessoa cola vira o endereço do player. Só YouTube (pelo domínio sem cookie
// de rastreamento) e Vimeo; o resto não é embutido.
export function enderecoDoVideo(bruto) {
  let url;
  try { url = new URL(String(bruto ?? '').trim()); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let youtube = null;
  if (host === 'youtu.be') youtube = url.pathname.slice(1);
  else if (host === 'youtube.com') youtube = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
  if (youtube && /^[A-Za-z0-9_-]{11}$/.test(youtube)) return `https://www.youtube-nocookie.com/embed/${youtube}`;
  const vimeo = host === 'vimeo.com' ? url.pathname.match(/^\/(\d{1,12})$/)?.[1] : null;
  return vimeo ? `https://player.vimeo.com/video/${vimeo}` : null;
}
// Colunas escolhidas por desenho. `quantidade` é das páginas salvas antes.
const ESTRUTURAS = Object.freeze({ '1/2+1/2': '', '1/3+2/3': ' alva-colunas-1-3-2-3', '2/3+1/3': ' alva-colunas-2-3-1-3', '1/3x3': ' alva-colunas-3' });
export const classeDasColunas = (props = {}) => `alva-colunas${ESTRUTURAS[props.estrutura] ?? (Number(props.quantidade) === 3 ? ' alva-colunas-3' : '')}`;

const ELEMENTOS = {
  section: {
    render: (node, desenharFilhos) => {
      const estilo = estiloDaSecao(node.props);
      return `<section class="${classeDaSecao(node.props)}"${atributoDeAncora(node.props)}${estilo ? ` style="${escapeHtml(estilo)}"` : ''}${atributoDeBloco(node)}${atributoDeMovimento(node.props)}${atributoDeRevelar(node.props)}><div class="${classeDoConteudo(node.props)}">${desenharFilhos(node)}</div></section>`;
    },
  },
  // A Linha: os blocos dentro dela dividem o espaço em partes iguais — soltar o segundo já
  // dá 50/50, o terceiro, três terços.
  row: {
    render: (node, desenharFilhos) => `<div class="alva-linha">${desenharFilhos(node)}</div>`,
  },
  columns: {
    render: (node, desenharFilhos) => `<div class="${classeDasColunas(node.props)}">${desenharFilhos(node)}</div>`,
  },
  heading: {
    render: (node) => {
      const nivel = [1, 2, 3].includes(Number(node.props.level)) ? Number(node.props.level) : 2;
      return `<h${nivel} class="alva-titulo">${escapeHtml(texto(node.props.text, 300))}</h${nivel}>`;
    },
  },
  text: {
    render: (node) => `<p class="alva-texto">${escapeHtml(texto(node.props.text))}</p>`,
  },
  button: {
    render: (node) => {
      const alvo = node.props.newTab === true ? ' target="_blank" rel="noopener noreferrer"' : '';
      const estilo = estiloDoBotao(node.props);
      return `<a href="${escapeHtml(endereco(node.props.href))}" class="cta"${estilo ? ` style="${escapeHtml(estilo)}"` : ''}${alvo}>${escapeHtml(texto(node.props.text, 200))}</a>`;
    },
  },
  icon: {
    render: (node) => `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(texto(node.props.name, 60) || 'star')}</span>`,
  },
  // Sem endereço, a imagem não sai: no editor ela é o lugar de escolher a imagem, na página
  // publicada não há o que mostrar (renderNode omite também a caixa).
  image: {
    render: (node) => {
      const src = enderecoDaImagem(node.props.src);
      return src ? `<img class="alva-imagem" src="${escapeHtml(src)}" alt="${escapeHtml(texto(node.props.alt, 300))}">` : '';
    },
  },
  video: {
    render: (node) => {
      const src = enderecoDoVideo(node.props.url);
      if (!src) return '<div class="alva-embed-video" data-alva-video-empty="true"><div class="alva-embed-video-placeholder">Cole o link do YouTube ou do Vimeo.</div></div>';
      return `<div class="alva-embed-video"><iframe src="${escapeHtml(src)}" title="${escapeHtml(texto(node.props.title, 200) || 'Vídeo')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    },
  },
  vsl: {
    // O nó carrega a referência; quem resolve o endereço do player é a publicação, que já
    // faz isso hoje procurando nós de tipo `vsl` na árvore salva.
    // `data-alva-vsl` é o marcador que a publicação troca pelo player; outro nome faria a
    // VSL sumir da página publicada sem erro.
    render: (node) => `<div class="alva-vsl" data-alva-vsl="${escapeHtml(texto(node.props.publicId, 80))}"><p class="alva-vsl-empty">VSL</p></div>`,
  },
  // A etapa do quiz: uma faixa como a seção, com a identidade que o runtime e a
  // ramificação usam para saber para onde ir.
  etapa: {
    render: (node, desenharFilhos) => {
      const estilo = estiloDaSecao(node.props);
      return `<section class="${classeDaSecao(node.props).replace('alva-secao', 'alva-secao alva-etapa')}" data-alva-etapa="${escapeHtml(texto(node.id, 80))}"${atributoDeBloco(node)}${estilo ? ` style="${escapeHtml(estilo)}"` : ''}><div class="${classeDoConteudo(node.props)}">${desenharFilhos(node)}</div></section>`;
    },
  },
  // A pergunta de escolha do quiz. Cada opção é um rótulo clicável com o input dentro; o
  // escolhido se distingue pelo `:has(input:checked)` da folha. A opção pode levar a outra
  // etapa (`data-alva-destino`), e a escolha única pode avançar sozinha (`data-alva-avanca`).
  escolha: {
    render: (node) => {
      const { pergunta, multipla, obrigatoria, avancar, colunas, opcoes } = node.props;
      const nome = escapeHtml(nomeDaEscolha(node));
      const tipo = multipla ? 'checkbox' : 'radio';
      const extras = `${obrigatoria ? ' required' : ''}${!multipla && avancar ? ' data-alva-avanca' : ''}`;
      const itens = opcoes.map((opcao) => `<label class="alva-opcao"><input type="${tipo}" name="${nome}" value="${escapeHtml(opcao.rotulo)}"${extras}${opcao.destino ? ` data-alva-destino="${escapeHtml(opcao.destino)}"` : ''}>`
        + (opcao.imagem ? `<img class="alva-opcao-imagem" src="${escapeHtml(opcao.imagem)}" alt="">` : '')
        + (opcao.icone ? `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(opcao.icone)}</span>` : '')
        + `<span class="alva-opcao-rotulo">${escapeHtml(opcao.rotulo)}</span></label>`).join('');
      return `<fieldset class="alva-escolha${Number(colunas) === 2 ? ' alva-escolha-grade' : ''}" data-alva-quiz-question${obrigatoria ? ' data-alva-quiz-required' : ''}>`
        + `<legend class="alva-escolha-pergunta">${escapeHtml(texto(pergunta, 300))}</legend><div class="alva-opcoes">${itens}</div></fieldset>`;
    },
  },
  field: {
    render: (node) => {
      const { label, name, fieldType, placeholder, required } = node.props;
      const obrigatorio = required === true ? ' required' : '';
      const campo = fieldType === 'long_text'
        ? `<textarea class="answer" name="${escapeHtml(name)}" placeholder="${escapeHtml(texto(placeholder, 200))}"${obrigatorio}></textarea>`
        : `<input class="answer" name="${escapeHtml(name)}" type="${escapeHtml(fieldType)}" placeholder="${escapeHtml(texto(placeholder, 200))}"${obrigatorio}>`;
      return `<label class="answer-wrap">${escapeHtml(texto(label, 200))}${campo}</label>`;
    },
  },
  form: {
    // `data-alva-capture-id` é como a publicação liga o formulário à captura; `.alva-form` é
    // a folha de formulário que já existe.
    render: (node, desenharFilhos) => `<form class="alva-form" data-alva-capture-id="${escapeHtml(texto(node.id, 80))}" action="#" method="post">${desenharFilhos(node)}<button type="submit" class="cta">${escapeHtml(texto(node.props.submitLabel, 120) || 'Enviar')}</button>${avisoDePrivacidade(node.props)}</form>`,
  },
};

export const PAGE_NODE_TYPES = Object.freeze(Object.keys(ELEMENTOS));

export function normalizeNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw falhar('Elemento inválido.');
  const type = String(node.type ?? '');
  if (!Object.hasOwn(ELEMENTOS, type)) throw falhar(`Tipo de elemento desconhecido: “${type}”.`);
  const props = node.props && typeof node.props === 'object' && !Array.isArray(node.props) ? { ...node.props } : {};
  // Só quando existe: a seção salva antes da âncora continua igual.
  if (type === 'section' && props.ancora !== undefined) props.ancora = normalizarAncora(props.ancora);
  if (type === 'field') {
    // O tipo de resposta é recusado aqui, na origem, e não na hora de publicar. Era assim
    // que "Data" chegava à publicação para ser recusada com a página inteira já montada.
    const fieldType = String(props.fieldType ?? 'text');
    if (!FIELD_TYPES.has(fieldType)) throw falhar(`Tipo de resposta não suportado: “${fieldType}”.`);
    props.fieldType = fieldType;
    props.name = nomeDeCampo(props.name || props.label);
    props.required = props.required === true;
  }
  if (type === 'escolha') {
    props.pergunta = texto(props.pergunta, 300);
    props.multipla = props.multipla === true;
    props.obrigatoria = props.obrigatoria === true;
    props.avancar = props.avancar === true;
    props.opcoes = (Array.isArray(props.opcoes) ? props.opcoes : []).slice(0, 20).map((bruta) => {
      const opcao = bruta && typeof bruta === 'object' ? bruta : {};
      const limpa = { rotulo: texto(opcao.rotulo, 120).trim() };
      const icone = texto(opcao.icone, 60).trim();
      if (icone) limpa.icone = icone;
      if (IMAGEM_DE_FUNDO.test(String(opcao.imagem ?? ''))) limpa.imagem = String(opcao.imagem);
      const destino = String(opcao.destino ?? '').trim();
      if (/^[a-zA-Z0-9_-]{1,80}$/.test(destino)) limpa.destino = destino;
      return limpa;
    }).filter((opcao) => opcao.rotulo);
  }
  return {
    ...(node.id ? { id: String(node.id).slice(0, 80) } : {}),
    type,
    props,
    children: Array.isArray(node.children) ? node.children.map(normalizeNode) : [],
  };
}

// Seção é a faixa da página, e campo mora dentro do formulário: os dois não entram no
// layout de bloco. Todo o resto ganha a caixa com largura e alinhamento.
const SEM_CAIXA = new Set(['section', 'etapa', 'field']);

// O miolo de um bloco, sem a caixa de layout — é o que o editor desenha dentro da caixa
// dele, para o Puck poder arrastar a caixa inteira.
export function renderConteudo(node, profundidade = 0) {
  if (profundidade > PROFUNDIDADE_MAXIMA) throw falhar('Estrutura da página profunda demais.');
  const limpo = normalizeNode(node);
  const elemento = ELEMENTOS[limpo.type];
  const desenharFilhos = (atual) => atual.children.map((filho) => renderNode(filho, profundidade + 1)).join('');
  if (!limpo.children.length && elemento.vazio) return elemento.vazio;
  return elemento.render(limpo, desenharFilhos);
}

export function renderNode(node, profundidade = 0) {
  const miolo = renderConteudo(node, profundidade);
  if (SEM_CAIXA.has(node?.type)) return miolo;
  if (node?.type === 'image' && !miolo) return '';
  const props = node?.props ?? {};
  return `<div class="${classesDoBloco(props)}"${atributoDeBloco(node)}${atributoDeMovimento(props)}>${miolo}</div>`;
}

export function renderTree(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => renderNode(node)).join('');
}

// Descobrir os formulários de uma página.
//
// Isto era um caminhador escrito contra a forma de nó do GrapesJS: procurava `<input>`
// dentro de `tagName`/`components`/`attributes`, e por isso qualquer troca de editor o
// quebrava. Com o esquema do Alva, um campo é um nó de tipo `field` dentro de um nó de
// tipo `form` — a descoberta vira uma caminhada pela árvore, e deixa de depender de quem
// produziu a marcação.
//
// Um campo fora de formulário não é captura: é decoração. Cobrá-lo como resposta repetiria
// o defeito do elemento decorativo obrigatório, que exigia resposta de algo que a pessoa
// não tem como enviar.
export function extrairCapturas(nodes) {
  const capturas = [];
  const percorrer = (lista, tituloAcima) => {
    let ultimoTitulo = tituloAcima;
    for (const bruto of Array.isArray(lista) ? lista : []) {
      const node = normalizeNode(bruto);
      if (node.type === 'heading') { ultimoTitulo = texto(node.props.text, 200); continue; }
      if (node.type === 'form') {
        // Sem identificador, as respostas chegam sem dizer de qual formulário vieram — e
        // numa página com dois, viram respostas do formulário errado.
        if (!node.id) throw falhar('O formulário da página precisa de um identificador estável.');
        capturas.push({
          id: node.id,
          name: ultimoTitulo || 'Formulário',
          fields: camposDe(node).map((campo) => ({
            name: campo.props.name,
            label: texto(campo.props.label, 200),
            type: campo.props.fieldType,
            required: campo.props.required === true,
          })),
        });
        continue;
      }
      percorrer(node.children, ultimoTitulo);
    }
  };
  percorrer(nodes, '');
  return capturas;
}

function camposDe(node) {
  const encontrados = [];
  const descer = (atual) => {
    for (const filho of atual.children) {
      if (filho.type === 'field') encontrados.push(filho);
      else descer(filho);
    }
  };
  descer(node);
  return encontrados;
}
