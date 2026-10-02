// Tudo que se configura num projeto, numa tela só, abaixo de Agentes. Estava espalhado: o
// projeto na Vercel e o domínio dentro de um "details" na tela de Publicação, os pixels no
// meio do Rastreamento, o nome do projeto num diálogo do cabeçalho da Visão geral. Quem
// precisava configurar tinha de adivinhar onde cada coisa morava.
//
// Os blocos não são recriados: são os mesmos nós, movidos para cá. Assim tudo que já
// funciona — formulários, botões, os handlers de app.js — continua valendo, e não existem
// duas telas com o mesmo formulário para divergir uma da outra.
import { criarCartaoDeLeads } from './projeto-leads.js';

export const ABAS_DO_PROJETO = [
  ['geral', 'Geral', 'tune'],
  ['publicacao', 'Publicação', 'cloud_upload'],
  ['rastreamento', 'Rastreamento', 'conversion_path'],
  ['leads', 'Leads', 'inbox'],
];

const ASSUNTOS = { dominio: 'publicacao', vercel: 'publicacao', publicacao: 'publicacao', pixel: 'rastreamento', rastreamento: 'rastreamento', leads: 'leads', webhook: 'leads' };
export const abaDoAssunto = (assunto) => ASSUNTOS[String(assunto ?? '')] ?? 'geral';

// A aba que vai no endereço (#/configuracoes-do-projeto/<aba>). A primeira aba é a padrão e não
// aparece: o roteador chama de 'account' a aba que não precisa de trecho no endereço.
export const abaParaOEndereco = (assunto) => {
  const aba = abaDoAssunto(assunto);
  return aba === 'geral' ? 'account' : aba;
};

// A explicação da aba só existe onde os cartões não a trazem: repetida, vira ruído.
const AJUDA = { geral: '', publicacao: '', rastreamento: '', leads: '' };

function painel(doc, chave) {
  const secao = doc.createElement('section');
  secao.id = `project-settings-panel-${chave}`;
  secao.className = 'project-settings-panel';
  secao.setAttribute('role', 'tabpanel');
  secao.setAttribute('aria-labelledby', `project-settings-tab-${chave}`);
  if (AJUDA[chave]) {
    const ajuda = doc.createElement('p');
    ajuda.className = 'helper';
    ajuda.textContent = AJUDA[chave];
    secao.append(ajuda);
  }
  return secao;
}

// O contrato visual (wireframe, "Empresa e equipe") monta configuração em cartões:
// `.surface` com `.surface-head`. Um bloco de relatório (`.page-block`, separado por
// hairline) é outra gramática — a das telas de Analytics e Rastreamento.
function cartao(doc, no) {
  no.classList.remove('page-block');
  no.classList.add('surface');
  const cabecalho = no.querySelector(':scope > .block-head');
  if (cabecalho) cabecalho.classList.add('surface-head');
  return no;
}

// Um "details" dentro das configurações não tem sentido: aqui já é o lugar de configurar.
function abrirDetails(doc, no) {
  if (!no || no.tagName !== 'DETAILS') return no;
  const secao = doc.createElement('section');
  secao.className = 'surface';
  const cabecalho = doc.createElement('div');
  cabecalho.className = 'surface-head';
  const titulo = doc.createElement('h2');
  titulo.textContent = no.querySelector('summary')?.textContent ?? '';
  cabecalho.append(titulo);
  secao.append(cabecalho);
  for (const filho of [...no.children]) if (filho.tagName !== 'SUMMARY') secao.append(filho);
  no.remove();
  return secao;
}

// `api` e `toast` são do app.js: o cartão de Leads fala com o servidor por eles.
export function montarConfiguracoesDoProjeto(doc = document, { api, toast } = {}) {
  const tela = doc.querySelector('#project-settings-view');
  if (!tela) return null;
  const antiga = tela.querySelector('.project-settings-tabs');
  const paineis = new Map(ABAS_DO_PROJETO.map(([chave]) => [chave, tela.querySelector(`#project-settings-panel-${chave}`) || painel(doc, chave)]));
  if (!antiga) {
    const abas = doc.createElement('div');
    abas.className = 'settings-tabs project-settings-tabs';
    abas.setAttribute('role', 'tablist');
    abas.setAttribute('aria-label', 'Configurações do projeto');
    for (const [chave, rotulo, icone] of ABAS_DO_PROJETO) {
      const botao = doc.createElement('button');
      botao.type = 'button';
      botao.className = 'settings-tab';
      botao.id = `project-settings-tab-${chave}`;
      botao.setAttribute('role', 'tab');
      botao.setAttribute('aria-controls', `project-settings-panel-${chave}`);
      botao.dataset.projectSettingsTab = chave;
      botao.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icone}</span><span>${rotulo}</span>`;
      botao.onclick = () => abrirAbaDoProjeto(chave, doc);
      abas.append(botao);
    }
    tela.append(abas, ...paineis.values());
  }
  // Geral: o nome e o identificador saem do diálogo do cabeçalho e ficam à vista.
  const formDoProjeto = doc.querySelector('#project-settings-form');
  if (formDoProjeto && !paineis.get('geral').contains(formDoProjeto)) {
    const bloco = doc.createElement('section');
    bloco.className = 'surface';
    const cabecalho = doc.createElement('div');
    cabecalho.className = 'surface-head';
    const titulo = doc.createElement('h2');
    titulo.textContent = 'Nome e endereço';
    cabecalho.append(titulo);
    // O título do cartão substitui o cabeçalho que o formulário trazia do diálogo.
    for (const velho of formDoProjeto.querySelectorAll(':scope > h2, :scope > .eyebrow')) velho.remove();
    bloco.append(cabecalho, formDoProjeto);
    paineis.get('geral').append(bloco);
    doc.querySelector('#project-settings-dialog')?.remove();
  }
  // Publicação: o projeto na Vercel e o domínio saem de dentro do "details".
  const publicacao = doc.querySelector('#publication-view .publication-details');
  if (publicacao) paineis.get('publicacao').append(abrirDetails(doc, publicacao));
  // Rastreamento: o cadastro dos destinos. Os relatórios ficam na tela de Rastreamento.
  const destinos = doc.querySelector('#tracking-view #tracking-destinations');
  const blocoDeDestinos = destinos?.closest('.page-block') ?? destinos;
  if (blocoDeDestinos) paineis.get('rastreamento').append(cartao(doc, blocoDeDestinos));
  // Leads: o destino padrão dos leads do projeto. Só o cartão é montado aqui; os dados
  // vêm quando a tela abre (carregarLeadsDoProjeto), porque dependem do projeto escolhido.
  if (api && !doc.querySelector('#project-leads-card')) paineis.get('leads').append(criarCartaoDeLeads(doc, { api, toast }));
  abrirAbaDoProjeto(tela.dataset.abaAtual || 'geral', doc);
  return tela;
}

export async function carregarLeadsDoProjeto(doc, projectId) {
  await doc.querySelector('#project-leads-card')?.carregar?.(projectId);
}

// O destino dos leads é uma integração: sem `integration.manage` a aba só levaria um erro ao
// salvar. Quem não pode não a vê (Publicação e Rastreamento já ficam fora do alcance dessa
// pessoa pelo menu).
export function ocultarAbaDeLeads(doc = document) {
  const botao = doc.querySelector('#project-settings-tab-leads');
  const painelDeLeads = doc.querySelector('#project-settings-panel-leads');
  if (botao) botao.hidden = true;
  if (painelDeLeads) painelDeLeads.hidden = true;
  const tela = doc.querySelector('#project-settings-view');
  if (tela?.dataset.abaAtual === 'leads') abrirAbaDoProjeto('geral', doc);
}

export function abrirAbaDoProjeto(aba, doc = document) {
  const tela = doc.querySelector('#project-settings-view');
  if (!tela) return 'geral';
  const escondida = doc.querySelector(`#project-settings-tab-${aba}`)?.hidden === true;
  const escolhida = ABAS_DO_PROJETO.some(([chave]) => chave === aba) && !escondida ? aba : 'geral';
  tela.dataset.abaAtual = escolhida;
  for (const [chave] of ABAS_DO_PROJETO) {
    const botao = doc.querySelector(`#project-settings-tab-${chave}`);
    const painelDaAba = doc.querySelector(`#project-settings-panel-${chave}`);
    if (botao) { botao.setAttribute('aria-selected', String(chave === escolhida)); botao.tabIndex = chave === escolhida ? 0 : -1; }
    if (painelDaAba) painelDaAba.hidden = chave !== escolhida;
  }
  return escolhida;
}
