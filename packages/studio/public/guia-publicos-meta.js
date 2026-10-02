// O guia "Como configurar os públicos da Meta", como pop-up dentro do Studio.
//
// A primeira versão foi uma página solta, em outra aba, com blocos demais e sem um link para os
// lugares da Meta onde a pessoa tem de ir: ela tinha de adivinhar onde aceitar os termos, onde
// achar o número da conta, onde gerar a chave. Aqui cada passo leva o botão do lugar certo.
//
// Os endereços são os dos artigos e portais oficiais da Meta, conferidos em 02/10/2026. Os
// nomes de menu da Meta mudam; por isso o guia diz o caminho em palavras, avisa que podem
// variar e aponta o artigo oficial como referência.
export const LINKS_DA_META = Object.freeze({
  gerenciadorDeAnuncios: 'https://adsmanager.facebook.com/',
  configuracoesDoNegocio: 'https://business.facebook.com/settings',
  gerenciadorDeEventos: 'https://business.facebook.com/events_manager2',
  meusApps: 'https://developers.facebook.com/apps/',
  ajudaNumeroDaConta: 'https://www.facebook.com/business/help/1492627900875762',
  ajudaUsuariosDoSistema: 'https://www.facebook.com/business/help/503306463479099',
  docGerarToken: 'https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/',
  docTermos: 'https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/custom-audience-terms-of-service',
  docPublicosDeSite: 'https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences',
});

// O que o Studio cria. Os nomes são os mesmos do catálogo (server/meta-publicos.mjs); um teste
// garante que não divergem.
const PUBLICOS_DO_GUIA = [
  ['Começou a assistir a VSL', 'Quem apertou o play. Remarketing, por até 30 dias.'],
  ['Assistiu 50% da VSL', 'Quem passou da metade do vídeo. Remarketing, por até 30 dias.'],
  ['Assistiu 75% da VSL', 'Quem chegou perto do fim, em geral o mais quente. Remarketing, por até 30 dias.'],
  ['Assistiu a VSL toda', 'Quem viu até o final. Remarketing, por até 30 dias.'],
  ['Clicou no botão da VSL', 'Quem clicou no botão que aparece sobre o vídeo. Remarketing, por até 30 dias.'],
  ['Virou lead', 'Quem deixou os dados num formulário. Este é para excluir: use para não mostrar anúncio de captação a quem já é lead. Vale por 180 dias.'],
];

export const PASSOS = Object.freeze([
  { id: 'pixel', titulo: 'Confira o pixel no Studio', texto: 'Os públicos nascem dos eventos que o seu pixel da Meta recebe. Veja se o ID do pixel já está salvo em Rastreamento, no ambiente de produção.' },
  { id: 'conta', titulo: 'Pegue o número da conta de anúncios', texto: 'É o número da conta onde os públicos vão aparecer. Ele também aparece no endereço do Gerenciador de Anúncios, depois de act=. Copie só os dígitos e cole aqui:' },
  { id: 'termos', titulo: 'Aceite os Termos de Públicos Personalizados', texto: 'A Meta só deixa o Studio criar públicos depois que uma pessoa com papel na conta de anúncios aceita estes termos. Cada pessoa aceita uma vez por empresa, e não pode ser um usuário do sistema.' },
  { id: 'chave', titulo: 'Crie a chave de acesso (token)', texto: 'No portfólio empresarial, vá em Configurações → Usuários → Usuários do sistema, crie um usuário e dê a ele acesso à sua conta de anúncios. Depois use "Gerar novo token", escolha o seu app e marque a permissão ads_management. Copie o token na hora: ele só é mostrado uma vez.' },
  { id: 'studio', titulo: 'Cole no Studio e ligue os públicos', texto: 'No cartão "Públicos automáticos na Meta", cole o número da conta e o token, salve e ligue os públicos que quiser. O token fica guardado com segurança e não aparece de novo.' },
]);

const TERMOS_BASE = 'https://business.facebook.com/ads/manage/customaudiences/tos/';
// Quem cola "act_123456" não erra: só os dígitos entram. Sem número, não há link.
export function linkDosTermos(entrada) {
  const numero = String(entrada ?? '').replace(/\D/g, '');
  return numero ? `${TERMOS_BASE}?act=${numero}` : null;
}

function el(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

const icone = (doc, nome) => {
  const no = el(doc, 'span', 'material-symbols-outlined', nome);
  no.setAttribute('aria-hidden', 'true');
  return no;
};

// Botão que sai do Studio: abre em outra aba, sem vazar a janela, e o ícone avisa que sai.
function linkExterno(doc, rotulo, href, { principal = false } = {}) {
  const link = el(doc, 'a', `guia-link${principal ? ' guia-link-principal' : ''}`);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(el(doc, 'span', '', rotulo), icone(doc, 'open_in_new'));
  return link;
}

function recolhivel(doc, titulo, ...filhos) {
  const bloco = el(doc, 'details', 'guia-recolhivel');
  bloco.append(el(doc, 'summary', '', titulo), ...filhos);
  return bloco;
}

function lista(doc, itens, tag = 'ul') {
  const no = el(doc, tag, 'guia-lista');
  for (const item of itens) {
    const li = el(doc, 'li');
    if (typeof item === 'string') li.textContent = item;
    else li.append(...item);
    no.append(li);
  }
  return no;
}

const negrito = (doc, texto) => el(doc, 'strong', '', texto);

function construir(doc) {
  const dialogo = el(doc, 'dialog', 'guia-dialog');
  dialogo.id = 'guia-publicos-meta';

  const topo = el(doc, 'header', 'guia-topo');
  const marca = el(doc, 'span', 'guia-marca');
  marca.append(icone(doc, 'help'));
  const titulos = el(doc, 'div');
  const titulo = el(doc, 'h2', '', 'Como configurar os públicos da Meta');
  titulo.id = 'guia-publicos-meta-titulo';
  titulos.append(titulo, el(doc, 'p', '', 'O Studio cria, na sua conta de anúncios, listas de pessoas a partir do que elas fazem no vídeo e na página. Você usa as listas nos anúncios.'));
  const fechar = el(doc, 'button', 'guia-fechar');
  fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Fechar');
  fechar.append(icone(doc, 'close'));
  fechar.onclick = () => dialogo.close();
  topo.append(marca, titulos, fechar);
  dialogo.setAttribute('aria-labelledby', titulo.id);

  const corpo = el(doc, 'div', 'guia-corpo');

  // O essencial: o que a pessoa precisa ter e os cinco passos, em ordem.
  const aviso = el(doc, 'p', 'guia-aviso');
  aviso.append(negrito(doc, 'Atenção: '), 'a chave que o Studio já guarda para enviar conversões (Conversions API) não serve para isto. Aqui é outra chave, com a permissão ', el(doc, 'code', '', 'ads_management'), '.');
  const passos = el(doc, 'ol', 'guia-passos');
  const ligacoes = {};
  for (const passo of PASSOS) {
    const item = el(doc, 'li', 'guia-passo');
    const corpoDoPasso = el(doc, 'div');
    corpoDoPasso.append(el(doc, 'h3', '', passo.titulo), el(doc, 'p', '', passo.texto));
    const acoes = el(doc, 'div', 'guia-acoes');

    if (passo.id === 'pixel' || passo.id === 'studio') {
      const ir = el(doc, 'button', 'guia-link guia-link-principal', passo.id === 'pixel' ? 'Abrir Rastreamento' : 'Abrir o cartão de públicos');
      ir.type = 'button';
      ir.dataset.irPara = 'pixel';
      ir.onclick = () => {
        // O pop-up fecha para a pessoa ver a tela; quem escuta o evento (app.js) leva até lá.
        dialogo.close();
        doc.dispatchEvent(new doc.defaultView.CustomEvent('alva:abrir-config', { detail: { assunto: 'pixel' } }));
      };
      acoes.append(ir);
    }
    if (passo.id === 'conta') {
      const campo = el(doc, 'input');
      campo.name = 'numero-da-conta';
      campo.type = 'text';
      campo.inputMode = 'numeric';
      campo.autocomplete = 'off';
      campo.maxLength = 40;
      campo.placeholder = 'Ex.: 1234567890';
      campo.setAttribute('aria-label', 'Número da conta de anúncios');
      ligacoes.campo = campo;
      corpoDoPasso.append(campo);
      acoes.append(linkExterno(doc, 'Abrir o Gerenciador de Anúncios', LINKS_DA_META.gerenciadorDeAnuncios, { principal: true }), linkExterno(doc, 'Ver onde fica o número', LINKS_DA_META.ajudaNumeroDaConta));
    }
    if (passo.id === 'termos') {
      // Sem o número do passo anterior o botão não leva a lugar nenhum: nada de adivinhar.
      const termos = el(doc, 'a', 'guia-link guia-link-principal');
      termos.dataset.linkDosTermos = '';
      termos.target = '_blank';
      termos.rel = 'noopener noreferrer';
      termos.append(el(doc, 'span', '', 'Abrir os termos da minha conta'), icone(doc, 'open_in_new'));
      const dica = el(doc, 'small', 'guia-dica', 'Digite o número da conta no passo 2 para liberar este botão.');
      ligacoes.termos = termos;
      ligacoes.dicaDosTermos = dica;
      acoes.append(termos, linkExterno(doc, 'Entender os termos', LINKS_DA_META.docTermos));
      corpoDoPasso.append(acoes, dica);
    }
    if (passo.id === 'chave') {
      const nota = el(doc, 'p', 'guia-dica', 'Você precisa ter um app do Facebook ligado ao portfólio empresarial. Os nomes dos menus da Meta mudam de tempos em tempos: se algo não bater, o guia oficial abaixo é a referência.');
      corpoDoPasso.append(nota);
      acoes.append(
        linkExterno(doc, 'Abrir as configurações do negócio', LINKS_DA_META.configuracoesDoNegocio, { principal: true }),
        linkExterno(doc, 'Passo a passo oficial', LINKS_DA_META.ajudaUsuariosDoSistema),
        linkExterno(doc, 'Como gerar o token', LINKS_DA_META.docGerarToken),
        linkExterno(doc, 'Criar um app', LINKS_DA_META.meusApps),
      );
    }
    if (passo.id !== 'termos') corpoDoPasso.append(acoes);
    item.append(corpoDoPasso);
    passos.append(item);
  }

  const atualizarTermos = () => {
    const href = linkDosTermos(ligacoes.campo.value);
    if (href) {
      ligacoes.termos.setAttribute('href', href);
      ligacoes.termos.removeAttribute('aria-disabled');
      ligacoes.dicaDosTermos.hidden = true;
    } else {
      ligacoes.termos.removeAttribute('href');
      ligacoes.termos.setAttribute('aria-disabled', 'true');
      ligacoes.dicaDosTermos.hidden = false;
    }
  };
  ligacoes.campo.addEventListener('input', atualizarTermos);
  atualizarTermos();

  // O resto fica recolhido: ajuda quem precisa e não vira um mural.
  const publicos = el(doc, 'div', 'guia-publicos');
  for (const [nome, descricao] of PUBLICOS_DO_GUIA) {
    const linha = el(doc, 'p');
    linha.append(negrito(doc, nome), ` — ${descricao}`);
    publicos.append(linha);
  }
  const noAnuncio = lista(doc, [
    [negrito(doc, 'Para voltar a anunciar: '), 'ao montar o conjunto de anúncios, escolha públicos personalizados e procure os que começam com "Alva ·". Por exemplo, anuncie uma oferta para quem assistiu 75% da VSL.'],
    [negrito(doc, 'Para não gastar com quem já é lead: '), 'no conjunto de anúncios de captação, use "Alva · Virou lead" na parte de excluir.'],
    'O público pode demorar um pouco para mostrar o tamanho. Ele enche conforme as pessoas assistem.',
  ]);
  const acoesDoAnuncio = el(doc, 'div', 'guia-acoes');
  acoesDoAnuncio.append(linkExterno(doc, 'Abrir o Gerenciador de Anúncios', LINKS_DA_META.gerenciadorDeAnuncios));
  const pequeno = lista(doc, [
    'Os eventos só saem de uma página publicada (em produção). Prévia e editor não contam.',
    'E só de quem aceitou a medição no aviso que aparece na página.',
    'Se você mudou o pixel no Studio, é preciso publicar de novo para valer. O botão fica amarelo quando há algo a publicar.',
  ]);
  const erros = lista(doc, [
    [negrito(doc, '"A Meta recusou o token": '), 'a chave está errada ou venceu. Gere outra e salve de novo.'],
    [negrito(doc, '"O token não tem permissão": '), 'a chave não tem ads_management, ou o usuário do sistema não recebeu acesso à conta de anúncios. Reveja o passo 4.'],
    [negrito(doc, 'A Meta recusou os dados do público: '), 'o motivo mais comum é não ter aceitado os Termos de Públicos Personalizados. Reveja o passo 3.'],
    [negrito(doc, 'Os de 50% e 75% ficam vazios: '), 'dependem de a Meta aceitar o filtro de porcentagem do vídeo, o que só se confirma com uma conta real. Se acontecer, avise a equipe do Studio: existe um jeito alternativo.'],
    [negrito(doc, 'Desliguei um público e ele continua na Meta: '), 'é de propósito. Desligar no Studio só esquece o público aqui; não apaga na Meta, para não derrubar anúncios que já usam ele.'],
  ]);
  const teste = lista(doc, [
    'No Gerenciador de Eventos, abra a aba de testar eventos.',
    'Abra uma página sua com VSL numa aba anônima, aceite a medição e assista até passar da metade.',
    'Confira se vsl_start e vsl_progress chegam.',
    'No Studio, ligue só "Assistiu 50% da VSL" e veja se o cartão mostra "criado".',
  ], 'ol');
  const acoesDoTeste = el(doc, 'div', 'guia-acoes');
  acoesDoTeste.append(linkExterno(doc, 'Abrir o Gerenciador de Eventos', LINKS_DA_META.gerenciadorDeEventos));

  corpo.append(
    aviso, passos,
    recolhivel(doc, 'O que cada público faz', publicos),
    recolhivel(doc, 'Como usar nos anúncios', noAnuncio, acoesDoAnuncio),
    recolhivel(doc, 'Se o público ficar pequeno ou vazio', pequeno),
    recolhivel(doc, 'Se algo der errado', erros),
    recolhivel(doc, 'Teste rápido, de 5 minutos', teste, acoesDoTeste),
  );

  const rodape = el(doc, 'footer', 'guia-rodape');
  rodape.append(el(doc, 'span', '', 'Guia oficial da Meta:'), linkExterno(doc, 'Públicos personalizados de site', LINKS_DA_META.docPublicosDeSite));

  dialogo.append(topo, corpo, rodape);
  // Clicar fora do pop-up fecha, como nos outros diálogos do Studio.
  dialogo.addEventListener('click', (evento) => { if (evento.target === dialogo) dialogo.close(); });
  return dialogo;
}

export function abrirGuiaPublicosMeta(doc = document) {
  let dialogo = doc.querySelector('dialog.guia-dialog');
  if (!dialogo) {
    dialogo = construir(doc);
    doc.body.append(dialogo);
  }
  if (!dialogo.hasAttribute('open')) dialogo.showModal();
  return dialogo;
}
