// O editor de landing do Alva, sobre o Puck.
//
// Abre a página pela API, edita o esquema e salva o esquema — o HTML publicado quem
// desenha é o servidor. React mora só aqui: a página publicada é HTML puro.
import { estadoDoPublicar } from '../public/publicacao-pendente.js';
import { enderecoDeLogin } from '../public/voltar-depois-do-login.js';
import { StrictMode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Puck, createUsePuck, useGetPuck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { criarConfig } from './config.jsx';
import { dicionario, larguras } from './dicionario.js';
import { CircleCheck, CircleDot, Eye, Inbox, ItemDaBiblioteca, Rocket, Save } from './icones.jsx';
import { Estrutura } from './estrutura.jsx';
import { Cabecalho } from './topo.jsx';
import { ZONAS_DO_CANVAS } from './zonas-do-canvas.js';
import { IMAGEM_VAZIA_CSS } from './imagem-vazia.js';
import { aceitarArquivosSoltos } from './envios-de-imagem.js';
import { FONTE_DO_CONTRATO, documentoDaPagina, ehQuiz, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { quizRuntimeCss } from '../public/quiz-runtime.js';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';
import { elementosCss, escolhaCss } from '../public/catalogo-elementos.js';
import { runtimeCss, templateCss } from '../public/templates.js';
import { materialSymbolsFontCss } from '../public/quiz-elements.js';

const usePuck = createUsePuck();
const paginaId = new URLSearchParams(location.search).get('pagina');

async function api(caminho, metodo = 'GET', dados) {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    ...(dados === undefined ? {} : { body: JSON.stringify(dados) }),
  });
  // Sessão vencida: vai para o login e volta para esta página depois de entrar.
  if (resposta.status === 401) { location.replace(enderecoDeLogin(location)); return new Promise(() => {}); }
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.error || 'Não foi possível concluir.');
  return corpo;
}

// As folhas da página publicada, dentro do iframe do editor: o que se vê editando é o
// que vai ao ar.
// No quiz, o editor mostra todas as etapas uma embaixo da outra, com o nome de cada uma —
// quem visita vê uma por vez.
const ROTULOS_DAS_ETAPAS = `.alva-quiz-no-editor{counter-reset:etapa}
.alva-quiz-no-editor .alva-etapa{counter-increment:etapa;position:relative;border-bottom:1px dashed #98a2b3}
.alva-quiz-no-editor .alva-etapa::before{content:'Etapa ' counter(etapa);position:absolute;top:10px;left:14px;font:600 12px/1 Inter,system-ui,sans-serif;color:#667085;letter-spacing:.02em}
.alva-quiz-no-editor .alva-etapa:last-of-type::before{content:'Tela final'}
.alva-quiz-no-editor .alva-etapa .alva-conteudo>*:has(.answer-wrap){flex:0 0 100%}`;
const FOLHAS = materialSymbolsFontCss(location.origin) + runtimeCss + templateCss + FONTE_DO_CONTRATO + elementosCss + escolhaCss + quizRuntimeCss + ROTULOS_DAS_ETAPAS + ZONAS_DO_CANVAS + IMAGEM_VAZIA_CSS;
// O envio de imagem e o aviso, para o que roda dentro do Puck (o canvas recebe arquivo solto).
const ContextoDoEditor = createContext({ enviarImagem: null, aviso: () => {} });
function IframeComFolhas({ children, document: doc }) {
  const getPuck = useGetPuck();
  const { enviarImagem, aviso } = useContext(ContextoDoEditor);
  useEffect(() => (doc && enviarImagem ? aceitarArquivosSoltos(doc, { getPuck, enviarImagem, aviso }) : undefined), [doc, getPuck, enviarImagem, aviso]);
  useEffect(() => {
    if (!doc || doc.getElementById('alva-folhas')) return;
    // Os tokens do Studio, para o que só o editor desenha no canvas (o lugar da imagem vazia).
    const tokens = doc.createElement('link');
    tokens.rel = 'stylesheet';
    tokens.href = '/tokens.css';
    const fonte = doc.createElement('link');
    fonte.rel = 'stylesheet';
    fonte.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    const estilo = doc.createElement('style');
    estilo.id = 'alva-folhas';
    estilo.textContent = FOLHAS;
    doc.head.append(tokens, fonte, estilo);
  }, [doc]);
  return <>{children}</>;
}

// Para onde vão os leads desta página: sempre para o Studio (aba Leads) e, se a pessoa
// quiser, uma cópia em JSON para um webhook (CRM, automação). O padrão é o do projeto
// (Configurações do projeto > Leads); o campo daqui só serve para sobrescrevê-lo nesta página.
function DestinoDosLeads({ pagina, aoSalvarWebhook }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef(null);
  const [posicao, setPosicao] = useState(null);
  // O painel é desenhado fora do topo do Puck (portal no body, posição fixa): dentro dele,
  // o canvas ficava por cima e escondia o painel.
  const alternar = () => {
    const caixa = botao.current?.getBoundingClientRect();
    if (caixa) setPosicao({ top: caixa.bottom + 6, right: Math.max(8, window.innerWidth - caixa.right) });
    setAberto(!aberto);
  };
  const [valor, setValor] = useState(pagina.webhook ?? '');
  const [estado, setEstado] = useState('');
  // O destino do projeto vale para toda página sem destino próprio. Mostra-se só o host: a
  // URL inteira costuma levar o token do CRM, e quem edita a página não gerencia integrações.
  const usaODoProjeto = !valor.trim() && Boolean(pagina.projectWebhookHost);
  return (
    <div className="alva-menu">
      <button type="button" ref={botao} className="alva-acao" aria-expanded={aberto} onClick={alternar}>
        <Inbox size={16} aria-hidden="true" /> Leads
      </button>
      {aberto && posicao ? createPortal(
        <form className="alva-menu-painel" style={{ position: 'fixed', top: posicao.top, right: posicao.right, zIndex: 1000 }} onSubmit={async (evento) => {
          evento.preventDefault();
          setEstado('Salvando…');
          try { await aoSalvarWebhook(valor.trim()); setEstado('Destino salvo.'); } catch (erro) { setEstado(erro.message); }
        }}>
          <strong>Para onde vão as respostas</strong>
          <p>As respostas ficam disponíveis no Studio, na aba Leads do projeto.</p>
          <label>Opcionalmente, envie uma cópia em JSON para seu CRM ou automação
            <input type="url" placeholder="https://" value={valor} onChange={(evento) => setValor(evento.target.value)} />
          </label>
          <small>O destino desta página passa a valer na próxima publicação.</small>
          {usaODoProjeto ? <p role="note">Esta página usa o destino do projeto ({pagina.projectWebhookHost}). Preencha o campo só se quiser outro para ela.</p> : null}
          <button type="submit" className="alva-acao alva-acao-principal">Salvar destino</button>
          {estado ? <small role="status">{estado}</small> : null}
          <button type="button" className="alva-acao" onClick={() => setAberto(false)}>Fechar</button>
        </form>,
        document.body,
      ) : null}
    </div>
  );
}

function Acoes({ pagina, aoSalvar, aoPublicar, aoSalvarWebhook, aviso, pendente, alterada }) {
  const dados = usePuck((estado) => estado.appState.data);
  // Página no ar com o que está salvo (ou na tela) diferente do que foi publicado: amarelo,
  // como no RD Station. Rascunho nunca publicado não acende.
  const publicar = estadoDoPublicar({
    publicada: Boolean(pagina.publishedVersionId),
    alteracoesNaoPublicadas: pagina.unpublishedChanges === true,
    alteracoesNaoSalvas: alterada,
  });
  const [ocupado, setOcupado] = useState(false);
  const executar = (tarefa) => async () => {
    setOcupado(true);
    try { await tarefa(); } catch (erro) { aviso(erro.message); } finally { setOcupado(false); }
  };
  // Ordem e pesos do topo do contrato (seção "Estrutura" do wireframe): estado do salvamento,
  // Leads, Prévia e Publicar secundários, Salvar como ação principal. O voltar mora no Cabecalho.
  return (
    <>
      <span className={`alva-salvo${alterada ? ' alva-salvo-pendente' : ''}`} role="status">
        {alterada ? <><CircleDot size={16} aria-hidden="true" /> Alterações não salvas</> : <><CircleCheck size={16} aria-hidden="true" /> Salvo</>}
      </span>
      <DestinoDosLeads pagina={pagina} aoSalvarWebhook={(webhook) => aoSalvarWebhook(dados, webhook)} />
      <button type="button" className="alva-acao" onClick={() => {
        // A prévia é o mesmo documento que o servidor publica, montado aqui com o que está na
        // tela — inclusive o que ainda não foi salvo.
        const html = documentoDaPagina(normalizarEstadoAlva(puckParaAlva(dados)), { publicOrigin: location.origin, previa: true });
        const endereco = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        window.open(endereco, '_blank');
        setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
      }}>
        <Eye size={16} aria-hidden="true" /> Prévia
      </button>
      <button type="button" className={`alva-acao${publicar.pendente ? ' alva-acao-pendente' : ''}`} disabled={ocupado} title={publicar.dica || undefined} onClick={executar(async () => {
        await aoPublicar(dados);
        aviso('Enviada à Vercel. O andamento aparece em Publicação.');
      })}>
        <Rocket size={16} aria-hidden="true" /> {publicar.rotulo}
      </button>
      <button type="button" className="alva-acao alva-acao-principal" disabled={ocupado} onClick={executar(() => aoSalvar(dados))}>
        <Save size={16} aria-hidden="true" /> Salvar
      </button>
    </>
  );
}

function Editor() {
  const [pagina, setPagina] = useState(null);
  const [config, setConfig] = useState(null);
  const [enviarImagem, setEnviarImagem] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  // O que está salvo, para saber se há alteração a perder ao sair.
  const salvo = useRef('');
  const pendente = useRef(false);
  const [alterada, setAlterada] = useState(false);
  useEffect(() => {
    const aoSair = (evento) => { if (pendente.current) evento.preventDefault(); };
    addEventListener('beforeunload', aoSair);
    return () => removeEventListener('beforeunload', aoSair);
  }, []);
  useEffect(() => {
    if (!paginaId) { setErro('Abra o editor a partir da lista de páginas.'); return; }
    (async () => {
      const aberta = await api(`/pages/${encodeURIComponent(paginaId)}`);
      // Sem VSL no ambiente (ou sem permissão), o bloco só diz que não há o que escolher.
      const videos = await api(`/projects/${aberta.projectId}/videos`).catch(() => []);
      // Anexar do computador: lê o arquivo e envia ao Studio, que devolve o endereço público.
      const enviarImagem = (arquivo) => new Promise((resolver, rejeitar) => {
        if (arquivo.size > 5 * 1024 * 1024) { rejeitar(new Error('A imagem passa de 5 MB. Reduza e tente de novo.')); return; }
        const leitor = new FileReader();
        leitor.onload = () => api(`/projects/${aberta.projectId}/images`, 'POST', { dados: leitor.result }).then((imagem) => resolver(imagem.url), rejeitar);
        leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
        leitor.readAsDataURL(arquivo);
      });
      setEnviarImagem(() => enviarImagem);
      setConfig(criarConfig({ vsls: (Array.isArray(videos) ? videos : []).filter((video) => video.publishedVersionId), enviarImagem, quiz: ehQuiz(aberta.editorState) }));
      salvo.current = JSON.stringify(puckParaAlva(alvaParaPuck(aberta.editorState)));
      setPagina(aberta);
    })().catch((falha) => setErro(falha.message));
  }, []);
  const aviso = useCallback((texto) => { setMensagem(texto); setTimeout(() => setMensagem(''), 4000); }, []);
  const contexto = useMemo(() => ({ enviarImagem, aviso }), [enviarImagem, aviso]);
  // Fora do canvas não há bloco Imagem: arquivo solto ali só ganha o aviso de onde soltar,
  // em vez de o navegador abri-lo numa aba nova.
  useEffect(() => aceitarArquivosSoltos(document, { getPuck: () => ({ getItemById: () => undefined }), enviarImagem: async () => '', aviso }), [aviso]);
  const aoSalvarWebhook = async (dados, webhook) => {
    const salva = await api(`/pages/${pagina.id}`, 'PUT', { revision: pagina.revision, editorState: puckParaAlva(dados), webhook });
    salvo.current = JSON.stringify(puckParaAlva(dados));
    pendente.current = false;
    setAlterada(false);
    setPagina({ ...salva, webhook });
    return salva;
  };
  const aoSalvar = async (dados) => {
    const salva = await api(`/pages/${pagina.id}`, 'PUT', { revision: pagina.revision, editorState: puckParaAlva(dados) });
    salvo.current = JSON.stringify(puckParaAlva(dados));
    pendente.current = false;
    setAlterada(false);
    setPagina(salva);
    aviso('Página salva.');
    return salva;
  };
  // Salva e publica; depois relê a página para o botão voltar ao normal (o servidor é quem
  // sabe em qual salvamento ela foi publicada).
  const aoPublicar = async (dados) => {
    const salva = await aoSalvar(dados);
    await api(`/pages/${pagina.id}/publish`, 'POST', { revision: salva.revision });
    setPagina(await api(`/pages/${encodeURIComponent(pagina.id)}`));
  };
  // O cabeçalho é um componente de identidade estável (o Puck remonta o que muda de identidade a
  // cada render); o que muda — nome, voltar — ele lê daqui.
  const topoAtual = useRef({});
  topoAtual.current = {
    nome: pagina?.name ?? '',
    aoVoltar: () => {
      if (pendente.current && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
      pendente.current = false;
      location.href = pagina && ehQuiz(pagina.editorState) ? '/#/quizzes' : '/#/paginas';
    },
  };
  const Topo = useMemo(() => function Topo({ actions }) { return <Cabecalho {...topoAtual.current} acoes={actions} />; }, []);
  if (erro) return <p className="alva-erro">{erro}</p>;
  if (!pagina || !config) return <p className="alva-carregando">Abrindo a página…</p>;
  return (
    <ContextoDoEditor.Provider value={contexto}>
      <Puck
        config={config}
        data={alvaParaPuck(pagina.editorState)}
        headerTitle={pagina.name}
        dictionary={dicionario}
        viewports={larguras}
        onPublish={aoSalvar}
        onChange={(dados) => { pendente.current = JSON.stringify(puckParaAlva(dados)) !== salvo.current; setAlterada(pendente.current); }}
        overrides={{
          iframe: IframeComFolhas,
          outline: () => <Estrutura quiz={ehQuiz(pagina.editorState)} />,
          header: Topo,
          headerActions: () => <Acoes pagina={pagina} aoSalvar={aoSalvar} aoPublicar={aoPublicar} aoSalvarWebhook={aoSalvarWebhook} aviso={aviso} pendente={pendente} alterada={alterada} />,
          drawerItem: ({ name }) => <ItemDaBiblioteca name={name} rotulo={config.components[name]?.label} />,
        }}
      />
      {mensagem && <div className="alva-aviso" role="status">{mensagem}</div>}
    </ContextoDoEditor.Provider>
  );
}

createRoot(document.getElementById('editor')).render(<StrictMode><Editor /></StrictMode>);
