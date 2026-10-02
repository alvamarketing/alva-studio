// O bloco da Meta no cartão "Plataformas" (aba Rastreamento das configurações do projeto).
// Era o cartão "Conta da Meta", acima de "Destinos"; desde 02/10/2026 é o primeiro bloco
// da grade (plataformas-ui.js), largo, com o logo da Meta. Contrato visual: a "Opção visual"
// da "Biblioteca visual" para o cabeçalho (quadrado + nome + linha curta) e os campos de
// "Dados da empresa" ("Empresa e equipe") para as caixas de escolha. Sem cor, raio, sombra
// ou peso de fonte próprios: tudo vem de styles.css e owner.css; o azul do botão oficial é
// --marca-facebook, a única cor de marca autorizada.
//
// A conexão é da empresa (spec 2026-10-02, D1): conectar aqui vale para todos os projetos.
// A escolha de conta de anúncios e pixel é DESTE projeto (F2): com ela, o pixel e a
// Conversions API e os públicos passam a usar a conexão, sem colar ID nem token. Havendo
// uma conta só com um pixel só, o bloco escolhe e grava sozinho, e avisa.
//
// D9: "Continuar com o Facebook" navega na mesma aba. Um pop-up aberto depois de um `await`
// é bloqueado no celular, e o facebook.com corta o `window.opener` — a volta vem por
// /conexoes/meta/retorno.

import { criarEscolhaPesquisavel } from './escolha-pesquisavel.js';
import { svgDaMarca } from './marcas.js';
import { adotarBloco, alternarManual, atualizarDicaDaConexao, chip as chipDe, devolverBlocoSimples, esqueletoDoBloco } from './plataformas-ui.js';

function elemento(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

function botao(doc, texto, { primario = false, desligado = false, classe = '' } = {}) {
  const no = elemento(doc, 'button', [primario ? 'primary' : '', classe].filter(Boolean).join(' '), texto);
  no.type = 'button';
  no.disabled = desligado;
  return no;
}

const dataCurta = (valor) => {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const AJUDA = {
  desconectado: 'Conecte a conta do Facebook que administra os seus anúncios. Vale para todos os projetos da empresa.',
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

// A linha de status da conexão: quem, quando e até quando, numa linha só.
export function linhaDaConexao(conexao) {
  const partes = [conexao.nome || 'Conta do Facebook'];
  const quem = conexao.conectadoPor?.nome && conexao.conectadoPor.nome !== conexao.nome ? ` por ${conexao.conectadoPor.nome}` : '';
  const quando = dataCurta(conexao.conectadoEm);
  partes.push(`conectado${quem}${quando ? ` em ${quando}` : ''}`);
  const dias = conexao.vencimento?.dias;
  if (conexao.precisaReconectar) partes.push(AJUDA.reconectar);
  else if (dias !== null && dias !== undefined && !conexao.vencimento?.venceEmBreve) partes.push(dias <= 0 ? 'acesso vencido' : `acesso vence em ${plural(dias, 'dia', 'dias')}`);
  return partes.join(' · ');
}

// O botão oficial da Meta ("Continue with Facebook"): azul da marca, logo f e texto brancos.
function botaoDoFacebook(doc, texto, desligado) {
  const no = botao(doc, '', { desligado, classe: 'botao-facebook' });
  const logo = elemento(doc, 'span', 'botao-facebook-logo');
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = svgDaMarca('facebook');
  no.append(logo, elemento(doc, 'span', '', texto));
  return no;
}

// `projeto` (F2, opcional): { carregar, contas, pixels(conta), escolher(dados),
// confirmarSubstituicao(), depoisDeEscolher() }. Sem ele, o bloco só conecta e desconecta.
export function cartaoDaContaMeta(doc, { carregar, iniciar, desconectar, navegar, irParaManual, confirmar = async () => true, projeto = null }) {
  const cartao = esqueletoDoBloco(doc, 'meta', 'Meta');
  cartao.id = 'conta-meta';
  cartao.classList.add('conta-meta');
  cartao.dataset.dono = 'conexao';
  const status = cartao.querySelector('.plataforma-status');
  const acoesDoTopo = cartao.querySelector('.plataforma-acoes');
  const corpo = cartao.querySelector('.plataforma-corpo');
  corpo.classList.add('conta-meta-corpo');
  const rodape = cartao.querySelector('.plataforma-rodape');
  const manual = rodape.querySelector('.plataforma-manual-botao');
  manual.onclick = () => irParaManual();
  // Enquanto os destinos não chegam, o formulário manual diz que está a caminho.
  cartao.querySelector('.plataforma-formulario').append(elemento(doc, 'p', 'help', 'Carregando o preenchimento manual…'));
  const aviso = elemento(doc, 'p', 'help conta-meta-aviso-texto');
  aviso.setAttribute('role', 'status');
  const erro = elemento(doc, 'p', 'form-error');
  erro.setAttribute('role', 'alert');
  cartao.append(aviso, erro);

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
  // O destino "Meta" como a grade o lê (destinosDeConversaoModel): diz se há manual.
  let destino = null;

  const chip = (texto, tom = '') => chipDe(doc, texto, tom);

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

  // Os estados do projeto numa fileira de chips: o que antes eram duas linhas de lista.
  function chipsDoProjeto() {
    const fileira = elemento(doc, 'div', 'conta-meta-chips');
    const origem = doProjeto?.destino?.origem;
    if (origem === 'connection') fileira.append(chip('Pixel e Conversions API ativos', 'positivo'));
    else if (origem === 'manual') fileira.append(chip('Pixel e Conversions API preenchidos à mão'));
    else fileira.append(chip('Pixel e Conversions API não configurados', 'alerta'));
    const termos = doProjeto?.termos;
    if (termos?.aceitos === true) fileira.append(chip('Termos aceitos', 'positivo'));
    else if (termos) {
      fileira.append(chip(termos.aceitos === false ? 'Termos pendentes' : 'Termos não conferidos', 'alerta'));
      if (termos.link) {
        const link = elemento(doc, 'a', 'guia-link');
        link.href = termos.link;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const icone = elemento(doc, 'span', 'material-symbols-outlined', 'open_in_new');
        icone.setAttribute('aria-hidden', 'true');
        link.append(elemento(doc, 'span', '', 'Aceitar os termos na Meta'), icone);
        fileira.append(link);
      }
    }
    return fileira;
  }

  // O estado do destino "Meta" (o mesmo da grade): "Enviando", "Modo de teste", "Precisa
  // reconectar", token perto de vencer. "Configurado" sem mais nada só aparece quando não há
  // outro lugar que o diga (desconectada); conectada, o chip do projeto já diz.
  function chipDoDestino({ tambemConfigurado = false } = {}) {
    if (!destino?.configured) return null;
    if (destino.precisaReconectar) return chip(destino.stateLabel, 'negativo');
    if (destino.state === 'teste') return chip(destino.stateLabel, 'alerta');
    if (destino.state === 'ok') return chip(destino.stateLabel, 'positivo');
    return tambemConfigurado ? chip(destino.stateLabel) : null;
  }

  // Sem os termos a Meta não deixa criar públicos: quando faltam, diz quem resolve.
  function explicacaoDosTermos() {
    const termos = doProjeto?.termos;
    if (!termos || termos.aceitos === true) return null;
    return elemento(doc, 'p', 'help conta-meta-termos', termos.aceitos === false
      ? 'Sem os termos de Públicos Personalizados a Meta não deixa criar públicos. Quem aceita é uma pessoa com acesso à conta de anúncios.'
      : 'Não foi possível conferir os termos de Públicos Personalizados agora. Se os públicos falharem, aceite-os pelo link.');
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
    if (!contas) {
      const atual = doProjeto?.escolha;
      const pixel = atual?.pixelId ? ` · pixel ${atual.pixelNome ? `${atual.pixelNome} (${atual.pixelId})` : atual.pixelId}` : '';
      bloco.append(elemento(doc, 'p', 'help', atual?.adAccountNome ? `Conta atual: ${atual.adAccountNome}${pixel}. Carregando as outras contas de anúncios…` : 'Carregando contas de anúncios…'));
      return bloco;
    }
    if (!contas.length) { bloco.append(elemento(doc, 'p', 'help', SEM_CONTAS)); return bloco; }
    const campos = elemento(doc, 'div', 'conta-meta-campos');
    campos.append(seletor('Conta de anúncios', 'adAccountId', contas, contaEscolhida, 'Escolha a conta de anúncios', (valor) => cartao.aoTrocarConta(valor)));
    if (contaEscolhida) {
      if (carregandoPixels) campos.append(elemento(doc, 'p', 'help', 'Carregando pixels…'));
      else if (erroDePixels) campos.append(elemento(doc, 'p', 'form-error', `Não foi possível ler os pixels: ${erroDePixels}`));
      else if (pixels && !pixels.length) campos.append(elemento(doc, 'p', 'help', SEM_PIXELS));
      else if (pixels) {
        campos.append(seletor('Pixel', 'pixelId', pixels, pixelEscolhido, 'Escolha o pixel', (valor) => { pixelEscolhido = valor; desenhar(); }));
      }
    }
    bloco.append(campos);
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
    secao.append(chipsDoProjeto());
    const termos = explicacaoDosTermos();
    if (termos) secao.append(termos);
    secao.append(elemento(doc, 'h3', '', 'Neste projeto'));
    if (doProjeto.destino?.origem === 'manual') {
      secao.append(elemento(doc, 'p', 'help', `Hoje o pixel ${doProjeto.destino.pixelId ?? ''} deste projeto está preenchido à mão. Escolha abaixo para passar a usar a conexão.`));
    }
    secao.append(formularioDeEscolha());
    if (avisoAutomatico) secao.append(elemento(doc, 'p', 'help conta-meta-automatico', avisoAutomatico));
    return secao;
  }

  function acoes(...botoes) {
    const grupo = elemento(doc, 'div', 'provider-actions');
    grupo.append(...botoes);
    return grupo;
  }

  // O rótulo do caminho manual diz o que ele abre: preencher, editar o que foi colado ou,
  // vindo da conexão, o código de teste (e a troca para o manual).
  function rotuloDoManual() {
    if (destino?.pelaConexao) return 'Código de teste e preenchimento manual';
    if (destino?.configured) return 'Editar preenchimento manual';
    return 'Preencher manualmente';
  }

  function desenhar() {
    const topo = [];
    const novo = [];
    let sair = null;
    if (!estado?.conectado) {
      // Desconectado: a linha de status diz o que há no manual, se houver.
      status.textContent = destino?.configured
        ? `${destino.description}${destino.publicValue ? ` · ${destino.publicValue}` : ''} · preenchido à mão`
        : AJUDA.desconectado;
      const doDestino = chipDoDestino({ tambemConfigurado: true });
      if (doDestino) topo.push(doDestino);
      const conectar = botaoDoFacebook(doc, abrindo ? 'Abrindo o Facebook…' : 'Continuar com o Facebook', abrindo);
      conectar.onclick = () => cartao.aoConectar();
      topo.push(conectar);
    } else if (estado.precisaReconectar) {
      status.textContent = linhaDaConexao({ ...estado, precisaReconectar: true });
      const reconectar = botao(doc, abrindo ? 'Abrindo o Facebook…' : 'Reconectar', { primario: true, desligado: abrindo });
      reconectar.onclick = () => cartao.aoConectar();
      topo.push(chip('Sem acesso', 'negativo'), reconectar);
      sair = botao(doc, 'Desconectar', { desligado: abrindo, classe: 'ghost' });
    } else {
      status.textContent = linhaDaConexao(estado);
      topo.push(chip('Conectado'));
      const doDestino = chipDoDestino();
      if (doDestino) topo.push(doDestino);
      if (estado.vencimento?.venceEmBreve) novo.push(avisoDeVencimento(estado));
      if (projeto) novo.push(secaoDoProjeto());
      sair = botao(doc, 'Desconectar', { classe: 'ghost' });
    }
    if (sair) sair.onclick = () => cartao.aoDesconectar();
    manual.textContent = rotuloDoManual();
    manual.disabled = abrindo;
    // "Neste projeto" só aparece conectado e com o projeto: a dica do formulário manual acompanha.
    cartao.dataset.conexao = estado?.conectado && !estado.precisaReconectar && projeto ? 'escolha' : 'desconectada';
    atualizarDicaDaConexao(cartao);
    acoesDoTopo.replaceChildren(...topo);
    corpo.replaceChildren(...novo);
    corpo.hidden = !novo.length;
    rodape.replaceChildren(manual, ...(sair ? [sair] : []));
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
    // A lista de contas leva segundos com dezenas de portfólios: o que já está salvo aparece antes dela.
    desenhar();
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

  // A grade avisa quando o destino "Meta" muda (ler, salvar, remover, trocar de ambiente).
  cartao.definirDestino = (novo) => {
    destino = novo;
    if (estado) desenhar();
  };

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
    // Primeira leitura: o bloco diz que está carregando em vez de aparecer vazio.
    if (!estado) {
      status.textContent = '';
      corpo.hidden = false;
      corpo.replaceChildren(elemento(doc, 'p', 'help', 'Carregando…'));
    }
    try {
      estado = await carregar();
      erro.textContent = '';
      if (projeto && estado?.conectado && !estado.precisaReconectar) {
        desenhar();
        await carregarProjeto();
      }
      desenhar();
    } catch (falha) {
      // Não conseguir ler é diferente de não estar conectado: mostrar "Continuar com o
      // Facebook" aqui levaria o dono a refazer uma conexão que talvez exista.
      status.textContent = '';
      acoesDoTopo.replaceChildren();
      corpo.hidden = false;
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

// Liga o bloco à API e à grade "Plataformas". `ligado` diz se a sessão trouxe
// runtime.metaConexao (META_APP_ID e META_APP_SECRET no servidor); sem isso, a Meta fica
// com o bloco simples da grade (só o manual).
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
      if (!painel || !empresa() || !projeto() || !ligado() || !getShell().can('integration.manage')) {
        if (cartao?.isConnected) devolverBlocoSimples(cartao);
        return;
      }
      if (!cartao) {
        cartao = cartaoDaContaMeta(doc, {
          carregar: () => api(base()),
          iniciar: () => api(`${base()}/start`, 'POST', { projectId: projeto() }),
          desconectar: () => api(base(), 'DELETE'),
          navegar,
          // "Preencher manualmente" abre o formulário que já existe, dentro do próprio bloco.
          irParaManual: () => alternarManual(cartao),
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
      const grade = painel.querySelector('#tracking-destinations');
      if (grade) adotarBloco(grade, cartao);
      else if (painel.firstElementChild !== cartao) painel.prepend(cartao);
      await cartao.recarregar();
    },
  };
}
