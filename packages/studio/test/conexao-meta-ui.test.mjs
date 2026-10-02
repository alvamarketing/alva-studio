import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { cartaoDaContaMeta, criarConexaoMetaUI } from '../public/conexao-meta-ui.js';

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

test('o cartão veste a moldura do contrato visual (.surface + .surface-head)', async () => {
  const { cartao } = montar({ conectado: false });
  await cartao.recarregar();
  assert.ok(cartao.classList.contains('surface'));
  assert.equal(cartao.querySelector(':scope > .surface-head h2').textContent, 'Conta da Meta');
});

test('não conectado: Conectar com o Facebook e o caminho manual', async () => {
  const { cartao, chamadas } = montar({ conectado: false });
  await cartao.recarregar();
  const conectar = botao(cartao, 'Conectar com o Facebook');
  assert.ok(conectar);
  assert.ok(conectar.classList.contains('primary'));
  botao(cartao, 'Prefiro preencher manualmente').click();
  assert.deepEqual(chamadas, [['manual']]);
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
  assert.ok(botao(cartao, 'Conectar com o Facebook'));
  assert.match(cartao.querySelector('.form-error').textContent, /não está configurada/);
});

test('conectado: nome, quem conectou e quando, e Desconectar', async () => {
  let estado = conectado();
  const { cartao, chamadas } = montar(() => estado);
  await cartao.recarregar();
  assert.match(cartao.textContent, /Pessoa na Meta/);
  assert.match(cartao.textContent, /Conectado por Taian em 02\/10/);
  assert.equal(botao(cartao, 'Conectar com o Facebook'), undefined);
  estado = { conectado: false };
  await cartao.aoDesconectar();
  assert.deepEqual(chamadas, [['desconectar']]);
  assert.ok(botao(cartao, 'Conectar com o Facebook'));
  assert.match(cartao.querySelector('[role="status"]').textContent, /públicos já criados continuam/);
});

test('precisa reconectar: Reconectar navega de novo', async () => {
  const { cartao, chamadas } = montar(conectado({ status: 'needs_reconnect', precisaReconectar: true }));
  await cartao.recarregar();
  assert.match(cartao.textContent, /Conecte de novo/);
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
  const janela = new JSDOM(`<section id="project-settings-panel-rastreamento"><section class="surface" id="destinos"></section>
    <div id="tracking-destinations"><details data-provider="meta"><summary>Meta</summary><form><input name="pixel_id"></form></details></div></section>`).window;
  const doc = janela.document;
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
});

test('quem não gerencia integrações não vê o cartão', async () => {
  const { doc, ui } = painelDoProjeto({ pode: false });
  await ui.abrir();
  assert.equal(doc.querySelector('#conta-meta'), null);
});

test('ligado: o cartão entra no topo da aba Rastreamento e fala com as rotas da empresa', async () => {
  const { doc, ui, pedidos, destinos } = painelDoProjeto();
  await ui.abrir();
  await ui.abrir();
  const painel = doc.querySelector('#project-settings-panel-rastreamento');
  assert.equal(painel.firstElementChild.id, 'conta-meta');
  assert.equal(doc.querySelectorAll('#conta-meta').length, 1);
  assert.deepEqual(pedidos[0], ['/companies/empresa-1/meta-connection', 'GET', undefined]);
  await doc.querySelector('#conta-meta').aoConectar();
  assert.deepEqual(pedidos.at(-1), ['/companies/empresa-1/meta-connection/start', 'POST', { projectId: 'projeto-1' }]);
  assert.deepEqual(destinos, ['https://www.facebook.com/v26.0/dialog/oauth?client_id=1']);
});

test('"Prefiro preencher manualmente" abre o destino da Meta que já existe', async () => {
  const { doc, ui } = painelDoProjeto();
  await ui.abrir();
  const meta = doc.querySelector('#tracking-destinations details[data-provider="meta"]');
  meta.scrollIntoView = () => { meta.dataset.rolou = 'sim'; };
  [...doc.querySelectorAll('#conta-meta button')].find((item) => item.textContent.trim() === 'Prefiro preencher manualmente').click();
  assert.equal(meta.open, true);
  assert.equal(meta.dataset.rolou, 'sim');
  assert.equal(doc.activeElement?.name, 'pixel_id');
});
