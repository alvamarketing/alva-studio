// O cartão "Conta da Meta", no topo da aba Rastreamento das configurações do projeto.
// Contrato visual: wireframe "Empresa e equipe" — cartão `.surface` com `.surface-head`, linha
// de pessoa como a da equipe (`.member-item`, `.role-chip`). Sem cor, raio, sombra ou peso de
// fonte próprios: tudo vem de styles.css e owner.css.
//
// A conexão é da empresa (spec 2026-10-02, D1): conectar aqui vale para todos os projetos.
// Listas de conta de anúncios e de pixel chegam na F2; por ora o cartão conecta, mostra quem
// conectou e desconecta.
//
// D9: "Conectar" navega na mesma aba. Um pop-up aberto depois de um `await` é bloqueado no
// celular, e o facebook.com corta o `window.opener` — a volta vem por /conexoes/meta/retorno.

function elemento(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

function botao(doc, texto, { primario = false, desligado = false } = {}) {
  const no = elemento(doc, 'button', primario ? 'primary' : '', texto);
  no.type = 'button';
  no.disabled = desligado;
  return no;
}

const dataCurta = (valor) => {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const AJUDA = {
  desconectado: 'Conecte a conta do Facebook que administra os seus anúncios. A conexão vale para todos os projetos da empresa.',
  conectado: 'A conexão vale para todos os projetos da empresa.',
  reconectar: 'A Meta não aceita mais esta conexão. Conecte de novo para continuar.',
};

export function cartaoDaContaMeta(doc, { carregar, iniciar, desconectar, navegar, irParaManual }) {
  const cartao = elemento(doc, 'section', 'surface conta-meta');
  cartao.id = 'conta-meta';
  const cabecalho = elemento(doc, 'div', 'surface-head');
  const titulos = elemento(doc, 'div');
  const ajuda = elemento(doc, 'p', 'helper', '');
  titulos.append(elemento(doc, 'h2', '', 'Conta da Meta'), ajuda);
  cabecalho.append(titulos);
  const corpo = elemento(doc, 'div', 'conta-meta-corpo');
  const aviso = elemento(doc, 'p', 'help');
  aviso.setAttribute('role', 'status');
  const erro = elemento(doc, 'p', 'form-error');
  erro.setAttribute('role', 'alert');
  cartao.append(cabecalho, corpo, aviso, erro);

  let estado = null;
  let abrindo = false;

  function linhaDaConexao(conexao) {
    const lista = elemento(doc, 'div', 'member-list');
    const linha = elemento(doc, 'div', 'member-item');
    const texto = elemento(doc, 'div');
    const quem = conexao.conectadoPor?.nome ? `Conectado por ${conexao.conectadoPor.nome}` : 'Conectado';
    const quando = dataCurta(conexao.conectadoEm);
    texto.append(elemento(doc, 'strong', '', conexao.nome || 'Conta do Facebook'), elemento(doc, 'span', '', quando ? `${quem} em ${quando}` : quem));
    linha.append(texto, elemento(doc, 'span', 'role-chip', conexao.precisaReconectar ? 'Sem acesso' : 'Conectado'));
    lista.append(linha);
    return lista;
  }

  function acoes(...botoes) {
    const grupo = elemento(doc, 'div', 'provider-actions');
    grupo.append(...botoes);
    return grupo;
  }

  // Como no wireframe ("Equipe" com "+ Convidar"), a ação principal fica no cabeçalho, à
  // direita do título; o que é secundário vai no corpo.
  function desenhar() {
    const novo = [];
    let principal;
    if (!estado?.conectado) {
      ajuda.textContent = AJUDA.desconectado;
      principal = botao(doc, abrindo ? 'Abrindo o Facebook…' : 'Conectar com o Facebook', { primario: true, desligado: abrindo });
      principal.onclick = () => cartao.aoConectar();
      const manual = botao(doc, 'Prefiro preencher manualmente', { desligado: abrindo });
      manual.onclick = () => irParaManual();
      novo.push(acoes(manual));
    } else if (estado.precisaReconectar) {
      ajuda.textContent = AJUDA.reconectar;
      principal = botao(doc, abrindo ? 'Abrindo o Facebook…' : 'Reconectar', { primario: true, desligado: abrindo });
      principal.onclick = () => cartao.aoConectar();
      const sair = botao(doc, 'Desconectar', { desligado: abrindo });
      sair.onclick = () => cartao.aoDesconectar();
      novo.push(linhaDaConexao(estado), acoes(sair));
    } else {
      ajuda.textContent = AJUDA.conectado;
      principal = botao(doc, 'Desconectar');
      principal.onclick = () => cartao.aoDesconectar();
      novo.push(linhaDaConexao(estado));
    }
    cabecalho.replaceChildren(titulos, principal);
    corpo.replaceChildren(...novo);
  }

  cartao.recarregar = async () => {
    try {
      estado = await carregar();
      erro.textContent = '';
      desenhar();
    } catch (falha) {
      // Não conseguir ler é diferente de não estar conectado: mostrar "Conectar" aqui levaria
      // o dono a refazer uma conexão que talvez exista.
      ajuda.textContent = '';
      cabecalho.replaceChildren(titulos);
      corpo.replaceChildren(elemento(doc, 'p', 'help', `Não foi possível ler a conta da Meta: ${falha?.message || 'erro desconhecido'}`));
    }
  };

  cartao.aoConectar = async () => {
    if (abrindo) return;
    abrindo = true;
    aviso.textContent = '';
    erro.textContent = '';
    desenhar();
    try {
      const { url } = await iniciar();
      navegar(url);
    } catch (falha) {
      abrindo = false;
      desenhar();
      erro.textContent = falha?.message || 'Não foi possível abrir o Facebook.';
    }
  };

  cartao.aoDesconectar = async () => {
    aviso.textContent = '';
    erro.textContent = '';
    try {
      await desconectar();
      await cartao.recarregar();
      aviso.textContent = 'Conta desconectada. Os públicos já criados continuam na conta de anúncios da Meta.';
    } catch (falha) {
      erro.textContent = falha?.message || 'Não foi possível desconectar.';
    }
  };

  return cartao;
}

// "Prefiro preencher manualmente" leva ao formulário que já existe: o destino da Meta (pixel
// e token da Conversions API) e, abaixo, as credenciais dos públicos.
function abrirPreenchimentoManual(doc) {
  const destino = doc.querySelector('#tracking-destinations details[data-provider="meta"]') || doc.querySelector('#publicos-meta');
  if (!destino) return;
  if (destino.tagName === 'DETAILS') destino.open = true;
  destino.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  destino.querySelector('input:not([type="hidden"]), select, textarea')?.focus({ preventScroll: true });
}

// Liga o cartão à API e ao painel "Rastreamento". `ligado` diz se a sessão trouxe
// runtime.metaConexao (META_APP_ID e META_APP_SECRET no servidor); sem isso, nem aparece.
export function criarConexaoMetaUI({ api, getShell, ligado = () => false, doc = document, navegar = (url) => window.location.assign(url) }) {
  let cartao = null;
  const empresa = () => getShell().state().currentCompany?.id;
  const projeto = () => getShell().state().currentProject?.id;
  const base = () => `/companies/${encodeURIComponent(empresa())}/meta-connection`;
  return {
    async abrir() {
      const painel = doc.querySelector('#project-settings-panel-rastreamento');
      if (!painel || !empresa() || !projeto() || !ligado() || !getShell().can('integration.manage')) { cartao?.remove(); return; }
      if (!cartao) {
        cartao = cartaoDaContaMeta(doc, {
          carregar: () => api(base()),
          iniciar: () => api(`${base()}/start`, 'POST', { projectId: projeto() }),
          desconectar: () => api(base(), 'DELETE'),
          navegar,
          irParaManual: () => abrirPreenchimentoManual(doc),
        });
      }
      if (painel.firstElementChild !== cartao) painel.prepend(cartao);
      await cartao.recarregar();
    },
  };
}
