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

export function studioEditorOptions({ pageId, carregar, salvar, root = '#studio-sdk-root' } = {}) {
  return {
    root,
    licenseKey: '',
    customTheme: alvaStudioTheme(),
    project: { type: 'web' },
    storage: {
      type: 'self',
      autosaveChanges: 8,
      onLoad: async () => {
        const projeto = await carregar(pageId);
        return { project: projeto?.pages?.length ? projeto : PAGINA_INICIAL };
      },
      onSave: async ({ project, editor }) => {
        const html = editor?.getHtml?.() ?? '';
        const css = editor?.getCss?.() ?? '';
        await salvar(pageId, project, { html, css });
      },
    },
  };
}
