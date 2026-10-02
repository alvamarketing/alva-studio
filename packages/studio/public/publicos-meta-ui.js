// O cartão "Públicos automáticos na Meta", na aba Rastreamento das configurações do projeto.
// Contrato visual: wireframe "Empresa e equipe" — cartão `.surface` com `.surface-head`, como
// os outros cartões de configuração; o quadrado do ícone segue a "Opção visual" da
// "Biblioteca visual" e o interruptor, o `.toggle` de "Campos". Sem cor, raio ou sombra
// próprios: as classes vêm de styles.css e owner.css.
//
// Cada público é um interruptor que age na hora: ligar cria o público na Meta, desligar só
// esquece o registro (o público continua na conta de anúncios; apagar lá é decisão do dono).
// O token entra e não volta — o campo dele aparece sempre vazio, e em branco significa
// "manter o que está guardado".

const ESTADOS = {
  nao_criado: ['Desligado', 'off'],
  criado: ['Criado na Meta', 'ok'],
  erro: ['Erro', 'error'],
};

function elemento(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

export function cartaoDePublicosMeta(doc, { carregar, salvarCredenciais, removerCredenciais, sincronizar, esquecer }) {
  const cartao = elemento(doc, 'section', 'surface publicos-meta');
  cartao.id = 'publicos-meta';
  // Cartão enxuto (02/10/2026, pedido do dono): quadrado com ícone, título, um resumo
  // ("1 de 6 públicos ligados") e "Gerenciar públicos", que abre a lista.
  const cabecalho = elemento(doc, 'div', 'surface-head');
  const titulos = elemento(doc, 'div', 'publicos-meta-titulo');
  const icone = elemento(doc, 'span', 'publicos-meta-icone material-symbols-outlined', 'group');
  icone.setAttribute('aria-hidden', 'true');
  const textos = elemento(doc, 'div');
  const resumo = elemento(doc, 'p', 'helper publicos-meta-resumo', '');
  textos.append(elemento(doc, 'h2', '', 'Públicos automáticos na Meta'), resumo);
  titulos.append(icone, textos);
  // O guia (pop-up) explica o que cada público faz, o que a Meta exige e o passo a passo.
  // No canto do cabeçalho, só o ícone: o nome vai no rótulo acessível e na dica.
  const guia = elemento(doc, 'button', 'ajuda-botao ajuda-icone');
  guia.type = 'button';
  guia.dataset.guia = 'publicos-meta';
  guia.setAttribute('aria-label', 'Saiba como configurar o público da Meta');
  guia.title = 'Saiba como configurar o público da Meta';
  const iconeDeAjuda = elemento(doc, 'span', 'material-symbols-outlined', 'help');
  iconeDeAjuda.setAttribute('aria-hidden', 'true');
  guia.append(iconeDeAjuda);
  const alternar = elemento(doc, 'button', 'publicos-meta-alternar', 'Gerenciar públicos');
  alternar.type = 'button';
  alternar.setAttribute('aria-expanded', 'false');
  alternar.setAttribute('aria-controls', 'publicos-meta-corpo');
  alternar.onclick = () => cartao.alternar();
  const acoesDoTopo = elemento(doc, 'div', 'publicos-meta-acoes');
  acoesDoTopo.append(guia, alternar);
  cabecalho.append(titulos, acoesDoTopo);
  const aviso = elemento(doc, 'p', 'help');
  aviso.setAttribute('role', 'status');
  const erro = elemento(doc, 'p', 'form-error');
  erro.setAttribute('role', 'alert');
  const corpo = elemento(doc, 'div', 'publicos-meta-corpo');
  corpo.id = 'publicos-meta-corpo';
  cartao.append(cabecalho, corpo, aviso, erro);

  // Aberto ou recolhido: quem escolhe é a pessoa; até ela escolher, vale aberturaPadrao().
  let escolhaDaPessoa = null;
  function abrirOuFechar(aberto) {
    corpo.hidden = !aberto;
    alternar.setAttribute('aria-expanded', String(aberto));
  }
  // Outro projeto: a escolha do anterior não vale, volta a abertura padrão.
  cartao.esquecerEscolha = () => { escolhaDaPessoa = null; };
  cartao.alternar = (aberto = corpo.hidden) => {
    escolhaDaPessoa = aberto;
    abrirOuFechar(aberto);
    return aberto;
  };
  abrirOuFechar(false);
  alternar.hidden = true;

  let ocupado = false;

  function faltas(estado) {
    const bloco = elemento(doc, 'div', 'publicos-meta-faltas');
    for (const item of estado.faltando) {
      const linha = elemento(doc, 'div', 'publicos-meta-falta');
      linha.append(elemento(doc, 'strong', '', `Falta: ${item.titulo}`), elemento(doc, 'p', 'help', item.onde));
      bloco.append(linha);
    }
    return bloco;
  }

  function formularioDeCredenciais(estado) {
    const detalhes = elemento(doc, 'details', 'publicos-meta-credenciais-bloco');
    detalhes.open = !estado.credenciais.configuradas;
    detalhes.append(elemento(doc, 'summary', '', estado.credenciais.configuradas ? 'Credenciais da Meta · conta ' + estado.credenciais.adAccountId : 'Credenciais da Meta'));
    const form = elemento(doc, 'form', 'publicos-meta-credenciais');
    const rotuloConta = elemento(doc, 'label', '', 'ID da conta de anúncios');
    const conta = doc.createElement('input');
    conta.name = 'adAccountId'; conta.type = 'text'; conta.autocomplete = 'off'; conta.inputMode = 'numeric'; conta.maxLength = 24;
    conta.value = estado.credenciais.adAccountId ?? '';
    rotuloConta.append(conta);
    const rotuloToken = elemento(doc, 'label', '', 'Token de acesso (permissão ads_management)');
    const token = doc.createElement('input');
    token.name = 'token'; token.type = 'password'; token.autocomplete = 'off';
    token.placeholder = estado.credenciais.configuradas ? 'Guardado — deixe em branco para manter' : '';
    rotuloToken.append(token);
    const acoes = elemento(doc, 'div', 'provider-actions');
    const salvar = elemento(doc, 'button', 'primary', 'Salvar credenciais');
    salvar.type = 'submit';
    acoes.append(salvar);
    if (estado.credenciais.configuradas) {
      const remover = elemento(doc, 'button', '', 'Remover credenciais');
      remover.type = 'button';
      remover.onclick = () => cartao.aoRemoverCredenciais();
      acoes.append(remover);
    }
    form.append(rotuloConta, rotuloToken, acoes);
    form.addEventListener('submit', (evento) => cartao.aoSalvarCredenciais(evento));
    detalhes.append(form);
    return detalhes;
  }

  function linhaDoPublico(item, pode) {
    const linha = elemento(doc, 'div', 'publico-meta member-item');
    linha.dataset.chave = item.chave;
    const texto = elemento(doc, 'div', 'publico-meta-texto');
    const nome = elemento(doc, 'div', 'publico-meta-nome');
    const janela = [`${item.retencaoDias} dias`];
    if (item.uso === 'exclusao') janela.push('use em "Excluir" nos conjuntos de anúncio');
    nome.append(elemento(doc, 'strong', '', item.nome), elemento(doc, 'small', 'publico-meta-detalhe', janela.join(' · ')));
    // A descrição numa segunda linha curta; inteira na dica, se não couber.
    const descricao = elemento(doc, 'small', 'publico-meta-descricao', item.descricao);
    descricao.title = item.descricao;
    texto.append(nome, descricao);
    if (item.estado === 'erro' && item.erro) texto.append(elemento(doc, 'p', 'form-error', item.erro));
    const [rotulo, classe] = ESTADOS[item.estado] ?? ESTADOS.nao_criado;
    const estado = elemento(doc, 'span', `publico-meta-estado ${classe}`, rotulo);
    if (item.estado === 'criado' && item.metaId) estado.title = `ID na Meta ${item.metaId}`;
    const chave = doc.createElement('input');
    chave.type = 'checkbox';
    chave.setAttribute('role', 'switch');
    chave.setAttribute('aria-label', item.nome);
    chave.checked = item.estado === 'criado';
    chave.disabled = !pode || ocupado;
    chave.onchange = () => cartao.aoAlternar(item.chave, chave.checked);
    const direita = elemento(doc, 'div', 'publico-meta-acao');
    direita.append(estado, chave);
    linha.append(texto, direita);
    return linha;
  }

  // Recolhido por padrão só quando já há público criado e nada pede atenção (falta, erro).
  // Sem nenhum criado, a lista é o que a pessoa veio ver; com falta ou erro, ela precisa agir.
  function aberturaPadrao(estado) {
    const criados = estado.publicos.filter((item) => item.estado === 'criado').length;
    return criados === 0 || estado.faltando.length > 0 || estado.publicos.some((item) => item.estado === 'erro');
  }

  function textoDoResumo(estado) {
    const total = estado.publicos.length;
    const criados = estado.publicos.filter((item) => item.estado === 'criado').length;
    const partes = [`${criados} de ${total} ${total === 1 ? 'público ligado' : 'públicos ligados'}`];
    const comErro = estado.publicos.filter((item) => item.estado === 'erro').length;
    if (comErro) partes.push(`${comErro} com erro`);
    if (estado.faltando.length) partes.push(`falta: ${estado.faltando.map((item) => item.titulo).join(', ')}`);
    return partes.join(' · ');
  }

  function desenhar(estado) {
    const pode = estado.credenciais.configuradas && Boolean(estado.pixelId);
    const novo = [elemento(doc, 'p', 'help publicos-meta-explicacao', 'O Studio cria, na sua conta de anúncios, públicos de remarketing a partir do que as suas páginas e VSLs já medem. Ligue os que quiser usar.')];
    if (estado.faltando.length) novo.push(faltas(estado));
    // A credencial colada à mão só aparece quando é ela que vale: vinda da conexão, é ruído.
    if (estado.credenciais.origem !== 'connection') novo.push(formularioDeCredenciais(estado));
    const lista = elemento(doc, 'div', 'member-list publicos-meta-lista');
    for (const item of estado.publicos) lista.append(linhaDoPublico(item, pode));
    novo.push(lista);
    corpo.replaceChildren(...novo);
    resumo.textContent = textoDoResumo(estado);
    alternar.hidden = false;
    abrirOuFechar(escolhaDaPessoa ?? aberturaPadrao(estado));
  }

  cartao.recarregar = async () => {
    try {
      desenhar(await carregar());
      erro.textContent = '';
    } catch (falha) {
      // Não conseguir ler é diferente de não haver nada: desenhar todos como "desligado"
      // diria ao dono que os públicos sumiram.
      corpo.replaceChildren(elemento(doc, 'p', 'help', `Não foi possível ler os públicos deste projeto: ${falha?.message || 'erro desconhecido'}`));
      resumo.textContent = '';
      alternar.hidden = true;
      abrirOuFechar(true);
    }
  };

  async function agir(tarefa) {
    ocupado = true;
    aviso.textContent = '';
    erro.textContent = '';
    for (const chave of cartao.querySelectorAll('input[role="switch"]')) chave.disabled = true;
    let mensagem = '';
    try { await tarefa(); } catch (falha) { mensagem = falha?.message || 'Não foi possível concluir.'; }
    ocupado = false;
    await cartao.recarregar();
    if (mensagem) erro.textContent = mensagem;
  }

  cartao.aoAlternar = (chave, ligado) => agir(async () => {
    if (ligado) { await sincronizar([chave]); return; }
    await esquecer(chave);
    aviso.textContent = 'O público continua na conta de anúncios da Meta. Apague-o por lá se não quiser mais.';
  });

  cartao.aoSalvarCredenciais = (evento) => {
    evento?.preventDefault?.();
    const form = cartao.querySelector('form.publicos-meta-credenciais');
    const dados = { adAccountId: form.elements.adAccountId.value.trim() };
    const token = form.elements.token.value.trim();
    if (token) dados.token = token;
    return agir(async () => {
      await salvarCredenciais(dados);
      aviso.textContent = 'Credenciais guardadas.';
    });
  };

  cartao.aoRemoverCredenciais = () => agir(async () => {
    await removerCredenciais();
    aviso.textContent = 'Credenciais removidas. Os públicos já criados continuam na conta de anúncios da Meta.';
  });

  return cartao;
}

// Liga o cartão à API do Studio e ao painel "Rastreamento" das configurações do projeto.
// `abrir` é chamado cada vez que as configurações abrem: o cartão é criado uma vez e só
// recarrega o estado depois — quem não pode gerenciar integrações nem o vê, porque as
// rotas exigem essa permissão.
export function criarPublicosMetaUI({ api, getShell, doc = document }) {
  let cartao = null;
  let projetoDoCartao = null;
  const projeto = () => getShell().state().currentProject?.id;
  const base = () => `/projects/${projeto()}/meta-audiences`;
  return {
    async abrir() {
      const painel = doc.querySelector('#project-settings-panel-rastreamento');
      if (!painel || !projeto()) return;
      if (!getShell().can('integration.manage')) { cartao?.remove(); return; }
      if (!cartao) {
        cartao = cartaoDePublicosMeta(doc, {
          carregar: () => api(base()),
          salvarCredenciais: (dados) => api(`${base()}/credentials`, 'PUT', dados),
          removerCredenciais: () => api(`${base()}/credentials`, 'DELETE'),
          sincronizar: (chaves) => api(`${base()}/sync`, 'POST', { chaves }),
          esquecer: (chave) => api(`${base()}/audiences/${encodeURIComponent(chave)}`, 'DELETE'),
        });
      }
      if (!painel.contains(cartao)) painel.append(cartao);
      if (projetoDoCartao !== projeto()) { cartao.esquecerEscolha(); projetoDoCartao = projeto(); }
      await cartao.recarregar();
    },
  };
}
