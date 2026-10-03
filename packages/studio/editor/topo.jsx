// A barra de cima do editor. Da esquerda para a direita: a marca da Alva; voltar e o nome da
// página; e, à direita, desfazer/refazer e as ações (Salvar, Prévia, Publicar…).
// Os botões de esconder os menus laterais saem daqui e vão para as pontas da faixa de ícones
// acima da página (AlcasDoCanvas): é lá que a pessoa olha quando quer mais espaço, e cada um
// fica do lado do menu que esconde.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createUsePuck } from '@puckeditor/core';
import { ArrowLeft, PanelLeft, PanelRight, Redo2, Undo2 } from './icones.jsx';
import { MARCA_ALVA } from './marca-alva.js';

const usePuck = createUsePuck();

function Marca() {
  return (
    <a className="alva-marca" href="/" aria-label="Alva Studio">
      <svg className="alva-marca-simbolo" aria-hidden="true" viewBox="0 0 720.5 1000"><path fill="currentColor" fillRule="evenodd" d={MARCA_ALVA} /></svg>
      <strong>ALVA</strong>
      <span>Studio</span>
    </a>
  );
}

function DesfazerRefazer() {
  const historico = usePuck((estado) => estado.history);
  return (
    <div className="alva-historico" role="group" aria-label="Desfazer e refazer">
      <button type="button" className="alva-acao alva-acao-icone" title="Desfazer" aria-label="Desfazer" disabled={!historico.hasPast} onClick={() => historico.back()}>
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button type="button" className="alva-acao alva-acao-icone" title="Refazer" aria-label="Refazer" disabled={!historico.hasFuture} onClick={() => historico.forward()}>
        <Redo2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

// Esconde ou mostra um dos menus. Em tela estreita o Puck esconde o outro junto, para não
// espremer a página: a regra é a mesma do botão que ele traz.
function useAlternarMenu() {
  const dispatch = usePuck((estado) => estado.dispatch);
  const ui = usePuck((estado) => estado.appState.ui);
  return (lado) => {
    const largo = window.matchMedia('(min-width: 638px)').matches;
    const chave = `${lado}SideBarVisible`;
    const oposta = lado === 'left' ? 'rightSideBarVisible' : 'leftSideBarVisible';
    dispatch({ type: 'setUi', ui: { [chave]: !ui[chave], ...(largo ? {} : { [oposta]: false }) } });
  };
}

// A faixa de ícones acima da página é do Puck; os botões entram nela por um portal.
const FAIXA = '[class*="PuckCanvas-controls"]';
export function AlcasDoCanvas() {
  const alternar = useAlternarMenu();
  const ui = usePuck((estado) => estado.appState.ui);
  const [faixa, setFaixa] = useState(null);
  const atual = useRef(null);
  useEffect(() => {
    const procurar = () => {
      if (atual.current?.isConnected) return;
      atual.current = document.querySelector(FAIXA);
      setFaixa(atual.current);
    };
    procurar();
    const observador = new MutationObserver(procurar);
    observador.observe(document.body, { childList: true, subtree: true });
    return () => observador.disconnect();
  }, []);
  if (!faixa) return null;
  return createPortal(
    <>
      <button type="button" className="alva-alca-menu alva-alca-menu-esquerda" aria-pressed={ui.leftSideBarVisible !== false} title="Mostrar ou esconder o menu da esquerda" aria-label="Mostrar ou esconder o menu da esquerda" onClick={() => alternar('left')}>
        <PanelLeft size={18} aria-hidden="true" />
      </button>
      <button type="button" className="alva-alca-menu alva-alca-menu-direita" aria-pressed={ui.rightSideBarVisible !== false} title="Mostrar ou esconder o menu da direita" aria-label="Mostrar ou esconder o menu da direita" onClick={() => alternar('right')}>
        <PanelRight size={18} aria-hidden="true" />
      </button>
    </>,
    faixa,
  );
}

export function Cabecalho({ nome, aoVoltar, acoes }) {
  return (
    <header className="alva-topo">
      <div className="alva-topo-pagina">
        <Marca />
        <button type="button" className="alva-acao alva-acao-icone alva-voltar" aria-label="Voltar para as páginas" title="Voltar" onClick={aoVoltar}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <h1 className="alva-topo-nome" title={nome}>{nome}</h1>
      </div>
      <div className="alva-topo-acoes">
        <DesfazerRefazer />
        {acoes}
      </div>
      <AlcasDoCanvas />
    </header>
  );
}
