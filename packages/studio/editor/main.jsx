// O editor de landing do Alva, sobre o Puck.
//
// Abre a página pela API, edita o esquema e salva o esquema — o HTML publicado quem
// desenha é o servidor. React mora só aqui: a página publicada é HTML puro.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Puck, createUsePuck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { criarConfig } from './config.jsx';
import { dicionario, larguras } from './dicionario.js';
import { ArrowLeft, CircleCheck, CircleDot, Eye, ItemDaBiblioteca, Rocket, Save } from './icones.jsx';
import { Estrutura } from './estrutura.jsx';
import { documentoDaPagina, ehQuiz, normalizarEstadoAlva } from '../public/pagina-alva.js';
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
.alva-quiz-no-editor .alva-etapa:last-of-type::before{content:'Tela final'}`;
const FOLHAS = materialSymbolsFontCss(location.origin) + runtimeCss + templateCss + elementosCss + escolhaCss + ROTULOS_DAS_ETAPAS;
function IframeComFolhas({ children, document: doc }) {
  useEffect(() => {
    if (!doc || doc.getElementById('alva-folhas')) return;
    const fonte = doc.createElement('link');
    fonte.rel = 'stylesheet';
    fonte.href = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap';
    const estilo = doc.createElement('style');
    estilo.id = 'alva-folhas';
    estilo.textContent = FOLHAS;
    doc.head.append(fonte, estilo);
  }, [doc]);
  return <>{children}</>;
}

function Acoes({ pagina, aoSalvar, aviso, pendente, alterada }) {
  const dados = usePuck((estado) => estado.appState.data);
  const [ocupado, setOcupado] = useState(false);
  const executar = (tarefa) => async () => {
    setOcupado(true);
    try { await tarefa(); } catch (erro) { aviso(erro.message); } finally { setOcupado(false); }
  };
  // Ordem e pesos do topo do contrato (seção "Estrutura" do wireframe): voltar, estado do
  // salvamento, Prévia e Publicar secundários, Salvar como ação principal.
  return (
    <>
      <button type="button" className="alva-acao alva-acao-icone" aria-label="Voltar para as páginas" title="Voltar" onClick={() => {
        if (pendente.current && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
        pendente.current = false;
        location.href = ehQuiz(pagina.editorState) ? '/#/quizzes' : '/#/paginas';
      }}>
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
      <span className={`alva-salvo${alterada ? ' alva-salvo-pendente' : ''}`} role="status">
        {alterada ? <><CircleDot size={16} aria-hidden="true" /> Alterações não salvas</> : <><CircleCheck size={16} aria-hidden="true" /> Salvo</>}
      </span>
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
      <button type="button" className="alva-acao" disabled={ocupado} onClick={executar(async () => {
        const salva = await aoSalvar(dados);
        await api(`/pages/${pagina.id}/publish`, 'POST', { revision: salva.revision });
        aviso('Enviada à Vercel. O andamento aparece em Publicação.');
      })}>
        <Rocket size={16} aria-hidden="true" /> Publicar
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
      setConfig(criarConfig({ vsls: (Array.isArray(videos) ? videos : []).filter((video) => video.publishedVersionId), enviarImagem, quiz: ehQuiz(aberta.editorState) }));
      salvo.current = JSON.stringify(puckParaAlva(alvaParaPuck(aberta.editorState)));
      setPagina(aberta);
    })().catch((falha) => setErro(falha.message));
  }, []);
  const aviso = (texto) => { setMensagem(texto); setTimeout(() => setMensagem(''), 4000); };
  const aoSalvar = async (dados) => {
    const salva = await api(`/pages/${pagina.id}`, 'PUT', { revision: pagina.revision, editorState: puckParaAlva(dados) });
    salvo.current = JSON.stringify(puckParaAlva(dados));
    pendente.current = false;
    setAlterada(false);
    setPagina(salva);
    aviso('Página salva.');
    return salva;
  };
  if (erro) return <p className="alva-erro">{erro}</p>;
  if (!pagina || !config) return <p className="alva-carregando">Abrindo a página…</p>;
  return (
    <>
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
          headerActions: () => <Acoes pagina={pagina} aoSalvar={aoSalvar} aviso={aviso} pendente={pendente} alterada={alterada} />,
          drawerItem: ({ name }) => <ItemDaBiblioteca name={name} rotulo={config.components[name]?.label} />,
        }}
      />
      {mensagem && <div className="alva-aviso" role="status">{mensagem}</div>}
    </>
  );
}

createRoot(document.getElementById('editor')).render(<StrictMode><Editor /></StrictMode>);
