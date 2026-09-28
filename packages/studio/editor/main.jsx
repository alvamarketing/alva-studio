// O editor de landing do Alva, sobre o Puck.
//
// Abre a página pela API, edita o esquema e salva o esquema — o HTML publicado quem
// desenha é o servidor. React mora só aqui: a página publicada é HTML puro.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Puck, createUsePuck } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { config } from './config.jsx';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';
import { elementosCss } from '../public/catalogo-elementos.js';
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
const FOLHAS = materialSymbolsFontCss(location.origin) + runtimeCss + templateCss + elementosCss;
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

function Acoes({ pagina, aoSalvar, aviso }) {
  const dados = usePuck((estado) => estado.appState.data);
  const [ocupado, setOcupado] = useState(false);
  const executar = (tarefa) => async () => {
    setOcupado(true);
    try { await tarefa(); } catch (erro) { aviso(erro.message); } finally { setOcupado(false); }
  };
  return (
    <>
      <button type="button" className="alva-acao" onClick={() => { location.href = '/#/paginas'; }}>Voltar</button>
      <button type="button" className="alva-acao" disabled={ocupado} onClick={executar(() => aoSalvar(dados))}>Salvar</button>
      <button type="button" className="alva-acao alva-acao-principal" disabled={ocupado} onClick={executar(async () => {
        const salva = await aoSalvar(dados);
        await api(`/pages/${pagina.id}/publish`, 'POST', { revision: salva.revision });
        aviso('Enviada à Vercel. O andamento aparece em Publicação.');
      })}>Publicar</button>
    </>
  );
}

function Editor() {
  const [pagina, setPagina] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  useEffect(() => {
    if (!paginaId) { setErro('Abra o editor a partir da lista de páginas.'); return; }
    api(`/pages/${encodeURIComponent(paginaId)}`).then(setPagina).catch((falha) => setErro(falha.message));
  }, []);
  const aviso = (texto) => { setMensagem(texto); setTimeout(() => setMensagem(''), 4000); };
  const aoSalvar = async (dados) => {
    const salva = await api(`/pages/${pagina.id}`, 'PUT', { revision: pagina.revision, editorState: puckParaAlva(dados) });
    setPagina(salva);
    aviso('Página salva.');
    return salva;
  };
  if (erro) return <p className="alva-erro">{erro}</p>;
  if (!pagina) return <p className="alva-carregando">Abrindo a página…</p>;
  return (
    <>
      <Puck
        config={config}
        data={alvaParaPuck(pagina.editorState)}
        headerTitle={pagina.name}
        onPublish={aoSalvar}
        overrides={{
          iframe: IframeComFolhas,
          headerActions: () => <Acoes pagina={pagina} aoSalvar={aoSalvar} aviso={aviso} />,
        }}
      />
      {mensagem && <div className="alva-aviso" role="status">{mensagem}</div>}
    </>
  );
}

createRoot(document.getElementById('editor')).render(<StrictMode><Editor /></StrictMode>);
