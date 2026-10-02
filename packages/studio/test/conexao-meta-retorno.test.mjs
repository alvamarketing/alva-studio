import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { concluirRetornoDaMeta, DESTINO_DO_RETORNO } from '../public/conexao-meta-retorno.js';

const HTML = await readFile(new URL('../public/conexao-meta-retorno.html', import.meta.url), 'utf8');
const CODIGO = 'codigo-marcador-retorno';
const STATE = 'state.marcador-retorno';

function pagina(busca) {
  const janela = new JSDOM(HTML, { url: `https://studio.alva.test/conexoes/meta/retorno${busca}` }).window;
  const ordem = [];
  const historico = janela.history.replaceState.bind(janela.history);
  janela.history.replaceState = (...args) => { ordem.push('limpar-barra'); historico(...args); };
  const pedidos = [];
  const destinos = [];
  return { janela, ordem, pedidos, destinos };
}

function servidor(ambiente, respostas) {
  return async (url, opcoes = {}) => {
    ambiente.ordem.push(`pedir ${url}`);
    ambiente.pedidos.push({ url, metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined });
    const [status, corpo] = respostas[url] ?? [404, { error: 'Não encontrado.' }];
    return { ok: status < 400, status, json: async () => corpo };
  };
}

const SESSAO = ['/api/session', [200, { authenticated: true, currentCompanyId: 'empresa-1' }]];

test('a página não tem script em linha e só carrega o próprio módulo', () => {
  assert.doesNotMatch(HTML, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(HTML, /<script type="module" src="\/conexao-meta-retorno\.js"><\/script>/);
});

test('limpa a barra antes de tudo, conclui na mesma origem e volta à aba Rastreamento', async () => {
  const ambiente = pagina(`?code=${CODIGO}&state=${encodeURIComponent(STATE)}`);
  const pedir = servidor(ambiente, Object.fromEntries([SESSAO, ['/api/companies/empresa-1/meta-connection/finish', [200, { estado: 'conectado', projectId: 'p' }]]]));
  const resultado = await concluirRetornoDaMeta({ win: ambiente.janela, doc: ambiente.janela.document, request: pedir, navegar: (url) => ambiente.destinos.push(url) });
  assert.equal(resultado, 'conectado');
  assert.equal(ambiente.ordem[0], 'limpar-barra');
  assert.equal(ambiente.janela.location.search, '');
  assert.equal(ambiente.janela.location.pathname, '/conexoes/meta/retorno');
  const fim = ambiente.pedidos.find((pedido) => pedido.url.endsWith('/finish'));
  assert.equal(fim.metodo, 'POST');
  assert.deepEqual(fim.corpo, { code: CODIGO, state: STATE });
  assert.deepEqual(ambiente.destinos, [DESTINO_DO_RETORNO]);
  assert.equal(DESTINO_DO_RETORNO, '/#/configuracoes-do-projeto/rastreamento');
  // Nada do que veio na URL aparece na página.
  const texto = ambiente.janela.document.documentElement.outerHTML;
  assert.equal(texto.includes(CODIGO), false);
  assert.equal(texto.includes('marcador-retorno'), false);
});

test('cancelado no Facebook: manda o erro, mostra o aviso e oferece voltar', async () => {
  const ambiente = pagina(`?error=access_denied&error_reason=user_denied&error_description=Permissions+error&state=${encodeURIComponent(STATE)}`);
  const pedir = servidor(ambiente, Object.fromEntries([SESSAO, ['/api/companies/empresa-1/meta-connection/finish', [200, { estado: 'cancelado', aviso: 'Você cancelou no Facebook. Nada foi conectado.' }]]]));
  const resultado = await concluirRetornoDaMeta({ win: ambiente.janela, doc: ambiente.janela.document, request: pedir, navegar: (url) => ambiente.destinos.push(url) });
  assert.equal(resultado, 'cancelado');
  assert.deepEqual(ambiente.destinos, [], 'cancelado não volta sozinho: a pessoa lê o aviso');
  assert.deepEqual(ambiente.pedidos.at(-1).corpo, { error: 'access_denied', state: STATE });
  const doc = ambiente.janela.document;
  assert.match(doc.querySelector('#retorno-texto').textContent, /cancelou/);
  assert.equal(doc.querySelector('#retorno-voltar').hidden, false);
  doc.querySelector('#retorno-voltar').click();
  assert.deepEqual(ambiente.destinos, [DESTINO_DO_RETORNO]);
  assert.equal(doc.documentElement.outerHTML.includes('Permissions'), false, 'a descrição do Facebook não é ecoada');
});

test('sem state não chama o servidor', async () => {
  const ambiente = pagina(`?code=${CODIGO}`);
  const pedir = servidor(ambiente, {});
  const resultado = await concluirRetornoDaMeta({ win: ambiente.janela, doc: ambiente.janela.document, request: pedir, navegar: () => {} });
  assert.equal(resultado, 'invalido');
  assert.equal(ambiente.pedidos.length, 0);
  assert.equal(ambiente.janela.location.search, '');
});

test('recusa do servidor vira a mensagem dele, e sessão encerrada pede para entrar', async () => {
  const recusa = pagina(`?code=${CODIGO}&state=${encodeURIComponent(STATE)}`);
  await concluirRetornoDaMeta({
    win: recusa.janela, doc: recusa.janela.document, navegar: () => {},
    request: servidor(recusa, Object.fromEntries([SESSAO, ['/api/companies/empresa-1/meta-connection/finish', [400, { error: 'A volta do Facebook não confere com este acesso.' }]]])),
  });
  assert.match(recusa.janela.document.querySelector('#retorno-texto').textContent, /não confere/);
  const semSessao = pagina(`?code=${CODIGO}&state=${encodeURIComponent(STATE)}`);
  const resultado = await concluirRetornoDaMeta({
    win: semSessao.janela, doc: semSessao.janela.document, navegar: () => {},
    request: servidor(semSessao, { '/api/session': [200, { authenticated: false }] }),
  });
  assert.equal(resultado, 'sem-sessao');
  assert.equal(semSessao.pedidos.length, 1);
});
