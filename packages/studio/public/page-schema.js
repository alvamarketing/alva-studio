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

function nomeDeCampo(valor) {
  const limpo = String(valor ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return limpo.slice(0, 60) || 'campo';
}

const ELEMENTOS = {
  section: {
    render: (node, desenharFilhos) => `<section class="alva-secao">${desenharFilhos(node)}</section>`,
    vazio: '<section class="alva-secao"></section>',
  },
  columns: {
    render: (node, desenharFilhos) => `<div class="alva-colunas">${desenharFilhos(node)}</div>`,
    vazio: '<div class="alva-colunas"></div>',
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
      return `<a href="${escapeHtml(endereco(node.props.href))}" class="cta"${alvo}>${escapeHtml(texto(node.props.text, 200))}</a>`;
    },
  },
  icon: {
    render: (node) => `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(texto(node.props.name, 60) || 'star')}</span>`,
  },
  image: {
    render: (node) => {
      const src = escapeHtml(endereco(node.props.src));
      return `<img class="alva-imagem" src="${src}" alt="${escapeHtml(texto(node.props.alt, 300))}">`;
    },
  },
  vsl: {
    // O nó carrega a referência; quem resolve o endereço do player é a publicação, que já
    // faz isso hoje procurando nós de tipo `vsl` na árvore salva.
    render: (node) => `<div class="alva-vsl" data-vsl-id="${escapeHtml(texto(node.props.vslId, 80))}"></div>`,
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
    render: (node, desenharFilhos) => `<form class="alva-formulario">${desenharFilhos(node)}<button type="submit" class="cta">${escapeHtml(texto(node.props.submitLabel, 120) || 'Enviar')}</button></form>`,
    vazio: '<form class="alva-formulario"><button type="submit" class="cta">Enviar</button></form>',
  },
};

export const PAGE_NODE_TYPES = Object.freeze(Object.keys(ELEMENTOS));

export function normalizeNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw falhar('Elemento inválido.');
  const type = String(node.type ?? '');
  if (!Object.hasOwn(ELEMENTOS, type)) throw falhar(`Tipo de elemento desconhecido: “${type}”.`);
  const props = node.props && typeof node.props === 'object' && !Array.isArray(node.props) ? { ...node.props } : {};
  if (type === 'field') {
    // O tipo de resposta é recusado aqui, na origem, e não na hora de publicar. Era assim
    // que "Data" chegava à publicação para ser recusada com a página inteira já montada.
    const fieldType = String(props.fieldType ?? 'text');
    if (!FIELD_TYPES.has(fieldType)) throw falhar(`Tipo de resposta não suportado: “${fieldType}”.`);
    props.fieldType = fieldType;
    props.name = nomeDeCampo(props.name || props.label);
    props.required = props.required === true;
  }
  return {
    ...(node.id ? { id: String(node.id).slice(0, 80) } : {}),
    type,
    props,
    children: Array.isArray(node.children) ? node.children.map(normalizeNode) : [],
  };
}

export function renderNode(node, profundidade = 0) {
  if (profundidade > PROFUNDIDADE_MAXIMA) throw falhar('Estrutura da página profunda demais.');
  const limpo = normalizeNode(node);
  const elemento = ELEMENTOS[limpo.type];
  const desenharFilhos = (atual) => atual.children.map((filho) => renderNode(filho, profundidade + 1)).join('');
  if (!limpo.children.length && elemento.vazio) return elemento.vazio;
  return elemento.render(limpo, desenharFilhos);
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
