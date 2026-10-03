// O painel "Estrutura" do contrato visual (docs/wireframes/alva-studio-ui-reference.html,
// seção "Estrutura"): uma árvore só, com o nome que a pessoa reconhece em cada seção, ícone
// por tipo, contador de elementos, "+ Elemento" na seção ativa e "+ Nova seção" no fim.
// Substitui o Outline do Puck, que mostrava nomes internos como "default-zone".
import { useState } from 'react';
import { createUsePuck } from '@puckeditor/core';
import { GripVertical } from 'lucide-react';
import { ICONE_DO_BLOCO } from './icones.jsx';
import { SLOT } from '../public/puck-conversao.js';

const usePuck = createUsePuck();
const RAIZ = `root:${SLOT}`;
const BLOCOS_DO_MAIS = ['heading', 'text', 'button', 'image', 'icon', 'video', 'row', 'form'];
const BLOCOS_DO_MAIS_NO_QUIZ = ['escolha', 'field', 'heading', 'text', 'button', 'image', 'icon', 'video'];

const curto = (texto, limite = 30) => {
  const limpo = String(texto ?? '').replace(/<[^>]*>/g, '').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
};
const filhos = (item) => (Array.isArray(item?.props?.[SLOT]) ? item.props[SLOT] : []);
const primeiroTitulo = (item) => {
  for (const filho of filhos(item)) {
    if (filho.type === 'heading' && curto(filho.props.text)) return curto(filho.props.text);
    if (filho.type === 'escolha' && curto(filho.props.pergunta)) return curto(filho.props.pergunta);
    const dentro = primeiroTitulo(filho);
    if (dentro) return dentro;
  }
  return '';
};
const contem = (item, id) => filhos(item).some((filho) => filho.props.id === id || contem(filho, id));

export function Estrutura({ quiz = false }) {
  const dados = usePuck((estado) => estado.appState.data);
  const selecionado = usePuck((estado) => estado.selectedItem?.props?.id);
  const dispatch = usePuck((estado) => estado.dispatch);
  const config = usePuck((estado) => estado.config);
  const [menu, setMenu] = useState(false);
  const [arrastando, setArrastando] = useState(null);
  const secoes = dados.root?.props?.[SLOT] ?? [];
  const rotulo = (item) => config.components[item.type]?.label ?? item.type;
  const nome = (item, nivel) => {
    if (item.type === 'heading') return curto(item.props.text) || rotulo(item);
    if (item.type === 'escolha') return curto(item.props.pergunta) || rotulo(item);
    // O campo aparece pela pergunta ("E-mail"), não como "Campo do formulário" repetido.
    if (item.type === 'field') return curto(item.props.label) || rotulo(item);
    if (nivel === 0) return primeiroTitulo(item) || rotulo(item);
    return rotulo(item);
  };
  const selecionar = (zone, index) => dispatch({ type: 'setUi', ui: { itemSelector: { zone, index }, rightSideBarVisible: true } });
  const inserir = (componentType, zone, index) => {
    dispatch({ type: 'insert', componentType, destinationZone: zone, destinationIndex: index });
    selecionar(zone, index);
    setMenu(false);
  };
  const soltar = (zone, index) => (evento) => {
    evento.preventDefault();
    if (arrastando && arrastando.zone === zone && arrastando.index !== index) {
      dispatch({ type: 'reorder', sourceIndex: arrastando.index, destinationIndex: index, destinationZone: zone });
      selecionar(zone, index);
    }
    setArrastando(null);
  };

  const linha = (item, zone, index, nivel) => {
    const Icone = ICONE_DO_BLOCO[item.type];
    const lista = filhos(item);
    const ativa = item.props.id === selecionado || (nivel === 0 && contem(item, selecionado));
    return (
      <div
        key={item.props.id}
        role="treeitem"
        aria-level={nivel + 1}
        aria-selected={item.props.id === selecionado}
        tabIndex={0}
        draggable
        className={`alva-arvore-linha${nivel === 0 ? ' alva-arvore-pai' : ''}${ativa ? ' alva-arvore-ativa' : ''}${arrastando?.zone === zone && arrastando.index === index ? ' alva-arvore-arrastando' : ''}`}
        style={{ paddingLeft: 8 + nivel * 20 }}
        onClick={() => selecionar(zone, index)}
        onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); selecionar(zone, index); } }}
        onDragStart={(evento) => { evento.dataTransfer.effectAllowed = 'move'; setArrastando({ zone, index }); }}
        onDragOver={(evento) => { if (arrastando?.zone === zone) evento.preventDefault(); }}
        onDrop={soltar(zone, index)}
        onDragEnd={() => setArrastando(null)}
      >
        <GripVertical size={16} className="alva-arvore-alca" aria-hidden="true" />
        {Icone ? <Icone size={18} className="alva-arvore-icone" aria-hidden="true" /> : <span />}
        <span className="alva-arvore-nome">{nome(item, nivel)}</span>
        {lista.length ? <small>{lista.length}</small> : <span />}
      </div>
    );
  };

  const galho = (item, index, nivel, zone) => [
    linha(item, zone, index, nivel),
    ...filhos(item).flatMap((filho, i) => galho(filho, i, nivel + 1, `${item.props.id}:${SLOT}`)),
  ];

  return (
    <div className="alva-estrutura">
      <div className="alva-eyebrow">Página</div>
      <h2>Estrutura</h2>
      <p className="alva-ajuda">{quiz ? 'Cada etapa aparece sozinha para quem responde. A última é a tela final.' : 'Organize seções e elementos em uma única árvore.'}</p>
      <div role="tree" aria-label="Estrutura da página" className="alva-arvore">
        {secoes.map((secao, index) => {
          const ativa = secao.props.id === selecionado || contem(secao, selecionado);
          const zona = `${secao.props.id}:${SLOT}`;
          return (
            <div key={secao.props.id} role="group" className="alva-arvore-grupo">
              {galho(secao, index, 0, RAIZ)}
              {ativa ? (
                <div className="alva-arvore-mais">
                  <button type="button" className="alva-botao-tracejado" aria-expanded={menu} onClick={() => setMenu(!menu)}>+ Elemento</button>
                  {menu ? (
                    <div className="alva-arvore-menu" role="menu">
                      {(quiz ? BLOCOS_DO_MAIS_NO_QUIZ : BLOCOS_DO_MAIS).filter((tipo) => config.components[tipo]).map((tipo) => {
                        const Icone = ICONE_DO_BLOCO[tipo];
                        return (
                          <button key={tipo} type="button" role="menuitem" onClick={() => inserir(tipo, zona, filhos(secao).length)}>
                            {Icone ? <Icone size={16} aria-hidden="true" /> : null}{rotulo({ type: tipo })}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="alva-botao-tracejado" onClick={() => inserir(quiz ? 'etapa' : 'section', RAIZ, secoes.length)}>{quiz ? '+ Nova etapa' : '+ Nova seção'}</button>
    </div>
  );
}
