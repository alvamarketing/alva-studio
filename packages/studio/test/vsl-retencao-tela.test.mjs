import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modeloDaCurva } from '../public/vsl-retention-ui.js';

// A curva precisa dizer, em uma olhada, onde o vídeo perde gente. Números soltos não
// respondem isso; a leitura é a forma da queda entre um marco e o outro.

test('cada marco vira uma barra com altura proporcional à retenção', () => {
  const modelo = modeloDaCurva({
    inicios: 100,
    pontos: [
      { marco: 0, espectadores: 100, retencao: 100 },
      { marco: 25, espectadores: 60, retencao: 60 },
      { marco: 50, espectadores: 40, retencao: 40 },
      { marco: 75, espectadores: 30, retencao: 30 },
      { marco: 100, espectadores: 25, retencao: 25 },
    ],
    maiorQueda: { de: 0, para: 25, perdidos: 40 },
    cliquesNoCta: 10,
    conversao: 10,
  });
  assert.equal(modelo.barras.length, 5);
  assert.deepEqual(modelo.barras.map((b) => b.altura), ['100%', '60%', '40%', '30%', '25%']);
  assert.deepEqual(modelo.barras.map((b) => b.rotulo), ['Início', '25%', '50%', '75%', 'Fim']);
});

test('a barra da maior queda é marcada, para o olho ir direto nela', () => {
  const modelo = modeloDaCurva({
    inicios: 100,
    pontos: [
      { marco: 0, espectadores: 100, retencao: 100 },
      { marco: 25, espectadores: 90, retencao: 90 },
      { marco: 50, espectadores: 30, retencao: 30 },
      { marco: 75, espectadores: 28, retencao: 28 },
      { marco: 100, espectadores: 25, retencao: 25 },
    ],
    maiorQueda: { de: 25, para: 50, perdidos: 60 },
    cliquesNoCta: 0,
    conversao: 0,
  });
  const marcada = modelo.barras.filter((b) => b.queda);
  assert.equal(marcada.length, 1);
  assert.equal(marcada[0].rotulo, '50%', 'a queda se vê na barra onde a gente sumiu');
});

test('o resumo diz em palavras onde o vídeo perde gente', () => {
  const modelo = modeloDaCurva({
    inicios: 200, pontos: [], maiorQueda: { de: 50, para: 75, perdidos: 80 }, cliquesNoCta: 12, conversao: 6,
  });
  assert.match(modelo.resumo, /50%.*75%/, 'nomear o trecho é o que torna a curva acionável');
  assert.match(modelo.resumo, /80/);
});

test('sem audiência a tela convida a publicar, em vez de mostrar zeros', () => {
  const modelo = modeloDaCurva({ inicios: 0, pontos: [], maiorQueda: null, cliquesNoCta: 0, conversao: 0 });
  assert.equal(modelo.vazio, true);
  assert.match(modelo.resumo, /ainda|nenhuma|assist/i);
});

test('a taxa de clique no CTA aparece junto, que é o desfecho que importa', () => {
  const modelo = modeloDaCurva({ inicios: 50, pontos: [], maiorQueda: null, cliquesNoCta: 7, conversao: 14 });
  assert.equal(modelo.vazio, false);
  assert.match(modelo.cta, /7/);
  assert.match(modelo.cta, /14%/);
});

test('a tela da VSL reserva o lugar da curva', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="vsl-retention"/);
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.vsl-retention-bar/, 'sem altura desenhada não há curva, só números');
});

test('abrir uma VSL pinta a curva dela; o formulário em branco esconde a seção', async () => {
  const fonte = await readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  assert.match(fonte, /pintarRetencao\(video\)/, 'a curva acompanha a VSL aberta');
  const funcao = fonte.slice(fonte.indexOf('const pintarRetencao'), fonte.indexOf('const showForm'));
  assert.match(funcao, /secao\.hidden = !video/, 'em VSL nova não há o que mostrar');
  assert.match(funcao, /catch/, 'sem analytics a VSL continua editável');
});
