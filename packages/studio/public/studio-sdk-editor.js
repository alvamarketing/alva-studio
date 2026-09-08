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

// O SDK vem todo em inglês, e "Layers", "Traits" ou "Selectors" não dizem nada para quem
// monta uma página e não é da área. As chaves são as do dicionário do próprio pacote;
// sobrescrever o 'en' troca os rótulos sem depender de um locale que talvez não exista.
export function traducaoDoEditor() {
  return {
    actions: {
      componentOutline: { title: 'Contornos' },
      preview: { title: 'Prévia' },
      fullscreen: { title: 'Tela cheia' },
      showCode: { title: 'Código', exportButton: 'Baixar em ZIP' },
      undo: { title: 'Desfazer' },
      redo: { title: 'Refazer' },
      save: { title: 'Salvar' },
      store: { title: 'Salvar conteúdo' },
      open: { title: 'Abrir projeto' },
      editCode: { title: 'Editar código', noChanges: 'Nada mudou para atualizar', button: 'Atualizar' },
      importCode: {
        title: 'Importar código',
        parseError: 'Não foi possível ler o código',
        content: 'Cole aqui o HTML e o CSS e clique em importar',
        button: 'Importar',
      },
      clearCanvas: { title: 'Limpar página', content: 'Você tem certeza de que quer apagar tudo desta página?' },
      about: { title: 'Sobre' },
    },
    pageManager: {
      pages: 'Páginas',
      page: 'Página',
      newPage: 'Nova página',
      add: 'Adicionar página',
      rename: 'Renomear',
      duplicate: 'Duplicar',
      copy: 'Copiar',
      delete: 'Excluir',
      deletePage: 'Excluir página',
      confirmDelete: 'Você tem certeza de que quer excluir esta página?',
      homePage: 'Página inicial',
    },
    blockManager: {
      notFound: 'Nenhum elemento encontrado',
      blocks: 'Elementos',
      add: 'Adicionar mais elementos',
      search: 'Buscar…',
    },
    layerManager: { layers: 'Camadas' },
    styleManager: {
      empty: 'Selecione um elemento na página para mudar a aparência dele.',
      notFound: 'Nada para ajustar aqui',
      panelLabel: 'Aparência',
    },
    traitManager: {
      empty: 'Selecione um elemento na página para ver o conteúdo dele.',
      notFound: 'Nada para preencher aqui',
      panelLabel: 'Conteúdo',
    },
    selectorManager: {
      noSelecton: 'Nada selecionado ainda.',
      selectFromCanvas: 'Clique em algo na página para começar a editar.',
      selectFromList: 'Ou escolha um estilo pronto no catálogo.',
      selectCustom: 'Adicione um estilo seu.',
      selection: 'Selecionado',
      selector: 'Estilo',
      addNewSelector: 'Novo estilo',
      removeSelector: 'Remover estilo',
      target: 'Alvo',
      device: 'Tela',
      state: 'Situação',
      deleteStyle: 'Excluir estilo',
      noSelectors: 'Nenhum estilo aplicado',
      noComponents: 'Nenhum elemento selecionado',
      currentSelection: 'O elemento de onde vêm os ajustes mostrados',
    },
    assetManager: { images: 'Imagens', addImage: 'Adicionar imagem', search: 'Buscar…' },
  };
}

// O layout do SDK monta a tela inteira, barra de cima incluída: definir o layout sem ela
// faz a barra sumir junto com dispositivos, desfazer e prévia, que são usados o tempo
// todo. Aqui ela volta enxuta — o que se usa fica à mão, o resto vai para o menu.
export function layoutDoEditor() {
  return {
    type: 'column',
    style: { height: '100%' },
    children: [
      {
        type: 'row',
        style: {
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          borderBottom: '1px solid var(--alva-line, #e1e7ef)',
        },
        children: [
          { type: 'devices', style: { width: '180px', flexShrink: 0 } },
          { type: 'button', id: 'undo', icon: 'arrowULeftTop', tooltip: 'Desfazer', onClick: ({ editor }) => editor.runCommand('core:undo') },
          { type: 'button', id: 'redo', icon: 'arrowURightTop', tooltip: 'Refazer', onClick: ({ editor }) => editor.runCommand('core:redo') },
          { type: 'row', grow: true, children: [] },
          { type: 'button', id: 'preview', icon: 'eye', tooltip: 'Prévia', onClick: ({ editor }) => editor.runCommand('studio:preview') },
          {
            type: 'buttonMenu',
            id: 'mais',
            label: 'Mais',
            tooltip: 'Mais opções',
            options: [
              { id: 'code', label: 'Ver o código' },
              { id: 'fullscreen', label: 'Tela cheia' },
              { id: 'clear', label: 'Limpar a página' },
            ],
            onOptionSelect: ({ option, editor }) => {
              if (option?.id === 'code')
                editor.runCommand('studio:layoutToggle', {
                  id: 'code',
                  layout: 'panelEditCode',
                  placer: { type: 'dialog', title: 'Código da página', size: 'l' },
                });
              if (option?.id === 'fullscreen') editor.runCommand('studio:fullscreen');
              if (option?.id === 'clear') editor.runCommand('studio:canvasClear');
            },
          },
        ],
      },
      {
        type: 'row',
        grow: true,
        children: [
          { type: 'panelPagesLayers', header: { label: 'Estrutura da página' }, style: { width: '272px' } },
          { type: 'canvas' },
          { type: 'panelSidebarTabs', style: { width: '300px' } },
        ],
      },
    ],
  };
}

// As categorias de estilo vêm do código do SDK, não do dicionário: ficavam em inglês e
// todas fechadas, obrigando a abrir uma por uma para achar o ajuste.
export const NOMES_DE_SETOR = {
  general: 'Geral',
  layout: 'Disposição',
  flex: 'Alinhamento',
  dimension: 'Tamanho',
  size: 'Tamanho',
  space: 'Espaçamento',
  position: 'Posição',
  typography: 'Texto',
  decorations: 'Bordas e sombra',
  background: 'Fundo',
  borders: 'Bordas',
  effects: 'Efeitos',
  extra: 'Avançado',
};

// Quem clica num título quer mexer no texto; quem clica numa seção, no fundo. Abrir a
// categoria certa poupa a pessoa de caçar entre oito seções fechadas.
export function setorPrioritario(tag) {
  const nome = String(tag || '').toLowerCase();
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'label', 'small', 'li'].includes(nome)) return 'typography';
  if (['section', 'div', 'main', 'header', 'footer', 'article', 'aside'].includes(nome)) return 'background';
  if (['img', 'video', 'iframe'].includes(nome)) return 'dimension';
  return null;
}

// Os setores do SDK vêm com prefixo — gs-typography, gs-background — e o do GrapesJS
// puro, sem. Normalizar aqui deixa o mapa de nomes valer nos dois.
export const idDoSetor = (id) => String(id || '').replace(/^gs-/, '');

export function aparenciaPlugin(editor) {
  const renomear = () => {
    for (const setor of editor.StyleManager.getSectors()) {
      const traduzido = NOMES_DE_SETOR[idDoSetor(setor.get('id'))];
      if (traduzido) setor.set('name', traduzido);
    }
  };
  const priorizar = () => {
    const alvo = setorPrioritario(editor.getSelected()?.get?.('tagName'));
    if (!alvo) return;
    for (const setor of editor.StyleManager.getSectors()) setor.set('open', idDoSetor(setor.get('id')) === alvo);
  };
  if (editor.onReady) editor.onReady(renomear);
  else renomear();
  editor.on('component:selected', priorizar);
}

export function studioEditorOptions({ pageId, nomeDaPagina = '', carregar, salvar, root = '#studio-sdk-root' } = {}) {
  return {
    root,
    licenseKey: '',
    customTheme: alvaStudioTheme(),
    project: { type: 'web' },
    plugins: [alvaStylePlugin, aparenciaPlugin],
    i18n: { locales: { en: traducaoDoEditor() } },
    layout: { default: layoutDoEditor() },
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
