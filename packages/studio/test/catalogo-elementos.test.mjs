import { test } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { elementosCss } from '../public/catalogo-elementos.js';
import { formCss } from '../public/templates.js';

test('a folha dos elementos desenha peças, não a página', () => {
  assert.match(elementosCss, /\.choice\{/);
  assert.match(elementosCss, /\.scale\{/);
  assert.match(elementosCss, /\.upload\{/);
  assert.match(elementosCss, /\.answer\{/);
  assert.doesNotMatch(elementosCss, /(^|})body\{/);
  assert.doesNotMatch(elementosCss, /\.shell/);
  assert.doesNotMatch(elementosCss, /@keyframes ambient/);
});

test('a paleta da folha vem de variáveis próprias', () => {
  assert.match(elementosCss, /--alva-el-accent:/);
  assert.doesNotMatch(elementosCss, /var\(--accent\)/);
});

test('o campo aninhado dentro do formulário devolve o foco ao tratamento do formulário', () => {
  // .answer:focus (0,2,0) sozinho vazava para dentro de .alva-form: formCss só cobre
  // :focus-visible (outline), não :focus puro, então um clique deixava o campo aninhado
  // com borda e brilho diferentes dos irmãos do mesmo formulário. A correção precisa
  // vencer por especificidade — .alva-form .answer:focus é (0,3,0) — e reusar os mesmos
  // valores que .alva-form input já tem em repouso (formCss), não inventar cor nova.
  assert.match(formCss, /var\(--field-border\)/, 'o token que a correção reusa precisa existir em formCss');
  assert.match(elementosCss, /\.alva-form \.answer:focus\{border-top-color:var\(--field-border\);border-right-color:var\(--field-border\);border-bottom-color:var\(--field-border\);border-left-color:var\(--field-border\);box-shadow:none\}/);
});

test('nenhum atalho com var() na folha, porque o atalho não sobrevive ao GrapesJS', () => {
  // O GrapesJS reserializa a folha ao injetá-la no canvas (editor.addStyle). Um ATALHO
  // com var() vira pending-substitution no CSSOM do navegador: serializa vazio e some.
  // `border:1px solid var(--alva-el-line)` sumia inteiro de .answer, .choice e
  // .choice-key — no canvas e no rendered_html — enquanto .upload, com cor literal,
  // sobrevivia. Sem border-style o estado escolhido, que só troca border-color, não tinha
  // o que colorir: a moldura azul nunca aparecia. Achado D3 do gate de 2026-09-12.
  //
  // A prova é sobre a CLASSE do defeito, não sobre a borda: todo atalho com var() dentro
  // cai igual. Por isso a lista abaixo cobre também font, margin e padding — para o
  // próximo elemento nascer protegido em vez de redescobrir isto num gate visual.
  //
  // `background` fica de FORA, embora sofra do mesmo defeito: a folha já tem seis regras
  // que o usam com var() dentro — .custom-cta, .timer-toggle, .legend i, .bar-row b,
  // .statement-line e .donut. Nenhuma delas é elemento do catálogo (são peças do
  // formulário dinâmico e dos gráficos do quiz, que vão cruas para dentro de um <style>
  // e nunca passam pelo GrapesJS), e expandi-las não é o assunto desta onda. Registrado
  // no relatório da onda final para quem for migrar essas peças para o catálogo.
  //
  // A prova é sobre o TEXTO da folha, e não sobre um round-trip, de propósito: em jsdom o
  // atalho com var() sobrevive, então um round-trip aqui passaria verde com o defeito de
  // volta. Longhand com var() sobrevive nos dois.
  // border-color, border-width e border-style também são atalhos — das quatro faces — e
  // também somem com var() dentro: medido no Chrome, `border-color:var(--alva-el-line)`
  // não chegava ao canvas e a moldura caía em currentColor.
  const atalhos = new Set([
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-width', 'border-style', 'border-color',
    'font', 'margin', 'padding',
  ]);
  const culpados = [];
  postcss.parse(elementosCss).walkDecls((declaracao) => {
    if (atalhos.has(declaracao.prop) && declaracao.value.includes('var('))
      culpados.push(`${declaracao.parent.selector}{${declaracao.prop}:${declaracao.value}}`);
  });
  assert.deepEqual(culpados, [], 'expanda o atalho em longhand: com var() dentro, ele não chega ao canvas');
});

test('cartão de escolha, campo e crachá declaram border-style, que é o que o estado colore', () => {
  const regras = new Map();
  postcss.parse(elementosCss).walkRules((regra) => { if (!regras.has(regra.selector)) regras.set(regra.selector, regra); });
  for (const seletor of ['.answer', '.choice', '.choice-key']) {
    const declaracoes = new Map(regras.get(seletor).nodes.map((no) => [no.prop, no.value]));
    assert.equal(declaracoes.get('border-width'), '1px', `${seletor} sem border-width`);
    assert.equal(declaracoes.get('border-style'), 'solid', `${seletor} sem border-style: o estado escolhido não tem o que colorir`);
    for (const face of ['top', 'right', 'bottom', 'left'])
      assert.equal(declaracoes.get(`border-${face}-color`), 'var(--alva-el-line)', `${seletor} sem border-${face}-color`);
  }
});
