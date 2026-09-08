import { runtimeCss, templateCss } from './templates.js';

// O editor do GrapesJS Studio vestido com a cara do Alva.
//
// O SDK traz a interface pronta que faltava — camadas, páginas, upload, estilo por
// seletor — mas vem com a paleta deles. Aqui ele recebe as mesmas cores, cantos e
// distâncias do resto do sistema, para não parecer outro produto dentro do produto.
// E guarda tudo no nosso banco: o conteúdo continua sendo nosso.

const ALVA = {
  azul: '#286eea',
  azulClaro: '#5b8cff',
  azulForte: '#1d5ac4',
  branco: '#ffffff',
  nuvem: '#f6f8fb',
  realce: '#edf4ff',
  tinta: '#101828',
  suave: '#667085',
  linha: '#e1e7ef',
};

export function alvaStudioTheme() {
  return {
    default: {
      colors: {
        global: {
          background1: ALVA.branco,
          background2: ALVA.nuvem,
          background3: ALVA.realce,
          backgroundHover: ALVA.realce,
          text: ALVA.tinta,
          border: ALVA.linha,
          focus: ALVA.azulClaro,
          placeholder: ALVA.suave,
        },
        primary: {
          background1: ALVA.azul,
          background2: ALVA.realce,
          background3: ALVA.nuvem,
          backgroundHover: ALVA.azulForte,
          text: ALVA.branco,
        },
        component: {
          background1: ALVA.azul,
          background2: ALVA.azulClaro,
          background3: ALVA.realce,
          backgroundHover: ALVA.azulForte,
          text: ALVA.branco,
        },
        selected: {
          background1: ALVA.azul,
          backgroundHover: ALVA.azulForte,
          text: ALVA.branco,
        },
      },
    },
  };
}

// Página nova não pode cair num canvas vazio: a pessoa abre e não sabe o que fazer.
const PAGINA_INICIAL = {
  pages: [{ name: 'Página', component: '<section><h1>Sua nova página</h1><p>Clique para editar este texto.</p></section>' }],
};

// Gráfico, formulário e carrossel só têm forma com o CSS que os desenha; sem ele o bloco
// entra na página como uma pilha de texto.
export function alvaStylePlugin(editor) {
  const aplicar = () => editor.setStyle(`${templateCss}\n${runtimeCss}\n${editor.getCss?.() || ''}`);
  if (editor.onReady) editor.onReady(aplicar);
  else aplicar();
}

export function studioEditorOptions({ pageId, nomeDaPagina = '', carregar, salvar, root = '#studio-sdk-root' } = {}) {
  return {
    root,
    licenseKey: '',
    customTheme: alvaStudioTheme(),
    project: { type: 'web' },
    plugins: [alvaStylePlugin],
    storage: {
      type: 'self',
      autosaveChanges: 8,
      onLoad: async () => {
        const projeto = await carregar(pageId);
        if (!projeto?.pages?.length) return { project: PAGINA_INICIAL };
        // Sem nome, o gerenciador de páginas do SDK mostra o identificador cru e a
        // pessoa não reconhece a própria página. Quem já tem nome mantém o seu.
        const pages = projeto.pages.map((pagina, indice) => (
          pagina.name || !nomeDaPagina ? pagina : { ...pagina, name: indice ? `${nomeDaPagina} ${indice + 1}` : nomeDaPagina }
        ));
        return { project: { ...projeto, pages } };
      },
      onSave: async ({ project, editor }) => {
        const html = editor?.getHtml?.() ?? '';
        const css = editor?.getCss?.() ?? '';
        await salvar(pageId, project, { html, css });
      },
    },
  };
}
