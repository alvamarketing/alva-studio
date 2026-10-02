// O cartão "Conta da Meta", no topo da aba Rastreamento das configurações do projeto.
// Contrato visual: wireframe "Empresa e equipe" — cartão `.surface` com `.surface-head`
// (seção "Equipe": linha de pessoa `.member-item`, `.role-chip`; seção "Dados da empresa":
// rótulo + campo para os seletores). Sem cor, raio, sombra ou peso de fonte próprios: tudo
// vem de styles.css e owner.css.
//
// A conexão é da empresa (spec 2026-10-02, D1): conectar aqui vale para todos os projetos.
// A escolha de conta de anúncios e pixel é DESTE projeto (F2): com ela, o destino "Meta"
// (pixel e Conversions API) e os públicos passam a usar a conexão, sem colar ID nem token.
// Havendo uma conta só com um pixel só, o cartão escolhe e grava sozinho, e avisa.
//
// D9: "Conectar" navega na mesma aba. Um pop-up aberto depois de um `await` é bloqueado no
// celular, e o facebook.com corta o `window.opener` — a volta vem por /conexoes/meta/retorno.

import { criarEscolhaPesquisavel } from './escolha-pesquisavel.js';

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
  conectadoComProjeto: 'A conexão vale para todos os projetos da empresa. Abaixo, a conta de anúncios e o pixel deste projeto.',
  reconectar: 'A Meta não aceita mais esta conexão. Conecte de novo para continuar.',
};

const SEM_CONTAS = 'Nenhuma conta de anúncios encontrada — confira se a conta tem acesso no Gerenciador de Negócios.';
const SEM_PIXELS = 'Nenhum pixel nesta conta de anúncios — crie um no Gerenciador de Eventos ou escolha outra conta.';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Quanto falta para o acesso vencer, em palavras. Vazio quando a Meta não informou.
export function textoDoVencimento(vencimento) {
  const dias = vencimento?.dias;
  if (dias === null || dias === undefined) return '';
  if (dias <= 0) return 'O acesso à Meta venceu.';
  return `O acesso à Meta vence em ${plural(dias, 'dia', 'dias')}.`;
}

// `projeto` (F2, opcional): { carregar, contas, pixels(conta), escolher(dados),
// confirmarSubstituicao(), depoisDeEscolher() }. Sem ele, o cartão só conecta e desconecta.
export function cartaoDaContaMeta(doc, { carregar, iniciar, desconectar, navegar, irParaManual, confirmar = async () => true, projeto = null }) {
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
  // F2: o que este projeto escolheu e as listas da Meta.
  let doProjeto = null;
  let erroDoProjeto = '';
  let contas = null;
  let erroDeContas = '';
  let contaEscolhida = '';
  let pixels = null;
  let erroDePixels = '';
  let carregandoPixels = false;
  let pixelEscolhido = '';
  let gravando = false;
  let avisoAutomatico = '';

  // O tom do chip: o padrão (azul) é "Conectado"; alerta, negativo e positivo usam os tokens
  // de status que já existem (owner.css).
  function chip(texto, tom = '') {
    return elemento(doc, 'span', tom ? `role-chip ${tom}` : 'role-chip', texto);
  }

  function linhaDaConexao(conexao) {
    // Com as linhas do projeto abaixo, a conexão ganha a mesma divisória das linhas da "Equipe".
    const lista = elemento(doc, 'div', projeto && !conexao.precisaReconectar ? 'member-list conta-meta-conexao com-divisoria' : 'member-list conta-meta-conexao');
    const linha = elemento(doc, 'div', 'member-item');
    const texto = elemento(doc, 'div');
    const quem = conexao.conectadoPor?.nome ? `Conectado por ${conexao.conectadoPor.nome}` : 'Conectado';
    const quando = dataCurta(conexao.conectadoEm);
    texto.append(elemento(doc, 'strong', '', conexao.nome || 'Conta do Facebook'), elemento(doc, 'span', '', quando ? `${quem} em ${quando}` : quem));
    const vence = textoDoVencimento(conexao.vencimento);
    if (vence && !conexao.vencimento?.venceEmBreve) texto.append(elemento(doc, 'span', 'conta-meta-vencimento', vence));
    linha.append(texto, conexao.precisaReconectar ? chip('Sem acesso', 'negativo') : chip('Conectado'));
    lista.append(linha);
    return lista;
  }

  // Vence em até 7 dias: aviso destacado, com o Reconectar à mão. Vencido, o envio para.
  function avisoDeVencimento(conexao) {
    const bloco = elemento(doc, 'div', 'conta-meta-aviso');
    bloco.setAttribute('role', 'alert');
    const texto = elemento(doc, 'div');
    texto.append(
      elemento(doc, 'strong', '', textoDoVencimento(conexao.vencimento)),
      elemento(doc, 'p', 'help', 'A Meta não renova este acesso sozinha. Reconecte antes do prazo para o pixel, a Conversions API e os públicos não pararem.'),
    );
    const reconectar = botao(doc, abrindo ? 'Abrindo o Facebook…' : 'Reconectar', { primario: true, desligado: abrindo });
    reconectar.onclick = () => cartao.aoConectar();
    bloco.append(texto, reconectar);
    return bloco;
  }

  function linha(titulo, detalhe, rotulo, tom = '') {
    const item = elemento(doc, 'div', 'member-item');
    const texto = elemento(doc, 'div');
    texto.append(elemento(doc, 'strong', '', titulo));
    if (typeof detalhe === 'string') { if (detalhe) texto.append(elemento(doc, 'span', '', detalhe)); } else if (detalhe) texto.append(detalhe);
    item.append(texto);
    if (rotulo) item.append(chip(rotulo, tom));
    return item;
  }

  function linhaDoDestino() {
    const destino = doProjeto?.destino;
    const escolha = doProjeto?.escolha;
    if (destino?.origem === 'connection') {
      const pixel = escolha?.pixelId === destino.pixelId && escolha?.pixelNome ? `${escolha.pixelNome} (${destino.pixelId})` : `Pixel ${destino.pixelId}`;
      return linha('Pixel e Conversions API configurados pela conexão', `${pixel}. O token é o da conta conectada; nada foi colado.`, 'Ativo', 'positivo');
    }
    if (destino?.origem === 'manual') return linha('Pixel e Conversions API preenchidos à mão', `Pixel ${destino.pixelId ?? ''} em "Destinos". Escolha abaixo para passar a usar a conexão.`, 'Manual');
    return linha('Pixel e Conversions API', 'Ainda não configurados neste projeto. Escolha a conta e o pixel abaixo.');
  }

  function linhaDosTermos() {
    const termos = doProjeto?.termos;
    if (!termos) return null;
    if (termos.aceitos === true) return linha('Termos de Públicos Personalizados', 'Aceitos nesta conta de anúncios.', 'Aceitos', 'positivo');
    const detalhe = elemento(doc, 'div', 'conta-meta-termos');
    detalhe.append(elemento(doc, 'span', '', termos.aceitos === false
      ? 'Ainda não aceitos. Sem eles a Meta não deixa criar públicos. Quem aceita é uma pessoa com acesso à conta, no link abaixo.'
      : 'Não foi possível conferir agora. Se os públicos falharem, aceite os termos no link abaixo.'));
    if (termos.link) {
      const link = elemento(doc, 'a', 'guia-link');
      link.href = termos.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const icone = elemento(doc, 'span', 'material-symbols-outlined', 'open_in_new');
      icone.setAttribute('aria-hidden', 'true');
      link.append(elemento(doc, 'span', '', 'Aceitar os termos na Meta'), icone);
      detalhe.append(link);
    }
    return linha('Termos de Públicos Personalizados', detalhe, termos.aceitos === false ? 'Pendente' : undefined, 'alerta');
  }

  function seletor(rotulo, nome, opcoes, valor, vazio, aoMudar) {
    const campo = elemento(doc, 'div', 'conta-meta-campo');
    campo.append(elemento(doc, 'span', 'conta-meta-rotulo', rotulo));
    campo.append(criarEscolhaPesquisavel(doc, { nome, rotulo, opcoes, valor, vazio, desligado: gravando, aoMudar }));
    return campo;
  }

  function formularioDeEscolha() {
    const bloco = elemento(doc, 'div', 'conta-meta-escolha');
    if (erroDeContas) { bloco.append(elemento(doc, 'p', 'form-error', `Não foi possível ler as contas de anúncios: ${erroDeContas}`)); return bloco; }
    if (!contas) { bloco.append(elemento(doc, 'p', 'help', 'Carregando contas de anúncios…')); return bloco; }
    if (!contas.length) { bloco.append(elemento(doc, 'p', 'help', SEM_CONTAS)); return bloco; }
    bloco.append(seletor('Conta de anúncios', 'adAccountId', contas, contaEscolhida, 'Escolha a conta de anúncios', (valor) => cartao.aoTrocarConta(valor)));
    if (contaEscolhida) {
      if (carregandoPixels) bloco.append(elemento(doc, 'p', 'help', 'Carregando pixels…'));
      else if (erroDePixels) bloco.append(elemento(doc, 'p', 'form-error', `Não foi possível ler os pixels: ${erroDePixels}`));
      else if (pixels && !pixels.length) bloco.append(elemento(doc, 'p', 'help', SEM_PIXELS));
      else if (pixels) {
        bloco.append(seletor('Pixel', 'pixelId', pixels, pixelEscolhido, 'Escolha o pixel', (valor) => { pixelEscolhido = valor; desenhar(); }));
      }
    }
    const atual = doProjeto?.escolha;
    const igual = Boolean(atual) && atual.adAccountId === contaEscolhida && atual.pixelId === pixelEscolhido && doProjeto?.destino?.origem === 'connection';
    const usar = botao(doc, gravando ? 'Configurando…' : 'Usar esta conta e este pixel', { primario: true, desligado: gravando || !contaEscolhida || !pixelEscolhido || igual });
    usar.onclick = () => cartao.aoEscolher();
    bloco.append(acoes(usar));
    return bloco;
  }

  function secaoDoProjeto() {
    const secao = elemento(doc, 'div', 'conta-meta-projeto');
    if (erroDoProjeto) { secao.append(elemento(doc, 'p', 'help', `Não foi possível ler a escolha deste projeto: ${erroDoProjeto}`)); return secao; }
    if (!doProjeto) { secao.append(elemento(doc, 'p', 'help', 'Carregando a conta de anúncios deste projeto…')); return secao; }
    const lista = elemento(doc, 'div', 'member-list');
    for (const item of [linhaDoDestino(), linhaDosTermos()]) if (item) lista.append(item);
    secao.append(lista, elemento(doc, 'h3', '', 'Neste projeto'), formularioDeEscolha());
    if (avisoAutomatico) secao.append(elemento(doc, 'p', 'help conta-meta-automatico', avisoAutomatico));
    return secao;
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
      ajuda.textContent = projeto ? AJUDA.conectadoComProjeto : AJUDA.conectado;
      principal = botao(doc, 'Desconectar');
      principal.onclick = () => cartao.aoDesconectar();
      novo.push(linhaDaConexao(estado));
      if (estado.vencimento?.venceEmBreve) novo.push(avisoDeVencimento(estado));
      if (projeto) novo.push(secaoDoProjeto());
    }
    cabecalho.replaceChildren(titulos, principal);
    corpo.replaceChildren(...novo);
  }

  // Há manual a substituir? Pixel/token do destino ou credencial dos públicos colados à mão.
  const temManual = () => doProjeto?.destino?.origem === 'manual' || doProjeto?.publicos?.origem === 'manual';

  async function lerPixels(conta) {
    pixels = null;
    erroDePixels = '';
    if (!conta) return;
    carregandoPixels = true;
    desenhar();
    try {
      pixels = (await projeto.pixels(conta)).pixels ?? [];
    } catch (falha) {
      erroDePixels = falha?.message || 'erro desconhecido';
    }
    carregandoPixels = false;
    const atual = doProjeto?.escolha;
    pixelEscolhido = atual?.adAccountId === conta && pixels?.some((item) => item.id === atual.pixelId) ? atual.pixelId
      : pixels?.length === 1 ? pixels[0].id : '';
  }

  async function gravar(dados) {
    gravando = true;
    desenhar();
    try {
      doProjeto = await projeto.escolher(dados);
      await projeto.depoisDeEscolher?.();
      return true;
    } catch (falha) {
      erro.textContent = falha?.message || 'Não foi possível usar esta conta e este pixel.';
      return false;
    } finally {
      gravando = false;
    }
  }

  async function carregarProjeto() {
    doProjeto = null;
    erroDoProjeto = '';
    contas = null;
    erroDeContas = '';
    pixels = null;
    avisoAutomatico = '';
    try {
      doProjeto = await projeto.carregar();
    } catch (falha) {
      erroDoProjeto = falha?.message || 'erro desconhecido';
      return;
    }
    if (doProjeto.precisaReconectar) { estado = { ...estado, precisaReconectar: true }; return; }
    try {
      contas = (await projeto.contas()).contas ?? [];
    } catch (falha) {
      erroDeContas = falha?.message || 'erro desconhecido';
      return;
    }
    const escolhida = doProjeto.escolha?.adAccountId;
    contaEscolhida = escolhida && contas.some((item) => item.id === escolhida) ? escolhida : contas.length === 1 ? contas[0].id : '';
    await lerPixels(contaEscolhida);
    // Uma conta só, um pixel só, nada escolhido e nada colado à mão: escolhe e grava sozinho.
    if (!doProjeto.escolha && contas.length === 1 && pixels?.length === 1 && !temManual()) {
      const [conta] = contas;
      const [pixel] = pixels;
      if (await gravar({ adAccountId: conta.id, pixelId: pixel.id, automatica: true })) {
        avisoAutomatico = `Escolhido automaticamente: conta "${conta.nome}" e pixel "${pixel.nome}" — eram os únicos disponíveis. O pixel e a Conversions API já usam a conexão.`;
      }
    }
  }

  cartao.aoTrocarConta = async (conta) => {
    contaEscolhida = conta;
    pixelEscolhido = '';
    erro.textContent = '';
    await lerPixels(conta);
    desenhar();
  };

  cartao.aoEscolher = async () => {
    if (!contaEscolhida || !pixelEscolhido || gravando) return;
    aviso.textContent = '';
    erro.textContent = '';
    const dados = { adAccountId: contaEscolhida, pixelId: pixelEscolhido };
    // D2: o que foi colado à mão só sai com confirmação explícita.
    if (temManual()) {
      if (!(await (projeto.confirmarSubstituicao?.() ?? false))) return;
      dados.substituirManual = true;
    }
    if (await gravar(dados)) {
      avisoAutomatico = '';
      aviso.textContent = 'Pronto: o pixel e a Conversions API deste projeto usam a conexão, e os públicos usam esta conta de anúncios.';
    }
    desenhar();
  };

  cartao.recarregar = async () => {
    // Primeira leitura: o cartão diz que está carregando em vez de aparecer vazio.
    if (!estado) corpo.replaceChildren(elemento(doc, 'p', 'help', 'Carregando…'));
    try {
      estado = await carregar();
      erro.textContent = '';
      if (projeto && estado?.conectado && !estado.precisaReconectar) {
        desenhar();
        await carregarProjeto();
      }
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
    // Desconectar também retira o acesso na Meta: quem aperta sem querer não pode perder a conexão.
    if (!(await confirmar())) return;
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
export function criarConexaoMetaUI({
  api, getShell, ligado = () => false, doc = document, navegar = (url) => window.location.assign(url), confirmar = async () => true,
  confirmarSubstituicao = async () => false, depoisDeEscolher = async () => {},
}) {
  let cartao = null;
  const empresa = () => getShell().state().currentCompany?.id;
  const projeto = () => getShell().state().currentProject?.id;
  const base = () => `/companies/${encodeURIComponent(empresa())}/meta-connection`;
  const doProjeto = () => `/projects/${encodeURIComponent(projeto())}/meta-connection`;
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
          confirmar,
          projeto: {
            carregar: () => api(doProjeto()),
            contas: () => api(`${base()}/ad-accounts`),
            pixels: (conta) => api(`${doProjeto()}/pixels?adAccountId=${encodeURIComponent(conta)}`),
            escolher: (dados) => api(`${doProjeto()}/selection`, 'PUT', dados),
            confirmarSubstituicao,
            depoisDeEscolher,
          },
        });
      }
      if (painel.firstElementChild !== cartao) painel.prepend(cartao);
      await cartao.recarregar();
    },
  };
}
