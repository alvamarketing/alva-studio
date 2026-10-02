// O guia "Como criar os públicos da Meta" e os links que levam até ele.
//
// O guia é para quem nunca mexeu nisso: o que cada público faz, o que a Meta exige antes de o
// Studio poder criar, o passo a passo e o que fazer quando algo não funciona. O que ele diz
// tem de bater com o que o Studio realmente cria — por isso o teste lê o catálogo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLICOS } from '../server/meta-publicos.mjs';

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), 'utf8');
const TEXTO_DO_LINK = 'Saiba como configurar o público da Meta';
const ENDERECO = '/ajuda/publicos-meta';

test('o guia explica cada público que o Studio cria, com o mesmo nome que a pessoa vê no cartão', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  for (const publico of PUBLICOS) assert.ok(guia.includes(publico.nome), `o guia precisa falar de "${publico.nome}"`);
});

test('o guia diz o que a Meta exige antes: conta, chave com permissão, termos e pixel', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  assert.match(guia, /número da conta de anúncios/i);
  assert.match(guia, /ads_management/);
  assert.match(guia, /usuário do sistema/i);
  assert.match(guia, /Termos de Públicos Personalizados/);
  assert.match(guia, /business\.facebook\.com\/ads\/manage\/customaudiences\/tos\//, 'o endereço dos termos é o da documentação oficial');
  assert.match(guia, /pixel/i);
  // A chave que o Studio já guarda para as conversões não serve para criar público.
  assert.match(guia, /não serve|não é a mesma|outra chave/i);
});

test('o guia explica o uso nos anúncios, incluindo excluir quem já virou lead', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  assert.match(guia, /excluir/i);
  assert.match(guia, /Virou lead/);
  assert.match(guia, /remarketing|anunciar de novo|voltar a anunciar/i);
});

test('o guia diz o que fazer quando algo não funciona, e que desligar não apaga na Meta', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  assert.match(guia, /Se algo der errado/i);
  assert.match(guia, /só esquece|não apaga/i);
  assert.match(guia, /publicada|publicadas/i, 'os eventos só saem de página publicada');
  assert.match(guia, /medição|aceit/i, 'e só de quem aceitou a medição');
});

test('o guia aponta para os guias oficiais da Meta, em endereços que a documentação cita', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  assert.match(guia, /developers\.facebook\.com\/documentation\/ads-commerce\/marketing-api\/audiences\/guides\/website-custom-audiences/);
  assert.match(guia, /developers\.facebook\.com\/docs\/marketing-api\/system-users/);
  for (const [, endereco] of guia.matchAll(/href="(https?:[^"]+)"/g)) assert.match(endereco, /^https:\/\//, 'só links seguros');
});

test('o guia usa só os tokens do Studio, sem cor escrita à mão', async () => {
  const guia = await ler('../public/ajuda-publicos-meta.html');
  const estilo = guia.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(estilo.length > 0);
  assert.doesNotMatch(estilo, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(guia, /\/tokens\.css/);
});

test('o link "Saiba como configurar o público da Meta" aparece onde a pessoa vai procurar', async () => {
  const cartao = await ler('../public/publicos-meta-ui.js');
  assert.ok(cartao.includes(TEXTO_DO_LINK) && cartao.includes(ENDERECO), 'no cartão dos públicos');
  const leadsDoProjeto = await ler('../public/projeto-leads.js');
  assert.ok(leadsDoProjeto.includes(TEXTO_DO_LINK) && leadsDoProjeto.includes(ENDERECO), 'na aba Leads das configurações');
  const index = await ler('../public/index.html');
  const blocoDeLeads = index.slice(index.indexOf('id="project-leads-controls"') - 200, index.indexOf('id="project-leads-controls"') + 900);
  assert.ok(blocoDeLeads.includes(TEXTO_DO_LINK) && blocoDeLeads.includes(ENDERECO), 'na tela de Leads');
});

test('o link abre em outra aba, sem tirar a pessoa do que estava fazendo', async () => {
  for (const arquivo of ['../public/publicos-meta-ui.js', '../public/projeto-leads.js', '../public/index.html']) {
    const fonte = await ler(arquivo);
    const trecho = fonte.slice(fonte.indexOf(ENDERECO) - 80, fonte.indexOf(ENDERECO) + 200);
    assert.match(trecho, /_blank/, `${arquivo}: abre em outra aba`);
    assert.match(trecho, /noopener/, `${arquivo}: sem vazar a janela de origem`);
  }
});

test('o servidor entrega o guia sem exigir login', async () => {
  const index = await ler('../server/index.mjs');
  assert.match(index, /'\/ajuda\/publicos-meta': \['public\/ajuda-publicos-meta\.html', 'text\/html'\]/);
});

test('o link da tela de Leads só aparece junto com a lista de leads, não na Visão geral inteira', async () => {
  const index = await ler('../public/index.html');
  const controles = index.slice(index.indexOf('id="project-leads-controls"'));
  const bloco = controles.slice(0, controles.indexOf('</div>') + 6);
  assert.ok(bloco.includes('project-leads-ajuda'), 'o parágrafo mora dentro do bloco que a Visão geral esconde');
});
