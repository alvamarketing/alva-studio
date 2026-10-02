import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { cartaoDaContaMeta, criarConexaoMetaUI, textoDoVencimento } from '../public/conexao-meta-ui.js';
import { destinosDeConversaoModel, rotuloDoSegredo } from '../public/studio-dashboard.js';

// F2 na tela: perfil e Páginas, seletores conta → pixel, escolha automática quando só há
// uma opção, "configurado pela conexão", vencimento e termos.
const conectado = (extra = {}) => ({
  conectado: true, nome: 'Taian na Meta', status: 'connected', precisaReconectar: false,
  conectadoEm: '2026-10-02T15:00:00.000Z', conectadoPor: { id: 'u1', nome: 'Taian' }, vencimento: { dias: 40, venceEmBreve: false }, ...extra,
});
const projetoVazio = (extra = {}) => ({
  conectado: true, escolha: null, destino: { configurado: false, origem: null, pixelId: null }, publicos: null,
  perfil: { nome: 'Taian na Meta' }, paginas: [{ id: '77', nome: 'Página Alva' }], termos: null, precisaReconectar: false, ...extra,
});

function montar({ estado = conectado(), doProjeto = projetoVazio(), contas = [{ id: '111', nome: 'Conta Alva' }], pixels = { 111: [{ id: '555', nome: 'Pixel Alva' }] }, confirmar = true, falhaContas = null, segurarContas = null } = {}) {
  const janela = new JSDOM('<div id="alvo"></div>').window;
  const doc = janela.document;
  const chamadas = [];
  let atual = doProjeto;
  const cartao = cartaoDaContaMeta(doc, {
    carregar: async () => estado,
    iniciar: async () => { chamadas.push(['iniciar']); return { url: 'https://www.facebook.com/x' }; },
    desconectar: async () => ({ conectado: false }),
    navegar: (url) => chamadas.push(['navegar', url]),
    irParaManual: () => {},
    projeto: {
      carregar: async () => { chamadas.push(['estado']); return atual; },
      contas: async () => { chamadas.push(['contas']); if (segurarContas) await segurarContas; if (falhaContas) throw new Error(falhaContas); return { contas }; },
      pixels: async (conta) => { chamadas.push(['pixels', conta]); return { pixels: pixels[conta] ?? [] }; },
      escolher: async (dados) => {
        chamadas.push(['escolher', dados]);
        const pixel = (pixels[dados.adAccountId] ?? []).find((item) => item.id === dados.pixelId);
        atual = { ...atual, escolha: { adAccountId: dados.adAccountId, pixelId: dados.pixelId, pixelNome: pixel?.nome, automatica: dados.automatica === true }, destino: { configurado: true, origem: 'connection', pixelId: dados.pixelId }, publicos: { adAccountId: dados.adAccountId, origem: 'connection' } };
        return atual;
      },
      confirmarSubstituicao: async () => { chamadas.push(['confirmou']); return confirmar; },
      depoisDeEscolher: async () => { chamadas.push(['depois']); },
    },
  });
  doc.querySelector('#alvo').append(cartao);
  return { doc, cartao, chamadas, janela };
}
const botao = (cartao, texto) => [...cartao.querySelectorAll('button')].find((item) => item.textContent.trim() === texto);

test('uma conta e um pixel, nada escolhido: escolhe e grava sozinho, e avisa', async () => {
  const { cartao, chamadas } = montar();
  await cartao.recarregar();
  assert.deepEqual(chamadas.find(([nome]) => nome === 'escolher'), ['escolher', { adAccountId: '111', pixelId: '555', automatica: true }]);
  assert.ok(chamadas.some(([nome]) => nome === 'depois'), 'destinos e públicos se redesenham');
  assert.match(cartao.textContent, /Escolhido automaticamente: conta "Conta Alva" e pixel "Pixel Alva"/);
  assert.ok(chip(cartao, 'Pixel e Conversions API ativos'), 'o estado do pixel aparece uma vez, como chip');
  const pixel = cartao.querySelector('.escolha[data-nome="pixelId"] .escolha-texto');
  assert.equal(pixel.querySelector('.escolha-titulo').textContent, 'Pixel Alva');
  assert.equal(pixel.querySelector('.escolha-detalhe').textContent, '555');
});

test('o perfil aparece; a lista de Páginas não (ficava enorme e ninguém usa para escolher)', async () => {
  const { cartao } = montar();
  await cartao.recarregar();
  assert.match(cartao.textContent, /Taian na Meta/);
  assert.doesNotMatch(cartao.textContent, /Páginas que você administra/);
  assert.doesNotMatch(cartao.textContent, /Página Alva/);
  assert.match(cartao.querySelector('.plataforma-status').textContent, /acesso vence em 40 dias/);
});

test('com manual existente não escolhe sozinho; escolher pede confirmação e manda substituirManual', async () => {
  const doProjeto = projetoVazio({ destino: { configurado: true, origem: 'manual', pixelId: '1' } });
  const { cartao, chamadas } = montar({ doProjeto });
  await cartao.recarregar();
  assert.equal(chamadas.some(([nome]) => nome === 'escolher'), false);
  assert.ok(chip(cartao, 'Pixel e Conversions API preenchidos à mão'));
  assert.match(cartao.textContent, /Hoje o pixel 1 deste projeto está preenchido à mão/);
  await cartao.aoEscolher();
  assert.deepEqual(chamadas.filter(([nome]) => ['confirmou', 'escolher'].includes(nome)), [['confirmou'], ['escolher', { adAccountId: '111', pixelId: '555', substituirManual: true }]]);
});

test('quem cancela a confirmação mantém o manual', async () => {
  const { cartao, chamadas } = montar({ doProjeto: projetoVazio({ publicos: { adAccountId: '1', origem: 'manual' } }), confirmar: false });
  await cartao.recarregar();
  await cartao.aoEscolher();
  assert.equal(chamadas.some(([nome]) => nome === 'escolher'), false);
});

test('várias contas: seletor de conta, depois de pixel; trocar de conta lê os pixels dela', async () => {
  const contas = [{ id: '111', nome: 'Conta Alva' }, { id: '222', nome: 'Conta 2' }];
  const pixels = { 111: [{ id: '555', nome: 'Pixel Alva' }], 222: [{ id: '666', nome: 'P1' }, { id: '777', nome: 'P2' }] };
  const { cartao, chamadas } = montar({ contas, pixels });
  await cartao.recarregar();
  assert.equal(chamadas.some(([nome]) => nome === 'escolher'), false);
  const conta = cartao.querySelector('.escolha[data-nome="adAccountId"]');
  assert.deepEqual([...conta.querySelectorAll('[role="option"]')].map((item) => item.dataset.valor), []);
  conta.querySelector('.escolha-botao').click();
  assert.deepEqual([...conta.querySelectorAll('[role="option"]')].map((item) => item.dataset.valor), ['111', '222']);
  assert.equal(cartao.querySelector('.escolha[data-nome="pixelId"]'), null);
  await cartao.aoTrocarConta('222');
  const pixel = cartao.querySelector('.escolha[data-nome="pixelId"]');
  pixel.querySelector('.escolha-botao').click();
  assert.deepEqual([...pixel.querySelectorAll('[role="option"]')].map((item) => item.dataset.valor), ['666', '777']);
  pixel.querySelector('.escolha-botao').click();
  assert.equal(botao(cartao, 'Usar esta conta e este pixel').disabled, true, 'sem pixel escolhido não grava');
  pixel.querySelector('.escolha-botao').click();
  pixel.querySelector('[data-valor="777"]').click();
  botao(cartao, 'Usar esta conta e este pixel').click();
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.deepEqual(chamadas.find(([nome]) => nome === 'escolher'), ['escolher', { adAccountId: '222', pixelId: '777' }]);
  assert.match(cartao.querySelector('[role="status"]').textContent, /usam a conexão/);
});

test('vazio: nenhuma conta, ou conta sem pixel, explicam onde resolver', async () => {
  const semContas = montar({ contas: [] });
  await semContas.cartao.recarregar();
  assert.match(semContas.cartao.textContent, /Nenhuma conta de anúncios encontrada — confira se a conta tem acesso no Gerenciador de Negócios/);
  const semPixels = montar({ pixels: {} });
  await semPixels.cartao.recarregar();
  assert.match(semPixels.cartao.textContent, /Nenhum pixel nesta conta de anúncios/);
});

test('erro ao ler as contas aparece, sem esconder a conexão', async () => {
  const { cartao } = montar({ falhaContas: 'A Meta recebeu muitas chamadas.' });
  await cartao.recarregar();
  assert.match(cartao.querySelector('.conta-meta-escolha .form-error').textContent, /muitas chamadas/);
  assert.match(cartao.querySelector('.plataforma-status').textContent, /Taian na Meta/);
});

test('vence em até 7 dias: aviso destacado com Reconectar', async () => {
  const { cartao, chamadas } = montar({ estado: conectado({ vencimento: { dias: 3, venceEmBreve: true } }) });
  await cartao.recarregar();
  const aviso = cartao.querySelector('.conta-meta-aviso');
  assert.equal(aviso.getAttribute('role'), 'alert');
  assert.match(aviso.textContent, /vence em 3 dias/);
  assert.doesNotMatch(cartao.querySelector('.plataforma-status').textContent, /vence/, 'o prazo curto vai no aviso, não repetido na linha de status');
  await cartao.aoConectar();
  assert.equal(chamadas.at(-1)[0], 'navegar');
  assert.equal(textoDoVencimento({ dias: 1 }), 'O acesso à Meta vence em 1 dia.');
  assert.equal(textoDoVencimento({ dias: null }), '');
});

test('termos não aceitos: link da conta para a pessoa aceitar, em outra aba', async () => {
  const doProjeto = projetoVazio({ escolha: { adAccountId: '111', pixelId: '555', pixelNome: 'Pixel Alva' }, destino: { configurado: true, origem: 'connection', pixelId: '555' }, termos: { aceitos: false, link: 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=111' } });
  const { cartao } = montar({ doProjeto });
  await cartao.recarregar();
  const link = cartao.querySelector('a.guia-link');
  assert.equal(link.href, 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=111');
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
  assert.match(cartao.querySelector('.conta-meta-termos').textContent, /Quem aceita é uma pessoa com acesso/);
  assert.equal(botao(cartao, 'Usar esta conta e este pixel').disabled, true, 'a escolha atual já está em uso');
});

test('o projeto diz que a conexão precisa reconectar: o cartão troca para Reconectar', async () => {
  const { cartao } = montar({ doProjeto: projetoVazio({ precisaReconectar: true }) });
  await cartao.recarregar();
  assert.ok(botao(cartao, 'Reconectar'));
  assert.ok(chip(cartao, 'Sem acesso').classList.contains('negativo'));
});

test('a UI fala com as rotas da F2 (estado, contas, pixels, escolha)', async () => {
  const janela = new JSDOM('<section id="project-settings-panel-rastreamento"></section>').window;
  const pedidos = [];
  const api = async (caminho, metodo = 'GET', dados) => {
    pedidos.push([caminho, metodo, dados]);
    if (caminho === '/companies/empresa-1/meta-connection') return conectado();
    if (caminho === '/projects/projeto-1/meta-connection') return projetoVazio();
    if (caminho.endsWith('/ad-accounts')) return { contas: [{ id: '111', nome: 'Conta' }] };
    if (caminho.includes('/pixels')) return { pixels: [{ id: '555', nome: 'Pixel' }] };
    return projetoVazio({ escolha: { adAccountId: '111', pixelId: '555' }, destino: { configurado: true, origem: 'connection', pixelId: '555' } });
  };
  const shell = { state: () => ({ currentCompany: { id: 'empresa-1' }, currentProject: { id: 'projeto-1' } }), can: () => true };
  const ui = criarConexaoMetaUI({ api, getShell: () => shell, ligado: () => true, doc: janela.document, navegar: () => {} });
  await ui.abrir();
  assert.deepEqual(pedidos.map(([caminho, metodo]) => `${metodo} ${caminho}`), [
    'GET /companies/empresa-1/meta-connection',
    'GET /projects/projeto-1/meta-connection',
    'GET /companies/empresa-1/meta-connection/ad-accounts',
    'GET /projects/projeto-1/meta-connection/pixels?adAccountId=111',
    'PUT /projects/projeto-1/meta-connection/selection',
  ]);
  assert.deepEqual(pedidos.at(-1)[2], { adAccountId: '111', pixelId: '555', automatica: true });
});

test('Destinos → Meta pela conexão: "Configurado pela conexão", sem campos de token e pixel', () => {
  const destinos = [{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' }, conexao: { precisaReconectar: false } }];
  const meta = destinosDeConversaoModel(destinos, [], true).find((item) => item.provider === 'meta');
  assert.equal(meta.stateLabel, 'Configurado pela conexão');
  assert.equal(meta.pelaConexao, true);
  assert.deepEqual(meta.fields.map((campo) => campo.name), ['test_event_code']);
  assert.deepEqual(meta.camposManuais.map((campo) => campo.name), ['pixel_id', 'access_token', 'test_event_code']);
  const reconectar = destinosDeConversaoModel([{ ...destinos[0], conexao: { precisaReconectar: true } }], [], true).find((item) => item.provider === 'meta');
  assert.equal(reconectar.stateLabel, 'Precisa reconectar');
  assert.equal(reconectar.state, 'teste');
  const manual = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '1' } }], [], true).find((item) => item.provider === 'meta');
  assert.equal(manual.pelaConexao, false);
  assert.deepEqual(manual.fields.map((campo) => campo.name), ['pixel_id', 'access_token', 'test_event_code']);
});

test('fidelidade: o módulo e o CSS novo só usam tokens, sem style em linha', async () => {
  const fonte = await readFile(new URL('../public/conexao-meta-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /#[0-9a-f]{3,8}\b|rgba?\(|\.style\.|font-weight|style=/i);
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const bloco = css.slice(css.indexOf('/* "Conta da Meta", F2'));
  assert.ok(bloco.length > 100);
  assert.doesNotMatch(bloco, /#[0-9a-f]{3,8}\b|rgba?\(|font-weight|font-family/i);
  // Sombra só pelos tokens que já existem (--ring-halo, --shadow-*): nenhuma sombra nova.
  for (const sombra of bloco.match(/box-shadow:[^;]+/g) ?? []) assert.match(sombra, /var\(--(?:ring|shadow)-/);
  for (const raio of bloco.match(/border-radius:[^;]+/g) ?? []) assert.match(raio, /var\(--radius-/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /confirmarSubstituicao: \(\) => confirmarAcao\(/);
  const plataformas = await readFile(new URL('../public/plataformas-ui.js', import.meta.url), 'utf8');
  assert.match(plataformas, /Prefiro preencher manualmente/);
});

test('modo manual vindo da conexão: o token não diz "Guardado" e é exigido', () => {
  const pelaConexao = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' } }], [], true).find((item) => item.provider === 'meta');
  const manual = { ...pelaConexao, pelaConexao: false, semTokenGuardado: true, fields: pelaConexao.camposManuais };
  assert.deepEqual(rotuloDoSegredo(manual), { placeholder: 'Configurado pela conexão — informe o token para preencher à mão', exigido: true });
  const colado = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '1' } }], [], true).find((item) => item.provider === 'meta');
  assert.deepEqual(rotuloDoSegredo(colado), { placeholder: 'Guardado — deixe em branco para manter', exigido: false });
  const novo = destinosDeConversaoModel([], [], true).find((item) => item.provider === 'meta');
  assert.deepEqual(rotuloDoSegredo(novo), { placeholder: '', exigido: false });
});

test('o formulário manual (plataformas-ui.js) usa o rótulo do segredo do modelo e abre o manual sem token guardado', async () => {
  const fonte = await readFile(new URL('../public/plataformas-ui.js', import.meta.url), 'utf8');
  assert.match(fonte, /rotuloDoSegredo\(destino\)/);
  assert.match(fonte, /semTokenGuardado: true/);
  for (const arquivo of ['app.js', 'plataformas-ui.js']) {
    const codigo = await readFile(new URL(`../public/${arquivo}`, import.meta.url), 'utf8');
    assert.doesNotMatch(codigo, /entrada\.placeholder = destino\.configured \? 'Guardado/, arquivo);
  }
});

// Conferência F2: os chips de alerta tinham o mesmo azul de "Conectado"; faltava a linha
// entre a conexão e as Páginas; o cartão ficava vazio enquanto carregava.
const chip = (cartao, texto) => [...cartao.querySelectorAll('.role-chip')].find((item) => item.textContent === texto);

test('chips: termos pendentes em alerta, Sem acesso em negativo, ativos/aceitos em positivo, Conectado no padrão', async () => {
  const doProjeto = projetoVazio({ escolha: { adAccountId: '111', pixelId: '555' }, destino: { configurado: true, origem: 'connection', pixelId: '555' }, termos: { aceitos: false, link: 'https://business.facebook.com/x' } });
  const { cartao } = montar({ doProjeto });
  await cartao.recarregar();
  assert.ok(chip(cartao, 'Termos pendentes').classList.contains('alerta'));
  assert.ok(chip(cartao, 'Pixel e Conversions API ativos').classList.contains('positivo'));
  const aceitos = montar({ doProjeto: { ...doProjeto, termos: { aceitos: true } } });
  await aceitos.cartao.recarregar();
  assert.ok(chip(aceitos.cartao, 'Termos aceitos').classList.contains('positivo'));
  assert.deepEqual([...chip(cartao, 'Conectado').classList], ['role-chip']);
  const semAcesso = montar({ estado: conectado({ status: 'needs_reconnect', precisaReconectar: true }) });
  await semAcesso.cartao.recarregar();
  assert.ok(chip(semAcesso.cartao, 'Sem acesso').classList.contains('negativo'));
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  assert.match(css, /\.conta-meta \.role-chip\.alerta \{[^}]*var\(--alva-warning-bg\)[^}]*var\(--alva-warning\)/);
  assert.match(css, /\.conta-meta \.role-chip\.negativo \{[^}]*var\(--alva-negative-bg\)[^}]*var\(--alva-negative\)/);
  assert.match(css, /\.conta-meta \.role-chip\.positivo \{[^}]*var\(--alva-positive-bg\)[^}]*var\(--alva-positive\)/);
});

test('linha divisória entre a conexão (cabeçalho do bloco) e o que é do projeto, como na "Equipe"', async () => {
  const { cartao } = montar();
  await cartao.recarregar();
  assert.ok(cartao.querySelector(':scope > .plataforma-cabeca + .plataforma-corpo .conta-meta-projeto'));
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  assert.match(css, /\.conta-meta > \.plataforma-corpo \{[^}]*border-top: 1px solid var\(--alva-line\)/);
});

test('"Neste projeto": as duas caixas lado a lado (grade de campos), o botão de usar e Desconectar pequeno no rodapé', async () => {
  const contas = [{ id: '111', nome: 'Conta Alva' }, { id: '222', nome: 'Conta 2' }];
  const doProjeto = projetoVazio({ escolha: { adAccountId: '111', pixelId: '555' }, destino: { configurado: true, origem: 'connection', pixelId: '555' } });
  const { cartao } = montar({ contas, doProjeto });
  await cartao.recarregar();
  const campos = cartao.querySelector('.conta-meta-campos');
  assert.deepEqual([...campos.querySelectorAll(':scope > .conta-meta-campo .escolha')].map((item) => item.dataset.nome), ['adAccountId', 'pixelId']);
  assert.ok(botao(cartao, 'Usar esta conta e este pixel'));
  const sair = botao(cartao, 'Desconectar');
  assert.ok(sair.closest('.plataforma-rodape'), 'Desconectar é secundário, no rodapé');
  assert.ok(sair.classList.contains('ghost'));
  assert.equal(botao(cartao, 'Código de teste e preenchimento manual'), undefined, 'sem o destino lido, o rótulo é o padrão');
  cartao.definirDestino({ provider: 'meta', configured: true, pelaConexao: true, stateLabel: 'Configurado pela conexão', state: 'idle' });
  assert.ok(botao(cartao, 'Código de teste e preenchimento manual'));
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 900px\) \{[^@]*\.conta-meta-campos \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('enquanto o estado da empresa carrega, o cartão diz "Carregando…"', async () => {
  let liberar;
  const janela = new JSDOM('<div id="alvo"></div>').window;
  const cartao = cartaoDaContaMeta(janela.document, {
    carregar: () => new Promise((resolver) => { liberar = () => resolver({ conectado: false }); }),
    iniciar: async () => ({}), desconectar: async () => ({}), navegar: () => {}, irParaManual: () => {},
  });
  const andamento = cartao.recarregar();
  assert.match(cartao.querySelector('.conta-meta-corpo').textContent, /Carregando…/);
  liberar();
  await andamento;
  assert.doesNotMatch(cartao.textContent, /Carregando…/);
});

// Achado no uso real (02/10/2026): a lista de contas leva segundos com dezenas de portfólios, e o
// cartão ficava em "Carregando a conta de anúncios deste projeto…" até ela chegar, escondendo
// o que já estava salvo.
test('a escolha salva aparece assim que chega; a lista de contas carrega depois', async () => {
  let soltar;
  const segurarContas = new Promise((resolver) => { soltar = resolver; });
  const doProjeto = projetoVazio({
    escolha: { adAccountId: '111', adAccountNome: 'Conta Alva', pixelId: '555', pixelNome: 'Pixel Alva' },
    destino: { configurado: true, origem: 'connection', pixelId: '555' },
    termos: { aceitos: true },
  });
  const { cartao } = montar({ doProjeto, segurarContas });
  const andamento = cartao.recarregar();
  await new Promise((resolver) => setTimeout(resolver, 0));
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.doesNotMatch(cartao.textContent, /Carregando a conta de anúncios deste projeto/);
  assert.match(cartao.textContent, /Pixel Alva \(555\)/);
  assert.match(cartao.textContent, /Conta atual: Conta Alva/);
  assert.match(cartao.textContent, /Carregando as outras contas/);
  assert.equal(cartao.querySelector('.escolha[data-nome="adAccountId"]'), null);
  soltar();
  await andamento;
  assert.ok(cartao.querySelector('.escolha[data-nome="adAccountId"]'), 'com a lista pronta, a caixa de escolha aparece');
  assert.doesNotMatch(cartao.textContent, /Carregando as outras contas/);
});
