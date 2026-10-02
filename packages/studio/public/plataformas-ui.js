// O cartão "Plataformas", na aba Rastreamento das configurações do projeto: um bloco por
// plataforma de anúncio, numa grade (2 colunas no computador, 1 no celular). Cada bloco tem
// o logo, o nome, uma linha de status e a ação. Substitui a lista "Destinos" e o cartão
// "Conta da Meta" (02/10/2026, pedido do dono: "tudo muito colado e em lista").
//
// Contrato visual: o wireframe não desenha esta grade. O bloco segue a "Opção visual" da
// "Biblioteca visual" (quadrado com ícone + nome + linha curta) e o cartão segue "Empresa e
// equipe" (`.surface` + `.surface-head`). Sem cor, raio ou sombra próprios; a cor da marca
// só no quadrado do logo (owner.css, bloco --marca-*).
//
// O preenchimento manual não regride: todo bloco editável tem "Preencher manualmente" (ou
// "Editar", se já configurado à mão), que abre o mesmo formulário de antes — salvar,
// remover, prévia e produção separadas. As plataformas sem conexão direta ainda mostram o
// botão "Conectar com…" desativado e "Em breve"; a Meta já conecta (conexao-meta-ui.js), e o
// bloco dela é o próprio cartão da conexão, que entra no lugar do bloco simples.
import { rotuloDoSegredo } from './studio-dashboard.js';
import { SEM_LOGO, svgDaMarca } from './marcas.js';

// Ordem da grade e o texto do botão de cada plataforma. `conectar` vazio: sem botão "Em breve".
export const PLATAFORMAS = Object.freeze({
  meta: { marca: 'meta', conectar: '' },
  tiktok: { marca: 'tiktok', conectar: 'Conectar com o TikTok' },
  google: { marca: 'googleads', conectar: 'Conectar com o Google' },
  linkedin: { marca: 'linkedin', conectar: 'Conectar com o LinkedIn' },
  taboola: { marca: 'taboola', conectar: 'Conectar com a Taboola' },
});

const EM_BREVE = 'conexão direta em breve';
const SEM_PERMISSAO = 'Configurar plataformas exige permissão de integrações. Peça a um administrador do projeto.';

function el(doc, tag, classe, texto) {
  const no = doc.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined) no.textContent = texto;
  return no;
}

// O tom do chip pelo estado do modelo: enviando/configurado em positivo; teste, token perto de
// vencer e "precisa reconectar" em alerta; não configurado neutro.
const TOM = { ok: 'positivo', idle: 'positivo', teste: 'alerta', off: 'neutro' };
export function chip(doc, texto, tom = '') {
  return el(doc, 'span', tom ? `role-chip ${tom}` : 'role-chip', texto);
}

// O quadrado com o logo. Marca fora do simple-icons: a inicial, em tom neutro.
export function logoDaPlataforma(doc, marca) {
  const quadrado = el(doc, 'span', `plataforma-logo marca-${marca}`);
  quadrado.setAttribute('aria-hidden', 'true');
  const svg = svgDaMarca(marca);
  if (svg) quadrado.innerHTML = svg;
  else {
    quadrado.classList.add('sem-logo');
    quadrado.textContent = SEM_LOGO[marca]?.inicial ?? '';
  }
  return quadrado;
}

// O esqueleto que a grade guarda entre uma pintura e outra: o formulário aberto continua
// aberto quando os destinos são relidos, e o cartão da conexão (Meta) não é apagado.
export function esqueletoDoBloco(doc, provider, nome = '') {
  const bloco = el(doc, 'article', 'plataforma');
  bloco.dataset.provider = provider;
  if (provider === 'meta') bloco.classList.add('plataforma-larga');
  const cabeca = el(doc, 'div', 'plataforma-cabeca');
  const texto = el(doc, 'div', 'plataforma-texto');
  const status = el(doc, 'span', 'plataforma-status');
  status.id = `plataforma-status-${provider}`;
  texto.append(el(doc, 'strong', 'plataforma-nome', nome), status);
  cabeca.append(logoDaPlataforma(doc, PLATAFORMAS[provider]?.marca ?? provider), texto, el(doc, 'div', 'plataforma-acoes'));
  const corpo = el(doc, 'div', 'plataforma-corpo');
  const rodape = el(doc, 'div', 'plataforma-rodape');
  const formulario = el(doc, 'div', 'plataforma-formulario');
  formulario.id = `plataforma-formulario-${provider}`;
  formulario.hidden = true;
  rodape.append(botaoManual(doc, provider));
  bloco.append(cabeca, corpo, rodape, formulario);
  return bloco;
}

export function botaoManual(doc, provider, texto = 'Preencher manualmente') {
  const botao = el(doc, 'button', 'plataforma-manual-botao', texto);
  botao.type = 'button';
  botao.setAttribute('aria-expanded', 'false');
  botao.setAttribute('aria-controls', `plataforma-formulario-${provider}`);
  botao.onclick = () => alternarManual(botao.closest('.plataforma'));
  return botao;
}

// Abre ou fecha o formulário manual do bloco. Ao abrir, leva a pessoa até ele e põe o cursor
// no primeiro campo: é o que ela veio fazer.
export function alternarManual(bloco, abrir) {
  const formulario = bloco?.querySelector(':scope > .plataforma-formulario');
  if (!formulario) return false;
  const aberto = abrir ?? formulario.hidden;
  formulario.hidden = !aberto;
  for (const botao of bloco.querySelectorAll('.plataforma-manual-botao')) botao.setAttribute('aria-expanded', String(aberto));
  if (aberto) {
    formulario.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    formulario.querySelector('input:not([type="hidden"]), select, textarea')?.focus({ preventScroll: true });
  }
  return aberto;
}

// "Conectar com o TikTok": desativado, mas focável e explicado (aria-disabled + o status).
function botaoEmBreve(doc, provider, texto) {
  const botao = el(doc, 'button', 'plataforma-oficial');
  botao.type = 'button';
  botao.setAttribute('aria-disabled', 'true');
  botao.setAttribute('aria-describedby', `plataforma-status-${provider}`);
  botao.append(logoDaPlataforma(doc, PLATAFORMAS[provider].marca), el(doc, 'span', '', texto));
  botao.onclick = (evento) => evento.preventDefault();
  return botao;
}

// O bloco de uma plataforma sem conexão direta (ou da Meta sem o app configurado).
function pintarBlocoSimples(doc, bloco, destino, opcoes) {
  const plataforma = PLATAFORMAS[destino.provider] ?? { conectar: '' };
  const emBreve = !destino.configured && destino.editable && Boolean(plataforma.conectar);
  bloco.classList.toggle('em-breve', emBreve);
  bloco.dataset.estado = emBreve ? 'em-breve' : destino.configured ? 'configurado' : 'nao-configurado';
  bloco.querySelector('.plataforma-nome').textContent = destino.name;
  const status = bloco.querySelector('.plataforma-status');
  if (emBreve) status.textContent = `${destino.description} · ${EM_BREVE}`;
  else status.textContent = destino.publicValue ? `${destino.description} · ${destino.publicValue}` : destino.description;
  // O chip fica no canto do cabeçalho; o botão "Conectar com…" (em breve) logo abaixo, largo.
  bloco.querySelector('.plataforma-acoes').replaceChildren(emBreve ? chip(doc, 'Em breve', 'neutro') : chip(doc, destino.stateLabel, TOM[destino.state] ?? 'neutro'));
  const corpo = bloco.querySelector('.plataforma-corpo');
  corpo.replaceChildren(...(emBreve ? [botaoEmBreve(doc, destino.provider, plataforma.conectar)] : []));
  corpo.hidden = !emBreve;
  const manual = bloco.querySelector('.plataforma-manual-botao');
  manual.hidden = !destino.editable;
  manual.textContent = destino.configured ? 'Editar' : 'Preencher manualmente';
  bloco.querySelector('.plataforma-rodape').hidden = !destino.editable;
  const formulario = bloco.querySelector(':scope > .plataforma-formulario');
  if (destino.editable) formulario.replaceChildren(formularioDeDestino(doc, destino, opcoes));
  else { formulario.replaceChildren(); alternarManual(bloco, false); }
}

// Desenha a grade. `modelos` vem de destinosDeConversaoModel; `erro` é a falha ao ler os
// destinos (não é "nada configurado"); `aviso`, a entrega de conversões desligada.
export function pintarPlataformas(raiz, modelos, { doc = raiz.ownerDocument, salvar, remover, erro = '', aviso = '' } = {}) {
  raiz.pintura = { salvar, remover };
  raiz.classList.remove('providers');
  raiz.classList.add('plataformas-grade');
  const avisos = [];
  if (erro) avisos.push(`Não foi possível ler as plataformas deste ambiente: ${erro}`);
  else if (aviso) avisos.push(aviso);
  if (!erro && modelos.some((destino) => !destino.editable)) avisos.push(SEM_PERMISSAO);
  for (const velho of raiz.querySelectorAll(':scope > .plataformas-aviso')) velho.remove();
  const notas = avisos.map((texto) => el(doc, 'p', 'help plataformas-aviso', texto));
  const blocos = [];
  for (const destino of modelos) {
    let bloco = raiz.querySelector(`:scope > [data-provider="${destino.provider}"]`);
    if (!bloco) bloco = esqueletoDoBloco(doc, destino.provider, destino.name);
    bloco.destino = destino;
    if (bloco.dataset.dono === 'conexao') {
      // O cartão da conexão desenha o próprio cabeçalho; daqui vai só o formulário manual.
      bloco.querySelector(':scope > .plataforma-formulario')?.replaceChildren(formularioDeDestino(doc, destino, { salvar, remover }));
      bloco.definirDestino?.(destino);
      atualizarDicaDaConexao(bloco);
    } else {
      bloco.hidden = Boolean(erro);
      if (!erro) pintarBlocoSimples(doc, bloco, destino, { salvar, remover });
      atualizarDicaDaConexao(bloco);
    }
    blocos.push(bloco);
  }
  raiz.prepend(...notas);
  // A ordem da grade é a do modelo, com a Meta (larga) primeiro; reanexar só move.
  for (const bloco of blocos) raiz.append(bloco);
  return raiz;
}

// O cartão da conexão (Meta) entra no lugar do bloco simples e leva consigo o formulário
// manual que já estava pintado.
export function adotarBloco(raiz, cartao) {
  const provider = cartao.dataset.provider;
  const antigo = raiz.querySelector(`:scope > [data-provider="${provider}"]`);
  if (antigo === cartao) return cartao;
  if (antigo) {
    const formulario = antigo.querySelector(':scope > .plataforma-formulario');
    const destino = cartao.querySelector(':scope > .plataforma-formulario');
    if (formulario?.childElementCount && destino) destino.replaceChildren(...formulario.childNodes);
    if (antigo.destino) { cartao.destino = antigo.destino; cartao.definirDestino?.(antigo.destino); }
    atualizarDicaDaConexao(cartao);
    antigo.replaceWith(cartao);
  } else {
    const avisos = raiz.querySelectorAll(':scope > .plataformas-aviso');
    if (avisos.length) avisos[avisos.length - 1].after(cartao); else raiz.prepend(cartao);
  }
  return cartao;
}

// O cartão da conexão saiu (sem permissão, app desligado): volta o bloco simples, com o
// formulário manual — a Meta não pode sumir da grade.
export function devolverBlocoSimples(cartao) {
  const raiz = cartao?.parentElement;
  if (!raiz?.classList.contains('plataformas-grade')) { cartao?.remove(); return null; }
  const doc = cartao.ownerDocument;
  const bloco = esqueletoDoBloco(doc, cartao.dataset.provider);
  cartao.replaceWith(bloco);
  if (cartao.destino) {
    bloco.destino = cartao.destino;
    pintarBlocoSimples(doc, bloco, cartao.destino, raiz.pintura ?? {});
    atualizarDicaDaConexao(bloco);
  }
  return bloco;
}

// A dica de como trocar o pixel da Meta pela conexão. "Neste projeto" só existe no bloco da
// conexão com a conta conectada (data-conexao="escolha"); desconectado, o caminho é conectar;
// no bloco simples (sem o app da Meta ou sem permissão), só o manual.
const DICAS_DA_CONEXAO = {
  escolha: 'Para trocar o pixel, use "Neste projeto", acima.',
  desconectada: 'Para trocar o pixel pela conexão, use "Continuar com o Facebook" (ou "Reconectar"), acima.',
  ausente: 'A conexão com o Facebook não está disponível aqui; para trocar o pixel, use "Prefiro preencher manualmente".',
};
export function atualizarDicaDaConexao(bloco) {
  const texto = DICAS_DA_CONEXAO[bloco?.dataset.conexao] ?? DICAS_DA_CONEXAO.ausente;
  for (const dica of bloco?.querySelectorAll('[data-dica-conexao]') ?? []) dica.textContent = texto;
}

// O formulário manual de um destino — o mesmo de antes de existir a grade.
//
// O segredo entra e não volta: o servidor guarda cifrado e nunca o devolve, então o campo
// de token aparece sempre vazio, mesmo num destino já configurado. Deixá-lo em branco ao
// salvar mantém o que está lá.
export function formularioDeDestino(doc, destino, { salvar, remover } = {}) {
  const form = el(doc, 'form', 'provider-form');

  // Meta pela conexão: sem campo de token nem de pixel. "Prefiro preencher manualmente"
  // troca este formulário pelo completo; salvar com um token colado volta a origem para o
  // manual (D2), e o servidor apaga a referência à conexão.
  if (destino.pelaConexao) {
    const aviso = el(doc, 'p', 'help', destino.precisaReconectar
      ? `A conta da Meta conectada precisa ser conectada de novo: sem isso o pixel ${destino.publicValue} não recebe pela Conversions API. `
      : `Configurado pela conexão com o Facebook: pixel ${destino.publicValue}, com o token da conta conectada. Aqui fica só o código de teste. `);
    // Como trocar depende do bloco em que o formulário está: atualizarDicaDaConexao.
    const dica = el(doc, 'span', '');
    dica.dataset.dicaConexao = '';
    aviso.append(dica);
    form.append(aviso);
    const manual = el(doc, 'button', 'button ghost', 'Prefiro preencher manualmente');
    manual.type = 'button';
    manual.onclick = () => form.replaceWith(formularioDeDestino(doc, { ...destino, pelaConexao: false, semTokenGuardado: true, publicValue: '', fields: destino.camposManuais }, { salvar, remover }));
    form.append(manual);
  }
  if (destino.aviso) form.append(el(doc, 'p', 'help', destino.aviso));
  if (destino.semCredencial) form.append(el(doc, 'p', 'help', 'A Taboola identifica a conversão pelo clique que chega na URL da página. Não há credencial a guardar: basta ativar.'));
  for (const campo of destino.fields) {
    const rotulo = el(doc, 'label', '', campo.required ? campo.label : `${campo.label} (opcional)`);
    const entrada = doc.createElement('input');
    entrada.name = campo.name;
    entrada.autocomplete = 'off';
    if (campo.secret) {
      entrada.type = 'password';
      const { placeholder, exigido } = rotuloDoSegredo(destino);
      entrada.placeholder = placeholder;
      entrada.required = exigido;
    } else {
      entrada.type = 'text';
      if (campo.public && destino.publicValue) entrada.value = destino.publicValue;
      if (campo.teste && destino.testCode) entrada.value = destino.testCode;
    }
    rotulo.append(entrada);
    form.append(rotulo, el(doc, 'p', 'help', campo.help));
  }

  const acoes = el(doc, 'div', 'provider-actions');
  const botaoSalvar = el(doc, 'button', 'button primary', destino.configured ? 'Salvar' : destino.semCredencial ? 'Ativar' : 'Configurar');
  acoes.append(botaoSalvar);
  if (destino.configured) {
    const botaoRemover = el(doc, 'button', 'button ghost', 'Remover');
    botaoRemover.type = 'button';
    botaoRemover.onclick = () => remover?.(destino.provider);
    acoes.append(botaoRemover);
  }
  const erro = el(doc, 'p', 'form-error');
  erro.setAttribute('role', 'alert');
  form.append(acoes, erro);
  form.onsubmit = async (evento) => {
    evento.preventDefault();
    erro.textContent = '';
    try {
      await salvar?.(destino, new doc.defaultView.FormData(form));
    } catch (falha) {
      // O erro fica ao lado do formulário que o causou: a mensagem do servidor costuma dizer
      // qual campo está fora de formato, e ela precisa continuar à vista enquanto a pessoa corrige.
      erro.textContent = falha?.message || 'Não foi possível salvar.';
    }
  };
  return form;
}
