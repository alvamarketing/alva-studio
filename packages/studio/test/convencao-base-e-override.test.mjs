import { test } from 'node:test';
import assert from 'node:assert/strict';
import postcss, { list } from 'postcss';
import { elementosCss } from '../public/catalogo-elementos.js';
import { quizElementCss } from '../public/quiz-elements.js';
import { embedVideoCss, formCss, runtimeCss, templateCss } from '../public/templates.js';

// "Base e override do mesmo seletor moram no mesmo módulo."
//
// A convenção estava escrita em três comentários longos e em nenhum teste. Foi a
// violação dela que produziu o único Crítico desta branch: a base de .donut/.chart-donut
// foi para catalogo-elementos.js e o override dentro de @media(max-width:600px) ficou
// para trás em quiz-elements.js. Como as duas folhas são concatenadas nessa ordem
// (quizElementCss = chromeCss + elementosCss + vslCss), o texto final ficou com o
// override ANTES da base, mesma especificidade — e o donut do mobile perdeu o tamanho.
// Nenhuma prova acusava, porque cada módulo, lido sozinho, estava coerente.
//
// Os módulos aqui são arquivos-fonte, não folhas compostas: quizElementCss contém
// elementosCss inteiro, então ler a composição não distinguiria quem declarou o quê. As
// duas subtrações abaixo desfazem a composição e devolvem o que cada arquivo escreveu.
const modulos = {
  'catalogo-elementos.js': elementosCss,
  'quiz-elements.js': quizElementCss.split(elementosCss).join(''),
  'templates.js (templateCss)': templateCss.split(formCss).join('').split(embedVideoCss).join(''),
  'templates.js (formCss)': formCss,
  'templates.js (runtimeCss)': runtimeCss,
  'templates.js (embedVideoCss)': embedVideoCss,
};

const normalizar = (seletor) => seletor.replace(/\s+/g, ' ').trim();
const separar = (seletor) => list.comma(seletor).map(normalizar);

// Onde cada seletor abre regra BASE, isto é, fora de qualquer @media.
const basePorSeletor = new Map();
for (const [nome, folha] of Object.entries(modulos)) {
  postcss.parse(folha).walkRules((regra) => {
    if (regra.parent?.type === 'atrule') return;
    for (const seletor of separar(regra.selector)) {
      if (!basePorSeletor.has(seletor)) basePorSeletor.set(seletor, new Set());
      basePorSeletor.get(seletor).add(nome);
    }
  });
}

test('a subtração devolve mesmo o que cada arquivo escreveu', () => {
  // Se a composição mudar de forma, a subtração vira no-op e a prova abaixo passaria a
  // ler a folha inteira — verde por acidente. Esta é a âncora.
  assert.ok(modulos['quiz-elements.js'].includes('.funnel-header{'), 'o módulo do quiz precisa manter o que é dele');
  assert.ok(!modulos['quiz-elements.js'].includes('.choice{'), 'e perder o que veio de catalogo-elementos.js');
  assert.ok(modulos['templates.js (templateCss)'].includes('.hero-grid{'));
  assert.ok(!modulos['templates.js (templateCss)'].includes('.alva-form{'), 'formCss é módulo próprio');
});

test('todo override dentro de @media tem a base no mesmo módulo', () => {
  const violacoes = [];
  for (const [nome, folha] of Object.entries(modulos)) {
    postcss.parse(folha).walkAtRules('media', (media) => {
      media.walkRules((regra) => {
        for (const seletor of separar(regra.selector)) {
          const onde = basePorSeletor.get(seletor);
          // Sem base em lugar nenhum não há cascata para inverter: é um override de
          // reset (`*:before`, `.screen-element[data-motion]`), que só existe no @media.
          if (!onde || onde.has(nome)) continue;
          violacoes.push(`${nome}: @media ${media.params} altera ${seletor}, cuja base mora em ${[...onde].join(', ')}`);
        }
      });
    });
  }
  assert.deepEqual(violacoes, [], 'mova o override para junto da base: concatenadas, as folhas podem pôr o override antes da base e a mesma especificidade faz a base vencer');
});
