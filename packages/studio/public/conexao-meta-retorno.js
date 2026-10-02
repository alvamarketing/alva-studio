// A página para onde o Facebook devolve a pessoa depois do login (/conexoes/meta/retorno).
//
// Por que uma página e não uma rota da API: o cookie de sessão é SameSite=Strict e não vem
// numa navegação que começou em facebook.com. Aqui, já dentro do Studio, o script faz um
// POST na mesma origem — com cookie, Origin e as checagens de sempre — e a conclusão fica
// presa à sessão de quem clicou. Spec 2026-10-02, "Segurança do retorno".
//
// O código de autorização vale como senha por alguns minutos: sai da barra antes de tudo, e
// nada do que veio na URL é escrito na página.

export const DESTINO_DO_RETORNO = '/#/configuracoes-do-projeto/rastreamento';

const SEM_DADOS = 'A volta do Facebook chegou incompleta. Volte ao Studio e clique em "Conectar com o Facebook" de novo.';

export async function concluirRetornoDaMeta({
  win = window,
  doc = document,
  request = (...args) => win.fetch(...args),
  navegar = (url) => win.location.replace(url),
} = {}) {
  const url = new URL(win.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  win.history.replaceState(null, '', url.pathname);

  const titulo = doc.querySelector('#retorno-titulo');
  const texto = doc.querySelector('#retorno-texto');
  const voltar = doc.querySelector('#retorno-voltar');
  voltar?.addEventListener('click', () => navegar(DESTINO_DO_RETORNO));
  const mostrar = (cabecalho, mensagem) => {
    if (titulo) titulo.textContent = cabecalho;
    if (texto) texto.textContent = mensagem;
    if (voltar) voltar.hidden = false;
  };

  if (!state || (!code && !error)) {
    mostrar('Não foi possível conectar', SEM_DADOS);
    return 'invalido';
  }
  const pedir = async (caminho, metodo = 'GET', corpo) => {
    const resposta = await request(caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    let dados = null;
    try { dados = await resposta.json(); } catch { dados = null; }
    if (!resposta.ok) throw new Error(dados?.error || 'Não foi possível concluir a conexão.');
    return dados ?? {};
  };

  try {
    // A empresa vem da sessão, não da URL: o servidor confere de novo, mas a página não tem
    // por que confiar no que o Facebook devolveu além do code e do state.
    const sessao = await pedir('/api/session');
    if (!sessao.authenticated || !sessao.currentCompanyId) {
      mostrar('Entre no Studio', 'Sua sessão terminou. Entre de novo e clique em "Conectar com o Facebook".');
      return 'sem-sessao';
    }
    // Só o código do erro vai (access_denied); a descrição que o Facebook manda não é usada.
    const corpo = error ? { error, state } : { code, state };
    const resultado = await pedir(`/api/companies/${encodeURIComponent(sessao.currentCompanyId)}/meta-connection/finish`, 'POST', corpo);
    if (resultado.estado === 'conectado') {
      if (titulo) titulo.textContent = 'Conta da Meta conectada';
      if (texto) texto.textContent = 'Voltando ao Studio…';
      navegar(DESTINO_DO_RETORNO);
      return 'conectado';
    }
    mostrar('Nada foi conectado', resultado.aviso || 'O Facebook não concluiu a autorização.');
    return 'cancelado';
  } catch (falha) {
    mostrar('Não foi possível conectar', falha?.message || 'Não foi possível concluir a conexão.');
    return 'erro';
  }
}

if (typeof document !== 'undefined' && document.documentElement?.dataset.pagina === 'conexao-meta-retorno') concluirRetornoDaMeta();
