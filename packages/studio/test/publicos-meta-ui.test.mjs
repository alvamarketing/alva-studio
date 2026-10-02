import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { cartaoDePublicosMeta } from '../public/publicos-meta-ui.js';

const publico = (extra = {}) => ({
  chave: 'vsl_50', nome: 'Assistiu 50% da VSL', descricao: 'Quem chegou à metade.', uso: 'remarketing', evento: 'vsl_progress', retencaoDias: 30,
  estado: 'nao_criado', metaId: null, erro: null, ...extra,
});
const estadoCompleto = (extra = {}) => ({
  credenciais: { configuradas: true, adAccountId: '555' }, pixelId: '123', faltando: [],
  publicos: [publico(), publico({ chave: 'lead', nome: 'Virou lead', uso: 'exclusao', descricao: 'Quem deixou contato.' })],
  ...extra,
});
const novoDoc = () => new JSDOM('<div id="alvo"></div>').window;

function montar(estado, acoes = {}) {
  const janela = novoDoc();
  const doc = janela.document;
  const chamadas = [];
  const cartao = cartaoDePublicosMeta(doc, {
    carregar: async () => (typeof estado === 'function' ? estado() : estado),
    salvarCredenciais: async (dados) => { chamadas.push(['credenciais', dados]); return {}; },
    removerCredenciais: async () => { chamadas.push(['remover']); return {}; },
    sincronizar: async (chaves) => { chamadas.push(['sincronizar', chaves]); return { resultados: [] }; },
    esquecer: async (chave) => { chamadas.push(['esquecer', chave]); return {}; },
    ...acoes,
  });
  doc.querySelector('#alvo').append(cartao);
  return { janela, doc, cartao, chamadas };
}

test('o cartão usa a moldura .surface/.surface-head do contrato visual e lista o catálogo', async () => {
  const { cartao, janela } = montar(estadoCompleto());
  await cartao.recarregar();
  assert.ok(cartao.classList.contains('surface'));
  assert.ok(cartao.querySelector(':scope > .surface-head h2'));
  assert.match(cartao.querySelector('.surface-head h2').textContent, /Públicos automáticos/);
  const linhas = [...cartao.querySelectorAll('.publico-meta')];
  assert.equal(linhas.length, 2);
  assert.match(linhas[0].textContent, /Assistiu 50% da VSL/);
  assert.match(linhas[1].textContent, /Excluir/, 'o público de exclusão diz para que serve');
  janela.close();
});

test('sem credencial, o cartão diz exatamente o que falta e onde obter, e não deixa ligar', async () => {
  const { cartao, janela } = montar(estadoCompleto({
    credenciais: { configuradas: false, adAccountId: null },
    faltando: [{ chave: 'credenciais', titulo: 'ID da conta de anúncios e token de acesso', onde: 'O token vem do Gerenciador de Negócios, com a permissão ads_management.' }],
  }));
  await cartao.recarregar();
  assert.match(cartao.textContent, /ID da conta de anúncios e token de acesso/);
  assert.match(cartao.textContent, /ads_management/);
  assert.equal(cartao.querySelectorAll('input[role="switch"]:not([disabled])').length, 0);
  assert.ok(cartao.querySelector('input[name="adAccountId"]'));
  assert.equal(cartao.querySelector('input[name="token"]').type, 'password');
  janela.close();
});

test('sem pixel, o aviso aponta para o bloco da Meta em Plataformas e nada pode ser ligado', async () => {
  const { cartao, janela } = montar(estadoCompleto({ pixelId: null, faltando: [{ chave: 'pixel', titulo: 'Pixel da Meta', onde: 'Configure o pixel da Meta no bloco "Meta", em "Plataformas", nesta aba.' }] }));
  await cartao.recarregar();
  assert.match(cartao.textContent, /Pixel da Meta/);
  assert.equal(cartao.querySelectorAll('input[role="switch"]:not([disabled])').length, 0);
  janela.close();
});

test('ligar um público chama a criação só dele; o estado e o erro aparecem na linha', async () => {
  const dados = estadoCompleto();
  const { cartao, chamadas, janela } = montar(() => dados);
  await cartao.recarregar();
  const interruptor = cartao.querySelector('.publico-meta[data-chave="vsl_50"] input[role="switch"]');
  assert.equal(interruptor.checked, false);
  dados.publicos[0] = publico({ estado: 'criado', metaId: '9001' });
  interruptor.checked = true;
  await cartao.aoAlternar('vsl_50', true);
  assert.deepEqual(chamadas, [['sincronizar', ['vsl_50']]]);
  assert.match(cartao.querySelector('.publico-meta[data-chave="vsl_50"]').textContent, /Criado na Meta/);
  assert.equal(cartao.querySelector('.publico-meta[data-chave="vsl_50"] input[role="switch"]').checked, true);

  dados.publicos[1] = publico({ chave: 'lead', nome: 'Virou lead', estado: 'erro', erro: 'A Meta recusou o token (inválido ou expirado).' });
  await cartao.recarregar();
  const linhaDoErro = cartao.querySelector('.publico-meta[data-chave="lead"]');
  assert.match(linhaDoErro.textContent, /Erro/);
  assert.match(linhaDoErro.textContent, /recusou o token/);
  assert.equal(linhaDoErro.querySelector('input[role="switch"]').checked, false, 'com erro, o público não conta como ligado');
  janela.close();
});

test('desligar esquece o público e avisa que ele continua na Meta', async () => {
  const dados = estadoCompleto({ publicos: [publico({ estado: 'criado', metaId: '9001' })] });
  const { cartao, chamadas, janela } = montar(() => dados);
  await cartao.recarregar();
  dados.publicos[0] = publico();
  await cartao.aoAlternar('vsl_50', false);
  assert.deepEqual(chamadas, [['esquecer', 'vsl_50']]);
  assert.match(cartao.textContent, /continua na conta de anúncios/i);
  janela.close();
});

test('erro ao ligar aparece no cartão, não só no console, e o interruptor volta', async () => {
  const dados = estadoCompleto();
  const { cartao, janela } = montar(() => dados, { sincronizar: async () => { throw new Error('Falta o token de acesso da Meta.'); } });
  await cartao.recarregar();
  await cartao.aoAlternar('vsl_50', true);
  assert.match(cartao.querySelector('.form-error').textContent, /Falta o token/);
  assert.equal(cartao.querySelector('.publico-meta[data-chave="vsl_50"] input[role="switch"]').checked, false);
  janela.close();
});

test('salvar credenciais manda conta e token; token em branco não é enviado', async () => {
  const { cartao, chamadas, janela } = montar(estadoCompleto({ credenciais: { configuradas: true, adAccountId: '555' } }));
  await cartao.recarregar();
  const form = cartao.querySelector('form.publicos-meta-credenciais');
  assert.equal(form.elements.adAccountId.value, '555', 'a conta é pública e vem preenchida');
  assert.equal(form.elements.token.value, '', 'o token nunca volta');
  assert.match(form.elements.token.placeholder, /deixe em branco/i);
  form.elements.adAccountId.value = 'act_777';
  await cartao.aoSalvarCredenciais(new janela.Event('submit'));
  assert.deepEqual(chamadas[0], ['credenciais', { adAccountId: 'act_777' }]);
  // Depois de salvar o cartão se redesenha: o formulário é outro nó.
  const novo = cartao.querySelector('form.publicos-meta-credenciais');
  novo.elements.adAccountId.value = 'act_777';
  novo.elements.token.value = 'EAAG-novo';
  await cartao.aoSalvarCredenciais(new janela.Event('submit'));
  assert.deepEqual(chamadas[1], ['credenciais', { adAccountId: 'act_777', token: 'EAAG-novo' }]);
  assert.equal(cartao.querySelector('form.publicos-meta-credenciais').elements.token.value, '', 'o campo do token é limpo depois de salvar');
  janela.close();
});

test('se ler o estado falha, o cartão diz que falhou — não finge que nada está configurado', async () => {
  const { cartao, janela } = montar(() => { throw new Error('Os públicos da Meta ainda não estão configurados neste ambiente.'); });
  await cartao.recarregar();
  assert.match(cartao.querySelector('.form-error, .help').textContent, /não foi possível ler/i);
  assert.match(cartao.textContent, /ainda não estão configurados/);
  assert.equal(cartao.querySelectorAll('.publico-meta').length, 0);
  janela.close();
});

test('nenhum token aparece no HTML do cartão', async () => {
  const { cartao, janela } = montar(estadoCompleto());
  await cartao.recarregar();
  assert.equal(/EAAG|access_token/.test(cartao.outerHTML), false);
  janela.close();
});

test('o servidor entrega o módulo do cartão (arquivo estático registrado)', async () => {
  const fonte = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /'\/publicos-meta-ui\.js': \['public\/publicos-meta-ui\.js', 'text\/javascript'\]/);
});
