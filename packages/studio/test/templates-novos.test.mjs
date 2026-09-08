import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templates, getTemplate } from '../public/templates.js';

// Dois padrões que as landing pages de referência usam e o catálogo não tinha:
// prova social com logos e objeções tratadas antes do fechamento (captação B2B), e
// planos lado a lado com contagem regressiva (lançamento com data marcada).

test('o catálogo cobre captação B2B e lançamento com planos', () => {
  const ids = templates.map((t) => t.id);
  assert.ok(ids.includes('b2b'), 'falta uma estrutura de captação B2B');
  assert.ok(ids.includes('launch'), 'falta uma estrutura de lançamento com planos');
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(templates.map((t) => t.html)).size, templates.length, 'modelo repetido não é modelo');
});

test('todo modelo novo cumpre o mesmo contrato dos antigos', () => {
  for (const id of ['b2b', 'launch']) {
    const modelo = getTemplate(id);
    for (const chave of ['id', 'name', 'description', 'category', 'html', 'css'])
      assert.equal(typeof modelo[chave], 'string', `${id} sem ${chave}`);
    assert.match(modelo.css, /--alva-form-base:1/, `${id} precisa do CSS de formulário`);
    // nada de buscar imagem ou fonte de fora: a página publicada não pode depender disso
    assert.doesNotMatch(modelo.html + modelo.css, /(?:src=|url\()['"]?https?:/, `${id} carrega recurso externo`);
  }
});

test('captação B2B abre com formulário, prova social e trata objeções antes do fim', () => {
  const html = getTemplate('b2b').html;
  assert.ok(html.indexOf('<form') < html.indexOf('logos'), 'o formulário fica na abertura, onde a visita chega');
  assert.match(html, /class="logos"/, 'faixa de logos é a prova social que abre confiança');
  assert.match(html, /class="objections"/, 'as dúvidas que travam a decisão vêm antes do fechamento');
  assert.ok(html.indexOf('objections') < html.indexOf('closing'), 'objeção antes do fechamento, não depois');
  assert.match(html, /class="closing"/);
});

test('lançamento traz contagem, planos lado a lado e um plano em destaque', () => {
  const html = getTemplate('launch').html;
  assert.match(html, /data-countdown/, 'data marcada pede contagem regressiva');
  assert.match(html, /class="plans"/);
  const planos = html.match(/class="plan[ "]/g) || [];
  assert.ok(planos.length >= 3, `três planos dão a comparação; achei ${planos.length}`);
  assert.match(html, /plan featured|class="plan featured"/, 'sem destaque a pessoa não sabe qual escolher');
  assert.match(html, /\[De R\$|\[R\$/, 'o preço é um campo para preencher, não um valor inventado');
});

test('os modelos falam em marcadores para preencher, não em texto pronto de outra empresa', () => {
  for (const id of ['b2b', 'launch']) {
    const html = getTemplate(id).html;
    const marcadores = html.match(/\[[^\]]+\]/g) || [];
    assert.ok(marcadores.length >= 8, `${id} tem só ${marcadores.length} marcadores para preencher`);
  }
});
