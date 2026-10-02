// Caixa de escolha com busca, no lugar do menu nativo do navegador: quem tem dezenas de contas
// de anúncios precisa achar a sua digitando, e o menu nativo não deixa desenhar nada.
// Teclado: setas, Enter, Esc e Tab; o painel fecha ao clicar fora.
const el = (doc, tag, classe, texto) => {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
};
const icone = (doc, nome) => {
  const no = el(doc, 'span', 'material-symbols-outlined', nome);
  no.setAttribute('aria-hidden', 'true');
  return no;
};
const semAcento = (texto) => String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Conta sem nome volta da Meta com o próprio número no lugar do nome: mostrar os dois seria repetir.
export function rotuloDaOpcao(opcao) {
  const nome = String(opcao.nome ?? '').trim();
  if (!nome || nome === opcao.id) return { titulo: opcao.id, detalhe: '' };
  return { titulo: nome, detalhe: opcao.id };
}

export function criarEscolhaPesquisavel(doc, { nome, rotulo, opcoes, valor = '', vazio, buscar = 'Buscar…', semResultado = 'Nada encontrado.', desligado = false, aoMudar = () => {} }) {
  const raiz = el(doc, 'div', 'escolha');
  raiz.dataset.nome = nome;
  const idDoPainel = `escolha-${nome}`;
  const botao = el(doc, 'button', 'escolha-botao');
  botao.type = 'button';
  botao.disabled = desligado;
  botao.setAttribute('aria-haspopup', 'listbox');
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-controls', idDoPainel);
  if (rotulo) botao.setAttribute('aria-label', rotulo);
  const texto = el(doc, 'span', 'escolha-texto');
  botao.append(texto, icone(doc, 'expand_more'));

  const painel = el(doc, 'div', 'escolha-painel');
  painel.id = idDoPainel;
  painel.hidden = true;
  const busca = doc.createElement('input');
  busca.type = 'search';
  busca.className = 'escolha-busca';
  busca.placeholder = buscar;
  busca.autocomplete = 'off';
  busca.setAttribute('aria-label', buscar);
  const lista = el(doc, 'ul', 'escolha-lista');
  lista.setAttribute('role', 'listbox');
  painel.append(busca, lista);
  raiz.append(botao, painel);

  let atual = valor;
  let visiveis = [];
  let destaque = -1;

  const escolhida = () => opcoes.find((opcao) => opcao.id === atual);
  function pintarBotao() {
    const opcao = escolhida();
    texto.replaceChildren();
    texto.classList.toggle('vazio', !opcao);
    if (!opcao) { texto.textContent = vazio; return; }
    const { titulo, detalhe } = rotuloDaOpcao(opcao);
    texto.append(el(doc, 'span', 'escolha-titulo', titulo));
    if (detalhe) texto.append(el(doc, 'small', 'escolha-detalhe', detalhe));
  }
  function pintarLista() {
    const termo = semAcento(busca.value.trim());
    visiveis = opcoes.filter((opcao) => !termo || semAcento(`${opcao.nome ?? ''} ${opcao.id}`).includes(termo));
    lista.replaceChildren();
    if (!visiveis.length) { lista.append(el(doc, 'li', 'escolha-vazio', semResultado)); destaque = -1; return; }
    visiveis.forEach((opcao, posicao) => {
      const item = el(doc, 'li', 'escolha-opcao');
      item.setAttribute('role', 'option');
      item.id = `${idDoPainel}-${posicao}`;
      item.dataset.valor = opcao.id;
      item.setAttribute('aria-selected', String(opcao.id === atual));
      const { titulo, detalhe } = rotuloDaOpcao(opcao);
      const quem = el(doc, 'span', 'escolha-opcao-texto');
      quem.append(el(doc, 'span', 'escolha-titulo', titulo));
      if (detalhe) quem.append(el(doc, 'small', 'escolha-detalhe', detalhe));
      item.append(quem);
      if (opcao.id === atual) item.append(icone(doc, 'check'));
      item.addEventListener('mousedown', (evento) => evento.preventDefault());
      item.addEventListener('click', () => escolher(opcao.id));
      lista.append(item);
    });
    marcar(Math.max(0, visiveis.findIndex((opcao) => opcao.id === atual)));
  }
  function marcar(posicao) {
    destaque = posicao;
    [...lista.children].forEach((item, i) => item.classList.toggle('destaque', i === posicao));
    const alvo = lista.children[posicao];
    if (alvo?.id) busca.setAttribute('aria-activedescendant', alvo.id); else busca.removeAttribute('aria-activedescendant');
    alvo?.scrollIntoView?.({ block: 'nearest' });
  }
  function aberto() { return !painel.hidden; }
  function abrir() {
    if (desligado || aberto()) return;
    painel.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    busca.value = '';
    pintarLista();
    busca.focus({ preventScroll: true });
    doc.addEventListener('mousedown', foraDaCaixa, true);
  }
  function fechar({ devolverFoco = false } = {}) {
    if (!aberto()) return;
    painel.hidden = true;
    botao.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('mousedown', foraDaCaixa, true);
    if (devolverFoco) botao.focus({ preventScroll: true });
  }
  function foraDaCaixa(evento) { if (!raiz.contains(evento.target)) fechar(); }
  function escolher(novo) {
    const mudou = novo !== atual;
    atual = novo;
    pintarBotao();
    fechar({ devolverFoco: true });
    if (mudou) aoMudar(novo);
  }

  botao.addEventListener('click', () => (aberto() ? fechar({ devolverFoco: true }) : abrir()));
  botao.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') { evento.preventDefault(); abrir(); }
  });
  busca.addEventListener('input', pintarLista);
  busca.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown') { evento.preventDefault(); if (visiveis.length) marcar((destaque + 1) % visiveis.length); }
    else if (evento.key === 'ArrowUp') { evento.preventDefault(); if (visiveis.length) marcar((destaque - 1 + visiveis.length) % visiveis.length); }
    else if (evento.key === 'Enter') { evento.preventDefault(); if (visiveis[destaque]) escolher(visiveis[destaque].id); }
    else if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); fechar({ devolverFoco: true }); }
    else if (evento.key === 'Tab') fechar();
  });

  Object.defineProperty(raiz, 'value', { get: () => atual });
  pintarBotao();
  return raiz;
}
