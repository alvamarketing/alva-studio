// O destino dos leads deixou de ser configuração de cada página: o dono define uma vez por
// projeto, na aba Leads das configurações do projeto, e a página só sobrescreve se quiser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { ABAS_DO_PROJETO, abaDoAssunto, carregarLeadsDoProjeto, montarConfiguracoesDoProjeto } from '../public/projeto-configuracoes.js';

function tela(api = async () => ({ configured: false, url: '' })) {
  const { window } = new JSDOM('<body><section id="project-settings-view" hidden></section></body>');
  const doc = window.document;
  montarConfiguracoesDoProjeto(doc, { api, toast: () => {} });
  return { window, doc, painel: doc.querySelector('#project-settings-panel-leads') };
}

test('a aba Leads existe e o assunto leads leva até ela', () => {
  assert.deepEqual(ABAS_DO_PROJETO.find(([chave]) => chave === 'leads'), ['leads', 'Leads', 'inbox']);
  assert.equal(abaDoAssunto('leads'), 'leads');
  assert.equal(abaDoAssunto('webhook'), 'leads');
});

test('a aba é um cartão só do contrato visual: .surface com .surface-head, campo, ajuda e botões', () => {
  const { window, painel } = tela();
  const cartoes = [...painel.children].filter((no) => !no.classList.contains('helper'));
  assert.equal(cartoes.length, 1, 'um cartão só');
  assert.ok(cartoes[0].classList.contains('surface'));
  assert.ok(cartoes[0].querySelector(':scope > .surface-head h2'));
  const campo = cartoes[0].querySelector('input[name="url"]');
  assert.ok(campo, 'campo da URL do webhook');
  assert.equal(campo.type, 'url');
  const ajuda = cartoes[0].textContent;
  assert.match(ajuda, /cópia/);
  assert.match(ajuda, /JSON/);
  assert.match(ajuda, /CRM/);
  assert.match(ajuda, /sobrescrev/, 'diz que a página com destino próprio sobrescreve');
  const botoes = [...cartoes[0].querySelectorAll('button')].map((b) => b.textContent.trim());
  assert.deepEqual(botoes, ['Remover', 'Salvar']);
  window.close();
});

test('montar duas vezes não duplica o cartão', () => {
  const { window, doc } = tela();
  montarConfiguracoesDoProjeto(doc, { api: async () => ({}), toast: () => {} });
  assert.equal(doc.querySelectorAll('#project-leads-card').length, 1);
  window.close();
});

test('abrir a aba mostra o que está salvo no projeto', async () => {
  const chamadas = [];
  const { window, doc } = tela(async (...args) => { chamadas.push(args); return { configured: true, url: 'https://crm.example.test/hook' }; });
  await carregarLeadsDoProjeto(doc, 'p-1');
  assert.deepEqual(chamadas, [['/projects/p-1/lead-webhook']]);
  assert.equal(doc.querySelector('#project-leads-card input[name="url"]').value, 'https://crm.example.test/hook');
  assert.equal(doc.querySelector('#project-leads-remove').disabled, false);
  window.close();
});

test('sem destino salvo, o campo fica vazio e não há o que remover', async () => {
  const { window, doc } = tela();
  await carregarLeadsDoProjeto(doc, 'p-1');
  assert.equal(doc.querySelector('#project-leads-card input[name="url"]').value, '');
  assert.equal(doc.querySelector('#project-leads-remove').disabled, true);
  window.close();
});

test('Salvar manda a URL; Remover manda remove e limpa o campo', async () => {
  const chamadas = [];
  const toasts = [];
  const { window } = new JSDOM('<body><section id="project-settings-view" hidden></section></body>');
  const doc = window.document;
  let salvo = { configured: false, url: '' };
  const api = async (caminho, metodo = 'GET', corpo) => {
    chamadas.push([caminho, metodo, corpo]);
    if (metodo === 'PUT') salvo = corpo.remove ? { configured: false, url: '' } : { configured: true, url: corpo.url };
    return salvo;
  };
  montarConfiguracoesDoProjeto(doc, { api, toast: (m) => toasts.push(m) });
  await carregarLeadsDoProjeto(doc, 'p-1');
  const cartao = doc.querySelector('#project-leads-card');
  cartao.querySelector('input[name="url"]').value = '  https://crm.example.test/novo  ';
  await cartao.aoSalvar({ preventDefault() {} });
  assert.deepEqual(chamadas.at(-1), ['/projects/p-1/lead-webhook', 'PUT', { url: 'https://crm.example.test/novo' }]);
  assert.equal(doc.querySelector('#project-leads-remove').disabled, false);
  assert.equal(toasts.length, 1);
  await cartao.aoRemover();
  assert.deepEqual(chamadas.at(-1), ['/projects/p-1/lead-webhook', 'PUT', { remove: true }]);
  assert.equal(cartao.querySelector('input[name="url"]').value, '');
  assert.equal(doc.querySelector('#project-leads-remove').disabled, true);
  window.close();
});

test('o erro do servidor aparece no cartão e o que estava no campo continua lá', async () => {
  const { window, doc } = tela(async (caminho, metodo) => {
    if (metodo === 'PUT') throw new Error('Informe um webhook HTTPS válido.');
    return { configured: false, url: '' };
  });
  await carregarLeadsDoProjeto(doc, 'p-1');
  const cartao = doc.querySelector('#project-leads-card');
  cartao.querySelector('input[name="url"]').value = 'http://inseguro.test/x';
  await cartao.aoSalvar({ preventDefault() {} });
  assert.equal(cartao.querySelector('.form-error').textContent, 'Informe um webhook HTTPS válido.');
  assert.equal(cartao.querySelector('input[name="url"]').value, 'http://inseguro.test/x');
  window.close();
});

test('o módulo novo é servido pelo servidor e a tela o liga no app', async () => {
  const servidor = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(servidor, /'\/projeto-leads\.js': \['public\/projeto-leads\.js', 'text\/javascript'\]/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /carregarLeadsDoProjeto\(document/);
});

test('o popover Leads do editor avisa que a página usa o destino do projeto, só com o host', async () => {
  const fonte = await readFile(new URL('../editor/main.jsx', import.meta.url), 'utf8');
  const popover = fonte.slice(fonte.indexOf('function DestinoDosLeads'), fonte.indexOf('function Acoes'));
  assert.match(popover, /!valor\.trim\(\) && Boolean\(pagina\.projectWebhookHost\)/, 'só quando a página não tem destino próprio');
  assert.match(popover, /usa o destino do projeto \(\{pagina\.projectWebhookHost\}\)/);
  assert.doesNotMatch(popover, /projectWebhookUrl/, 'a URL inteira não chega ao editor');
  assert.match(popover, /<input type="url"/, 'o campo para sobrescrever continua');
});
