// A tela de um funil (aba Funis): o desenho com React Flow, a paleta de etapas e o painel
// da etapa escolhida. As etapas que viram página ganham o botão que abre a página no editor
// de landing — ou que cria a página, já com os botões apontando para a etapa seguinte.
//
// Não há seção do wireframe para esta tela (docs/wireframes/alva-studio-ui-reference.html);
// ela usa os tokens da "Biblioteca visual" (/tokens.css) e os padrões do editor de landing.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, BookOpen, LayoutGrid, CalendarClock, CircleCheck, CircleDot, CircleX, ClipboardList, CreditCard, ExternalLink, FilePlus2, FileText,
  Handshake, Mail, Megaphone, MessageCircle, MousePointerClick, Plus, Save, Send, ShoppingCart, StickyNote, Trash2, TrendingDown, TrendingUp,
  UserCheck, Users, Video, Wallet, Database, Trophy, Camera, Search, Share2, PartyPopper,
} from 'lucide-react';
import { TIPOS_DE_ETAPA, etapaViraPagina, tipoDaEtapa } from '../public/funis-etapas.js';
import { normalizarGrafo, organizarGrafo } from '../public/funil.js';

const ICONE = {
  meta: Megaphone, anuncio: Megaphone, instagram: Camera, conteudo: Share2, indicacao: Users, prospeccao: Search, dm: Send,
  pagina: FileText, captura: ClipboardList, webinar: Video, formulario: ClipboardList, upsellpg: TrendingUp, downsell: TrendingDown, obrigado: PartyPopper,
  checkout: ShoppingCart, pagamento: Wallet, agenda: CalendarClock, whatsapp: MessageCircle, email: Mail, reuniao: Users, proposta: Send,
  contrato: Handshake, crm: Database, cliente: UserCheck, sucesso: Trophy, perda: CircleX, nota: StickyNote,
};
const GRUPOS = [
  ['trafego', 'Tráfego'], ['pagina', 'Páginas do Studio'], ['fora', 'Fora do Studio'], ['resultado', 'Resultado'],
];
// "Como configurar o funil": a parte de checkout, upsell e downsell acontece na plataforma
// de pagamento. Os links são as páginas oficiais de ajuda de cada uma (conferidas em 28/09/2026).
const COMO_CONFIGURAR = [
  ['Hotmart', 'https://help.hotmart.com/pt-br/article/220402348/o-que-e-e-como-configurar-meu-funil-de-vendas-'],
  ['Hotmart (upsell com Hotmart Pages)', 'https://help.hotmart.com/pt-br/article/43101499107597/como-configurar-um-upsell-usando-o-funil-de-vendas-e-o-hotmart-pages-'],
  ['Kiwify', 'https://ajuda.kiwify.com.br/pt-br/article/como-configurar-upsell-de-1-clique-12ei26e/'],
  ['Hubla (upsell)', 'https://help.hub.la/hc/pt-br/como-configurar-upsell-na-hubla'],
  ['Hubla (order bump)', 'https://help.hub.la/hc/pt-br/como-configurar-um-order-bump-na-hubla'],
  ['Asaas (checkout e redirecionamento)', 'https://docs.asaas.com/docs/link-do-checkout-e-redirecionamento-do-cliente'],
];

const parametros = new URLSearchParams(location.search);
const funilId = parametros.get('funil');
const projetoId = parametros.get('projeto');

import { enderecoDeLogin } from '../public/voltar-depois-do-login.js';

async function api(caminho, metodo = 'GET', dados) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    credentials: 'same-origin',
    headers: dados ? { 'Content-Type': 'application/json' } : {},
    body: dados ? JSON.stringify(dados) : undefined,
  });
  // Sessão vencida: vai para o login e volta para esta página depois de entrar.
  if (resposta.status === 401) { location.replace(enderecoDeLogin(location)); return new Promise(() => {}); }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || 'Não foi possível concluir. Tente de novo.');
  return corpo;
}

const paraNos = (grafo) => grafo.nos.map((no) => ({ id: no.id, type: 'etapa', position: { x: no.x, y: no.y }, data: { k: no.k, nome: no.nome, texto: no.texto, pageId: no.pageId, link: no.link } }));
const paraSetas = (grafo) => grafo.setas.map((seta) => ({ id: seta.id, source: seta.de, target: seta.para, label: seta.rotulo || undefined, data: { rotulo: seta.rotulo } }));
const paraGrafo = (nos, setas) => normalizarGrafo({
  nos: nos.map((no) => ({ id: no.id, k: no.data.k, nome: no.data.nome, texto: no.data.texto, pageId: no.data.pageId, link: no.data.link, x: no.position.x, y: no.position.y })),
  setas: setas.map((seta) => ({ id: seta.id, de: seta.source, para: seta.target, rotulo: seta.data?.rotulo ?? seta.label ?? '' })),
});

function Etapa({ data, selected }) {
  const Icone = ICONE[data.k] ?? StickyNote;
  const tipo = tipoDaEtapa(data.k);
  const pagina = etapaViraPagina(data.k);
  return (
    <div className={`fn-etapa fn-${tipo.grupo}${selected ? ' fn-selecionada' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="fn-etapa-topo"><Icone size={16} aria-hidden="true" /><span>{tipo.rotulo}</span></div>
      <strong>{data.nome || tipo.rotulo}</strong>
      {pagina ? (
        data.pageId
          ? <a className="fn-etapa-acao nodrag" href={`/editor.html?pagina=${encodeURIComponent(data.pageId)}`}><ExternalLink size={14} aria-hidden="true" /> Abrir página</a>
          : <button type="button" className="fn-etapa-acao nodrag" onClick={() => data.aoCriarPagina?.()}><FilePlus2 size={14} aria-hidden="true" /> Criar página</button>
      ) : data.link ? <a className="fn-etapa-acao nodrag" href={data.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Abrir link</a> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const tiposDeNo = { etapa: Etapa };

function Editor() {
  const [funil, setFunil] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [menu, setMenu] = useState(false);
  const [nos, setNos, aoMudarNos] = useNodesState([]);
  const [setas, setSetas, aoMudarSetas] = useEdgesState([]);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const area = useRef(null);
  const avisar = (texto) => { setAviso(texto); setTimeout(() => setAviso(''), 4000); };

  const carregar = useCallback((dados) => {
    setFunil(dados);
    setNos(paraNos(dados.graph));
    setSetas(paraSetas(dados.graph));
    setAlterado(false);
  }, [setNos, setSetas]);

  useEffect(() => {
    if (!funilId || !projetoId) { setErro('Abra o funil a partir da aba Funis do projeto.'); return; }
    api(`/projects/${projetoId}/funnels/${funilId}`).then(carregar).catch((falha) => setErro(falha.message));
  }, [carregar]);
  useEffect(() => {
    const aoSair = (evento) => { if (alterado) evento.preventDefault(); };
    addEventListener('beforeunload', aoSair);
    return () => removeEventListener('beforeunload', aoSair);
  }, [alterado]);

  const mudou = (fn) => (...args) => { fn(...args); setAlterado(true); };
  const salvar = async () => {
    const salvo = await api(`/projects/${projetoId}/funnels/${funilId}`, 'PUT', { revision: funil.revision, name: funil.name, graph: paraGrafo(nos, setas) });
    carregar(salvo);
    return salvo;
  };
  const executar = (tarefa) => async () => {
    setOcupado(true);
    try { await tarefa(); } catch (falha) { avisar(falha.message); } finally { setOcupado(false); }
  };
  const criarPaginas = (etapaIds = null) => executar(async () => {
    await salvar();
    const { funnel, criadas } = await api(`/projects/${projetoId}/funnels/${funilId}/pages`, 'POST', etapaIds ? { etapaIds } : {});
    carregar(funnel);
    avisar(criadas.length ? `${criadas.length} ${criadas.length === 1 ? 'página criada' : 'páginas criadas'}, já ligadas entre si.` : 'Todas as etapas de página já têm página.');
  });

  const selecionado = nos.find((no) => no.selected);
  const setaSelecionada = setas.find((seta) => seta.selected);
  const nosComAcoes = useMemo(() => nos.map((no) => ({ ...no, data: { ...no.data, aoCriarPagina: criarPaginas([no.id]) } })), [nos, funil]);
  const editarEtapa = (campos) => { setNos((atuais) => atuais.map((no) => (no.id === selecionado.id ? { ...no, data: { ...no.data, ...campos } } : no))); setAlterado(true); };
  const editarSeta = (rotulo) => { setSetas((atuais) => atuais.map((seta) => (seta.id === setaSelecionada.id ? { ...seta, label: rotulo || undefined, data: { rotulo } } : seta))); setAlterado(true); };
  const adicionar = (k) => {
    const caixa = area.current?.getBoundingClientRect();
    const centro = caixa ? screenToFlowPosition({ x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 }) : { x: 0, y: 0 };
    const id = `e${Date.now().toString(36)}`;
    setNos((atuais) => [...atuais.map((no) => ({ ...no, selected: false })), { id, type: 'etapa', position: { x: centro.x - 90 + (atuais.length % 3) * 24, y: centro.y - 40 + (atuais.length % 3) * 24 }, data: { k, nome: tipoDaEtapa(k).rotulo, texto: '' }, selected: true }]);
    setAlterado(true);
  };
  // Encaixa as etapas em colunas pela ordem das setas (public/funil.js, organizarGrafo).
  const organizar = () => {
    const organizado = organizarGrafo(paraGrafo(nos, setas));
    const posicao = new Map(organizado.nos.map((no) => [no.id, { x: no.x, y: no.y }]));
    setNos((atuais) => atuais.map((no) => (posicao.has(no.id) ? { ...no, position: posicao.get(no.id) } : no)));
    setAlterado(true);
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
  };
  const remover = () => {
    if (selecionado) { setNos((atuais) => atuais.filter((no) => no.id !== selecionado.id)); setSetas((atuais) => atuais.filter((seta) => seta.source !== selecionado.id && seta.target !== selecionado.id)); }
    else if (setaSelecionada) setSetas((atuais) => atuais.filter((seta) => seta.id !== setaSelecionada.id));
    setAlterado(true);
  };

  if (erro) return <p className="fn-erro">{erro}</p>;
  if (!funil) return <p className="fn-carregando">Abrindo o funil…</p>;
  const etapasDePagina = nos.filter((no) => etapaViraPagina(no.data.k));
  const semPagina = etapasDePagina.filter((no) => !no.data.pageId).length;

  return (
    <div className="fn-app">
      <header className="fn-topo">
        <button type="button" className="fn-botao fn-icone" aria-label="Voltar para os funis" title="Voltar" onClick={() => { if (alterado && !confirm('Há alterações não salvas. Sair mesmo assim?')) return; location.href = '/#/funis'; }}><ArrowLeft size={18} aria-hidden="true" /></button>
        <input className="fn-nome" aria-label="Nome do funil" value={funil.name} onChange={(evento) => { setFunil({ ...funil, name: evento.target.value }); setAlterado(true); }} />
        <span className={`fn-salvo${alterado ? ' fn-pendente' : ''}`} role="status">{alterado ? <><CircleDot size={16} aria-hidden="true" /> Alterações não salvas</> : <><CircleCheck size={16} aria-hidden="true" /> Salvo</>}</span>
        <div className="fn-acoes">
          <button type="button" className="fn-botao" onClick={organizar} title="Alinhar as etapas em colunas, na ordem das setas"><LayoutGrid size={16} aria-hidden="true" /> Organizar</button>
          <div className="fn-menu">
            <button type="button" className="fn-botao" aria-expanded={menu} onClick={() => setMenu(!menu)}><BookOpen size={16} aria-hidden="true" /> Como configurar o funil</button>
            {menu ? (
              <div className="fn-menu-lista" role="menu">
                <p>Checkout, upsell e downsell se configuram na plataforma de pagamento. Veja como em cada uma:</p>
                {COMO_CONFIGURAR.map(([nome, href]) => <a key={href} role="menuitem" href={href} target="_blank" rel="noopener noreferrer">{nome} <ExternalLink size={14} aria-hidden="true" /></a>)}
              </div>
            ) : null}
          </div>
          <button type="button" className="fn-botao" disabled={ocupado || !semPagina} onClick={criarPaginas()} title={semPagina ? '' : 'Todas as etapas de página já têm página'}><FilePlus2 size={16} aria-hidden="true" /> Criar páginas{semPagina ? ` (${semPagina})` : ''}</button>
          <button type="button" className="fn-botao fn-principal" disabled={ocupado} onClick={executar(async () => { await salvar(); avisar('Funil salvo.'); })}><Save size={16} aria-hidden="true" /> Salvar</button>
        </div>
      </header>
      <div className="fn-corpo">
        <aside className="fn-paleta" aria-label="Etapas">
          <div className="fn-eyebrow">Funil</div>
          <h2>Etapas</h2>
          <p className="fn-ajuda">Clique para pôr no desenho. Ligue as etapas puxando da bolinha da direita para a da esquerda.</p>
          {GRUPOS.map(([grupo, titulo]) => (
            <section key={grupo}>
              <h3>{titulo}</h3>
              {Object.entries(TIPOS_DE_ETAPA).filter(([, tipo]) => tipo.grupo === grupo).map(([k, tipo]) => {
                const Icone = ICONE[k] ?? StickyNote;
                return <button key={k} type="button" className="fn-item" onClick={() => adicionar(k)}><Icone size={16} aria-hidden="true" /><span>{tipo.rotulo}</span><Plus size={14} aria-hidden="true" /></button>;
              })}
            </section>
          ))}
        </aside>
        <main className="fn-canvas" ref={area}>
          <ReactFlow
            nodes={nosComAcoes}
            edges={setas}
            nodeTypes={tiposDeNo}
            onNodesChange={(mudancas) => { aoMudarNos(mudancas); if (mudancas.some((m) => m.type === 'position' || m.type === 'remove')) setAlterado(true); }}
            onEdgesChange={(mudancas) => { aoMudarSetas(mudancas); if (mudancas.some((m) => m.type === 'remove')) setAlterado(true); }}
            onConnect={mudou((conexao) => setSetas((atuais) => addEdge({ ...conexao, id: `s${Date.now().toString(36)}`, data: { rotulo: '' } }, atuais)))}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </main>
        <aside className="fn-painel" aria-label="Propriedades">
          {selecionado ? (
            <>
              <div className="fn-eyebrow">Etapa</div>
              <label className="fn-campo">Nome<input value={selecionado.data.nome} onChange={(evento) => editarEtapa({ nome: evento.target.value })} /></label>
              <label className="fn-campo">Tipo
                <select value={selecionado.data.k} onChange={(evento) => editarEtapa({ k: evento.target.value })}>
                  {GRUPOS.map(([grupo, titulo]) => <optgroup key={grupo} label={titulo}>{Object.entries(TIPOS_DE_ETAPA).filter(([, tipo]) => tipo.grupo === grupo).map(([k, tipo]) => <option key={k} value={k}>{tipo.rotulo}</option>)}</optgroup>)}
                </select>
              </label>
              <label className="fn-campo">O que acontece aqui<textarea rows={5} value={selecionado.data.texto} onChange={(evento) => editarEtapa({ texto: evento.target.value })} /></label>
              {etapaViraPagina(selecionado.data.k) ? (
                selecionado.data.pageId
                  ? <a className="fn-botao" href={`/editor.html?pagina=${encodeURIComponent(selecionado.data.pageId)}`}><ExternalLink size={16} aria-hidden="true" /> Abrir página</a>
                  : <button type="button" className="fn-botao fn-principal" disabled={ocupado} onClick={criarPaginas([selecionado.id])}><FilePlus2 size={16} aria-hidden="true" /> Criar a página desta etapa</button>
              ) : (
                <label className="fn-campo">Link (checkout, WhatsApp, agenda…)<input placeholder="https://" value={selecionado.data.link ?? ''} onChange={(evento) => editarEtapa({ link: evento.target.value.trim() })} /></label>
              )}
              <button type="button" className="fn-botao fn-perigo" onClick={remover}><Trash2 size={16} aria-hidden="true" /> Remover etapa</button>
            </>
          ) : setaSelecionada ? (
            <>
              <div className="fn-eyebrow">Seta</div>
              <label className="fn-campo">Rótulo (ex.: "sim", "não", "comprou")<input value={setaSelecionada.data?.rotulo ?? ''} onChange={(evento) => editarSeta(evento.target.value)} /></label>
              <p className="fn-ajuda">No upsell, a seta rotulada "não" (ou a que vai para o downsell) vira o botão "Não, obrigado" da página.</p>
              <button type="button" className="fn-botao fn-perigo" onClick={remover}><Trash2 size={16} aria-hidden="true" /> Remover seta</button>
            </>
          ) : (
            <>
              <div className="fn-eyebrow">Funil</div>
              <h2>{funil.name}</h2>
              <p className="fn-ajuda">{nos.length} etapas · {etapasDePagina.length} viram página · {semPagina} ainda sem página.</p>
              <p className="fn-ajuda">Clique numa etapa para editar. "Criar páginas" monta as páginas que faltam, com os botões já levando à próxima etapa.</p>
              <button type="button" className="fn-botao fn-perigo" onClick={executar(async () => {
                if (!confirm(`Excluir o funil “${funil.name}”? Sai só o desenho: as páginas que ele criou continuam no projeto.`)) return;
                await api(`/projects/${projetoId}/funnels/${funilId}`, 'DELETE');
                setAlterado(false);
                location.href = '/#/funis';
              })}><Trash2 size={16} aria-hidden="true" /> Excluir funil</button>
            </>
          )}
        </aside>
      </div>
      {aviso ? <div className="fn-aviso" role="status">{aviso}</div> : null}
    </div>
  );
}

createRoot(document.getElementById('funil')).render(<StrictMode><ReactFlowProvider><Editor /></ReactFlowProvider></StrictMode>);
