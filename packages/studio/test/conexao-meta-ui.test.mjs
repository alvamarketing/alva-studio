import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { cartaoDaContaMeta, criarConexaoMetaUI } from '../public/conexao-meta-ui.js';
import { pintarPlataformas } from '../public/plataformas-ui.js';
import { destinosDeConversaoModel } from '../public/studio-dashboard.js';

const conectado = (extra = {}) => ({
  conectado: true, nome: 'Pessoa na Meta', status: 'connected', precisaReconectar: false,
  conectadoEm: '2026-10-02T15:00:00.000Z', conectadoPor: { id: 'u1', nome: 'Taian' }, ...extra,
});

function montar(estado, acoes = {}) {
  const janela = new JSDOM('<div id="alvo"></div>').window;
  const doc = janela.document;
  const chamadas = [];
  const cartao = cartaoDaContaMeta(doc, {
    carregar: async () => (typeof estado === 'function' ? estado() : estado),
    iniciar: async () => { chamadas.push(['iniciar']); return { url: 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1' }; },
    desconectar: async () => { chamadas.push(['desconectar']); return { conectado: false }; },
    navegar: (url) => chamadas.push(['navegar', url]),
    irParaManual: () => chamadas.push(['manual']),
    ...acoes,
  });
  doc.querySelector('#alvo').append(cartao);
  return { doc, cartao, chamadas };
}

const botao = (cartao, texto) => [...cartao.querySelectorAll('button')].find((item) => item.textContent.trim() === texto);

test('o bloco da Meta é o bloco largo da grade "Plataformas": logo, nome e uma linha de status', async () => {
  const { cartao } = montar({ conectado: false });
  await cartao.recarregar();
  assert.ok(cartao.classList.contains('plataforma'));
  assert.ok(cartao.classList.contains('plataforma-larga'));
  assert.equal(cartao.dataset.provider, 'meta');
  assert.equal(cartao.querySelector('.plataforma-cabeca .plataforma-nome').textContent, 'Meta');
  assert.ok(cartao.querySelector('.plataforma-cabeca > .plataforma-logo svg path'), 'logo da Meta do simple-icons');
  assert.equal(cartao.querySelectorAll('.plataforma-status').length, 1);
});

test('não conectado: o botão oficial "Continuar com o Facebook" e o caminho manual', async () => {
  const { cartao, chamadas } = montar({ conectado: false });
  await cartao.recarregar();
  const conectar = botao(cartao, 'Continuar com o Facebook');
  assert.ok(conectar);
  assert.ok(conectar.classList.contains('botao-facebook'), 'o botão da marca, não o azul do Studio');
  assert.equal(conectar.classList.contains('primary'), false);
  const logo = conectar.querySelector('.botao-facebook-logo');
  assert.equal(logo.getAttribute('aria-hidden'), 'true');
  assert.ok(logo.querySelector('svg path'), 'o logo f do simple-icons');
  assert.match(cartao.querySelector('.plataforma-status').textContent, /Conecte a conta do Facebook/);
  botao(cartao, 'Preencher manualmente').click();
  assert.deepEqual(chamadas, [['manual']]);
});

test('não conectado, com a Meta preenchida à mão: a linha de status diz isso e o manual vira "Editar"', async () => {
  const { cartao } = montar({ conectado: false });
  await cartao.recarregar();
  cartao.definirDestino({ provider: 'meta', configured: true, description: 'Pixel e Conversions API', publicValue: '99887766', stateLabel: 'Configurado', state: 'idle', pelaConexao: false });
  assert.equal(cartao.querySelector('.plataforma-status').textContent, 'Pixel e Conversions API · 99887766 · preenchido à mão');
  assert.ok(botao(cartao, 'Editar preenchimento manual'));
  assert.ok(botao(cartao, 'Continuar com o Facebook'), 'conectar continua possível');
});

test('Conectar mostra "Abrindo o Facebook…" e navega na mesma aba para a URL devolvida', async () => {
  let liberar;
  const espera = new Promise((resolve) => { liberar = resolve; });
  const { cartao, chamadas } = montar({ conectado: false }, {
    iniciar: async () => { chamadas.push(['iniciar']); await espera; return { url: 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1' }; },
  });
  await cartao.recarregar();
  const andamento = cartao.aoConectar();
  const abrindo = botao(cartao, 'Abrindo o Facebook…');
  assert.ok(abrindo);
  assert.equal(abrindo.disabled, true);
  liberar();
  await andamento;
  assert.deepEqual(chamadas, [['iniciar'], ['navegar', 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1']]);
});

test('falha ao iniciar volta ao estado anterior com a mensagem', async () => {
  const { cartao } = montar({ conectado: false }, { iniciar: async () => { throw new Error('A conexão com o Facebook não está configurada neste ambiente.'); } });
  await cartao.recarregar();
  await cartao.aoConectar();
  assert.ok(botao(cartao, 'Continuar com o Facebook'));
  assert.match(cartao.querySelector('.form-error').textContent, /não está configurada/);
});

test('conectado: nome, quem conectou e quando, e Desconectar', async () => {
  let estado = conectado();
  const { cartao, chamadas } = montar(() => estado);
  await cartao.recarregar();
  assert.equal(cartao.querySelector('.plataforma-status').textContent, 'Pessoa na Meta · conectado por Taian em 02/10');
  assert.equal(botao(cartao, 'Continuar com o Facebook'), undefined);
  estado = { conectado: false };
  await cartao.aoDesconectar();
  assert.deepEqual(chamadas, [['desconectar']]);
  assert.ok(botao(cartao, 'Continuar com o Facebook'));
  assert.match(cartao.querySelector('[role="status"]').textContent, /públicos já criados continuam/);
});

test('precisa reconectar: Reconectar navega de novo', async () => {
  const { cartao, chamadas } = montar(conectado({ status: 'needs_reconnect', precisaReconectar: true }));
  await cartao.recarregar();
  assert.match(cartao.querySelector('.plataforma-status').textContent, /Conecte de novo/);
  assert.ok(botao(cartao, 'Desconectar'), 'quem não quer reconectar pode desconectar');
  const reconectar = botao(cartao, 'Reconectar');
  assert.ok(reconectar.classList.contains('primary'));
  await cartao.aoConectar();
  assert.equal(chamadas.at(-1)[0], 'navegar');
});

test('o módulo nunca abre pop-up: navega por location.assign', async () => {
  const fonte = await readFile(new URL('../public/conexao-meta-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /window\.open\(|\.open\(/);
  assert.match(fonte, /location\.assign\(/);
});

test('o cartão só usa tokens: nenhuma cor, raio ou sombra literal, nem style em linha', async () => {
  const fonte = await readFile(new URL('../public/conexao-meta-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /#[0-9a-f]{3,8}\b|rgba?\(|\.style\.|font-weight/i);
});

function painelDoProjeto({ ligado = true, pode = true } = {}) {
  const janela = new JSDOM(`<section id="project-settings-panel-rastreamento"><section class="surface" id="destinos">
    <div id="tracking-destinations"></div></section></section>`).window;
  const doc = janela.document;
  // A grade já pintada pelo app, como na tela de verdade.
  pintarPlataformas(doc.querySelector('#tracking-destinations'), destinosDeConversaoModel([], [], true), { salvar: async () => {}, remover: async () => {} });
  const pedidos = [];
  const destinos = [];
  const api = async (caminho, metodo = 'GET', dados) => {
    pedidos.push([caminho, metodo, dados]);
    if (caminho.endsWith('/start')) return { url: 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1' };
    return { conectado: false };
  };
  const shell = { state: () => ({ currentCompany: { id: 'empresa-1' }, currentProject: { id: 'projeto-1' } }), can: () => pode };
  const ui = criarConexaoMetaUI({ api, getShell: () => shell, ligado: () => ligado, doc, navegar: (url) => destinos.push(url) });
  return { doc, ui, pedidos, destinos };
}

test('sem runtime.metaConexao o cartão não aparece e nada é pedido', async () => {
  const { doc, ui, pedidos } = painelDoProjeto({ ligado: false });
  await ui.abrir();
  assert.equal(doc.querySelector('#conta-meta'), null);
  assert.equal(pedidos.length, 0);
  // A Meta continua na grade, como bloco simples: o manual não depende do app da Meta.
  assert.ok(doc.querySelector('#tracking-destinations > [data-provider="meta"] .plataforma-manual-botao'));
});

test('quem não gerencia integrações não vê o cartão', async () => {
  const { doc, ui } = painelDoProjeto({ pode: false });
  await ui.abrir();
  assert.equal(doc.querySelector('#conta-meta'), null);
});

test('ligado: o bloco da conexão entra no lugar do bloco da Meta, primeiro da grade, e fala com as rotas da empresa', async () => {
  const { doc, ui, pedidos, destinos } = painelDoProjeto();
  await ui.abrir();
  await ui.abrir();
  const grade = doc.querySelector('#tracking-destinations');
  assert.equal(grade.querySelector(':scope > .plataforma').id, 'conta-meta');
  assert.equal(doc.querySelectorAll('#conta-meta').length, 1);
  assert.equal(grade.querySelectorAll(':scope > [data-provider="meta"]').length, 1, 'não sobra o bloco simples da Meta');
  assert.deepEqual(pedidos[0], ['/companies/empresa-1/meta-connection', 'GET', undefined]);
  await doc.querySelector('#conta-meta').aoConectar();
  assert.deepEqual(pedidos.at(-1), ['/companies/empresa-1/meta-connection/start', 'POST', { projectId: 'projeto-1' }]);
  assert.deepEqual(destinos, ['https://www.facebook.com/v26.0/dialog/oauth?client_id=1']);
});

test('"Preencher manualmente" abre o formulário manual da Meta que já existe, dentro do bloco', async () => {
  const { doc, ui } = painelDoProjeto();
  await ui.abrir();
  const formulario = doc.querySelector('#conta-meta > .plataforma-formulario');
  assert.equal(formulario.hidden, true);
  formulario.scrollIntoView = () => { formulario.dataset.rolou = 'sim'; };
  const abrir = [...doc.querySelectorAll('#conta-meta button')].find((item) => item.textContent.trim() === 'Preencher manualmente');
  assert.equal(abrir.getAttribute('aria-controls'), formulario.id);
  abrir.click();
  assert.equal(formulario.hidden, false);
  assert.equal(abrir.getAttribute('aria-expanded'), 'true');
  assert.equal(formulario.dataset.rolou, 'sim');
  assert.equal(doc.activeElement?.name, 'pixel_id');
});

test('quem perde a permissão ao trocar de projeto volta a ver a Meta como bloco simples', async () => {
  let pode = true;
  const janela = new JSDOM('<section id="project-settings-panel-rastreamento"><div id="tracking-destinations"></div></section>').window;
  const doc = janela.document;
  pintarPlataformas(doc.querySelector('#tracking-destinations'), destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '1' } }], [], true), { salvar: async () => {}, remover: async () => {} });
  const shell = { state: () => ({ currentCompany: { id: 'e' }, currentProject: { id: 'p' } }), can: () => pode };
  const ui = criarConexaoMetaUI({ api: async () => ({ conectado: false }), getShell: () => shell, ligado: () => true, doc, navegar: () => {} });
  await ui.abrir();
  assert.ok(doc.querySelector('#conta-meta'));
  pode = false;
  await ui.abrir();
  assert.equal(doc.querySelector('#conta-meta'), null);
  const meta = doc.querySelector('#tracking-destinations > [data-provider="meta"]');
  assert.equal(meta.querySelector('.plataforma-acoes .role-chip').textContent, 'Configurado');
});

// Conferência de 02/10/2026: Desconectar revoga o acesso na Meta, e não pedia confirmação.
test('Desconectar pergunta antes: quem cancela não perde a conexão', async () => {
  const perguntas = [];
  const { cartao, chamadas } = montar({ conectado: true, nome: 'Taian', status: 'active' }, {
    confirmar: async () => { perguntas.push('perguntou'); return false; },
  });
  await cartao.recarregar();
  botao(cartao, 'Desconectar').click();
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.deepEqual(perguntas, ['perguntou']);
  assert.equal(chamadas.some(([nome]) => nome === 'desconectar'), false, 'cancelou: nada foi desconectado');
});

test('Desconectar confirmado desconecta', async () => {
  const { cartao, chamadas } = montar({ conectado: true, nome: 'Taian', status: 'active' }, { confirmar: async () => true });
  await cartao.recarregar();
  botao(cartao, 'Desconectar').click();
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.equal(chamadas.some(([nome]) => nome === 'desconectar'), true);
});

test('o app liga a confirmação ao diálogo do Studio, com o aviso de que o acesso some na Meta', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const trecho = app.slice(app.indexOf('const conexaoMetaUI = criarConexaoMetaUI('), app.indexOf('const conexaoMetaUI = criarConexaoMetaUI(') + 900);
  assert.match(trecho, /confirmarAcao\(\{ titulo: 'Desconectar a conta da Meta\?'/);
  assert.match(trecho, /perigo: true/);
  assert.match(trecho, /continuam na sua conta de anúncios/);
});
