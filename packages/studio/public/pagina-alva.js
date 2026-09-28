// A página no esquema do Alva: o estado que o editor salva, o documento que vai ao ar e os
// formulários que a publicação valida. Roda no servidor (salvar e publicar) e no editor
// (pré-visualização) — um desenhador só, para o que se vê editando ser o que vai ao ar.
import { extrairCapturas, normalizeNode, renderTree, escapeHtml } from './page-schema.js';
import { elementosCss } from './catalogo-elementos.js';
import { runtimeCss, templateCss } from './templates.js';
import { materialSymbolsFontCss } from './quiz-elements.js';

export const FORMATO_ALVA = 'alva/1';
export const ehEstadoAlva = (estado) => estado?.formato === FORMATO_ALVA;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const novoId = () => globalThis.crypto.randomUUID();

// O estado limpo: cada nó normalizado, e cada formulário com um identificador estável e
// único — é por ele que a resposta publicada diz de qual formulário veio.
export function normalizarEstadoAlva(estado, uuid = novoId) {
  const vistos = new Set();
  const garantir = (node) => {
    const limpo = normalizeNode(node);
    if (limpo.type === 'form') {
      limpo.id = UUID.test(limpo.id ?? '') && !vistos.has(limpo.id) ? limpo.id : uuid();
      vistos.add(limpo.id);
    }
    return { ...limpo, children: limpo.children.map(garantir) };
  };
  const titulo = String(estado?.root?.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  return {
    formato: FORMATO_ALVA,
    root: { title: titulo },
    content: (Array.isArray(estado?.content) ? estado.content : []).map(garantir),
  };
}

export function documentoDaPagina(estado, { publicOrigin = '' } = {}) {
  const limpo = normalizarEstadoAlva(estado, () => { throw new Error('Estado sem identificadores: normalize antes de desenhar.'); });
  const folhas = materialSymbolsFontCss(publicOrigin) + runtimeCss + templateCss + elementosCss;
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap">'
    + `<title>${escapeHtml(limpo.root.title)}</title><style>${folhas}</style></head>`
    + `<body><main class="alva-pagina">${renderTree(limpo.content)}</main></body></html>`;
}

// O tipo de resposta do esquema no vocabulário que a validação da captura usa.
const TIPO_DA_CAPTURA = Object.freeze({ text: 'text', email: 'email', tel: 'short_text', number: 'number', date: 'date', file: 'file', long_text: 'long_text' });

export function capturasDoEstado(estado, { webhook = '' } = {}) {
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
