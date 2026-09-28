// Tudo que se configura num projeto, numa tela só, abaixo de Agentes. Estava espalhado: o
// projeto na Vercel e o domínio dentro de um "details" na tela de Publicação, os pixels no
// meio do Rastreamento, o nome do projeto num diálogo do cabeçalho da Visão geral. Quem
// precisava configurar tinha de adivinhar onde cada coisa morava.
//
// Os blocos não são recriados: são os mesmos nós, movidos para cá. Assim tudo que já
// funciona — formulários, botões, os handlers de app.js — continua valendo, e não existem
// duas telas com o mesmo formulário para divergir uma da outra.
export const ABAS_DO_PROJETO = [
  ['geral', 'Geral', 'tune'],
  ['publicacao', 'Publicação', 'cloud_upload'],
  ['rastreamento', 'Rastreamento', 'conversion_path'],
];

const ASSUNTOS = { dominio: 'publicacao', vercel: 'publicacao', publicacao: 'publicacao', pixel: 'rastreamento', rastreamento: 'rastreamento' };
export const abaDoAssunto = (assunto) => ASSUNTOS[String(assunto ?? '')] ?? 'geral';

const AJUDA = {
  geral: 'Nome e endereço deste projeto.',
  publicacao: 'Onde este projeto é publicado: o projeto na Vercel e o domínio dele. O acesso à Vercel é da conta e fica em Configurações · Integrações.',
  rastreamento: 'Para onde as conversões deste projeto são entregues.',
};

function painel(doc, chave) {
  const secao = doc.createElement('section');
  secao.id = `project-settings-panel-${chave}`;
  secao.className = 'project-settings-panel';
  secao.setAttribute('role', 'tabpanel');
  secao.setAttribute('aria-labelledby', `project-settings-tab-${chave}`);
  const ajuda = doc.createElement('p');
  ajuda.className = 'helper';
  ajuda.textContent = AJUDA[chave] ?? '';
  secao.append(ajuda);
  return secao;
}

// Um "details" dentro das configurações não tem sentido: aqui já é o lugar de configurar.
function abrirDetails(doc, no) {
  if (!no || no.tagName !== 'DETAILS') return no;
  const secao = doc.createElement('section');
  secao.className = 'page-block';
  const titulo = doc.createElement('h2');
  titulo.textContent = no.querySelector('summary')?.textContent ?? '';
  secao.append(titulo);
  for (const filho of [...no.children]) if (filho.tagName !== 'SUMMARY') secao.append(filho);
  no.remove();
  return secao;
}

export function montarConfiguracoesDoProjeto(doc = document) {
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
    bloco.className = 'page-block';
    bloco.append(formDoProjeto);
    paineis.get('geral').append(bloco);
    doc.querySelector('#project-settings-dialog')?.remove();
  }
  // Publicação: o projeto na Vercel e o domínio saem de dentro do "details".
  const publicacao = doc.querySelector('#publication-view .publication-details');
  if (publicacao) paineis.get('publicacao').append(abrirDetails(doc, publicacao));
  // Rastreamento: o cadastro dos destinos. Os relatórios ficam na tela de Rastreamento.
  const destinos = doc.querySelector('#tracking-view #tracking-destinations');
  const blocoDeDestinos = destinos?.closest('.page-block') ?? destinos;
  if (blocoDeDestinos) paineis.get('rastreamento').append(blocoDeDestinos);
  abrirAbaDoProjeto(tela.dataset.abaAtual || 'geral', doc);
  return tela;
}

export function abrirAbaDoProjeto(aba, doc = document) {
  const tela = doc.querySelector('#project-settings-view');
  if (!tela) return 'geral';
  const escolhida = ABAS_DO_PROJETO.some(([chave]) => chave === aba) ? aba : 'geral';
  tela.dataset.abaAtual = escolhida;
  for (const [chave] of ABAS_DO_PROJETO) {
    const botao = doc.querySelector(`#project-settings-tab-${chave}`);
    const painelDaAba = doc.querySelector(`#project-settings-panel-${chave}`);
    if (botao) { botao.setAttribute('aria-selected', String(chave === escolhida)); botao.tabIndex = chave === escolhida ? 0 : -1; }
    if (painelDaAba) painelDaAba.hidden = chave !== escolhida;
  }
  return escolhida;
}
