// O cartão "Públicos automáticos na Meta", na aba Rastreamento das configurações do projeto.
// Contrato visual: wireframe "Empresa e equipe" — cartão `.surface` com `.surface-head`, como
// os outros cartões de configuração. Sem cor, raio ou sombra próprios: as classes vêm de
// styles.css e owner.css.
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
  const cabecalho = elemento(doc, 'div', 'surface-head');
  const titulos = elemento(doc, 'div');
  titulos.append(
    elemento(doc, 'h2', '', 'Públicos automáticos na Meta'),
    elemento(doc, 'p', 'helper', 'O Studio cria, na sua conta de anúncios, públicos de remarketing a partir do que as suas páginas e VSLs já medem. Ligue os que quiser usar. Para quem já virou lead não ver mais o anúncio, escolha "Virou lead" em "Excluir" no conjunto de anúncios.'),
  );
  // O guia explica o que cada público faz, o que a Meta exige antes e o passo a passo.
  const guia = elemento(doc, 'a', 'ajuda-link', 'Saiba como configurar o público da Meta');
  guia.href = '/ajuda/publicos-meta';
  guia.target = '_blank';
  guia.rel = 'noopener noreferrer';
  titulos.append(guia);
  cabecalho.append(titulos);
  const aviso = elemento(doc, 'p', 'help');
  aviso.setAttribute('role', 'status');
  const erro = elemento(doc, 'p', 'form-error');
  erro.setAttribute('role', 'alert');
  const corpo = elemento(doc, 'div', 'publicos-meta-corpo');
  cartao.append(cabecalho, corpo, aviso, erro);

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
    const texto = elemento(doc, 'div');
    const nome = elemento(doc, 'strong', '', item.nome);
    texto.append(nome, elemento(doc, 'span', '', item.descricao));
    const detalhe = [`Janela de ${item.retencaoDias} dias`];
    if (item.uso === 'exclusao') detalhe.push('Use em "Excluir" nos conjuntos de anúncio');
    if (item.estado === 'criado' && item.metaId) detalhe.push(`ID na Meta ${item.metaId}`);
    texto.append(elemento(doc, 'small', 'publico-meta-detalhe', detalhe.join(' · ')));
    if (item.estado === 'erro' && item.erro) texto.append(elemento(doc, 'p', 'form-error', item.erro));
    const [rotulo, classe] = ESTADOS[item.estado] ?? ESTADOS.nao_criado;
    const estado = elemento(doc, 'span', `publico-meta-estado ${classe}`, rotulo);
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

  function desenhar(estado) {
    const pode = estado.credenciais.configuradas && Boolean(estado.pixelId);
    const novo = [];
    if (estado.faltando.length) novo.push(faltas(estado));
    novo.push(formularioDeCredenciais(estado));
    const lista = elemento(doc, 'div', 'member-list publicos-meta-lista');
    for (const item of estado.publicos) lista.append(linhaDoPublico(item, pode));
    novo.push(lista);
    corpo.replaceChildren(...novo);
  }

  cartao.recarregar = async () => {
    try {
      desenhar(await carregar());
      erro.textContent = '';
    } catch (falha) {
      // Não conseguir ler é diferente de não haver nada: desenhar todos como "desligado"
      // diria ao dono que os públicos sumiram.
      corpo.replaceChildren(elemento(doc, 'p', 'help', `Não foi possível ler os públicos deste projeto: ${falha?.message || 'erro desconhecido'}`));
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
      await cartao.recarregar();
    },
  };
}
