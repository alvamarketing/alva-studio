// Etapa 7, passo 4: o relatório mínimo em Analytics, só com as peças que a tela já tem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { modeloDosSinais, pintarSinaisDeBloco, carregarSinaisDeBloco } from '../public/sinais-de-bloco-ui.js';

const relatorio = {
  paginas: [{
    urlPath: '/oferta', nome: 'Oferta', visitas: 200,
    rolagem: [{ marco: 25, visitas: 190, percentual: 95 }, { marco: 50, visitas: 120, percentual: 60 }, { marco: 75, visitas: 60, percentual: 30 }, { marco: 100, visitas: 20, percentual: 10 }],
    blocos: [
      { id: 'a', tipo: 'Seção', rotulo: 'Seção · Emagreça', naPagina: true, entradas: 180, alcance: 90, segundosMedios: 10, cliques: 18 },
      { id: 'b', tipo: 'Botão', rotulo: 'Botão · Quero agora', naPagina: true, entradas: 60, alcance: 30, segundosMedios: 5, cliques: 9 },
      { id: 'c', tipo: 'Bloco', rotulo: 'Bloco c', naPagina: false, entradas: 5, alcance: 3, segundosMedios: 125.4, cliques: 0 },
    ],
  }],
};

test('o modelo vira linhas no formato das listas que a tela já usa: rótulo, valor, largura e parcela', () => {
  const [pagina] = modeloDosSinais(relatorio).paginas;
  assert.equal(pagina.titulo, 'Oferta · /oferta');
  assert.match(pagina.resumo, /200 visitas/);
  assert.deepEqual(pagina.rolagem[1], { label: 'Chegou a 50% da página', value: '120', width: '60%', share: '60%' });
  assert.deepEqual(pagina.chegou[0], { label: 'Seção · Emagreça', value: '180', width: '90%', share: '90%' });
  assert.equal(pagina.chegou[2].label, 'Bloco c (saiu da página)');
  assert.deepEqual(pagina.tempo.map((linha) => linha.value), ['10 s', '5 s', '2 min']);
  // A barra do tempo e a dos cliques são relativas ao maior da página.
  assert.deepEqual(pagina.tempo.map((linha) => linha.width), ['8%', '4%', '100%']);
  assert.deepEqual(pagina.cliques.map((linha) => [linha.value, linha.width]), [['18', '100%'], ['9', '50%'], ['0', '0%']]);
});

test('sem sinais, o estado vazio explica o que falta em vez de mostrar zeros', () => {
  const modelo = modeloDosSinais({ paginas: [] });
  assert.equal(modelo.vazio, true);
  assert.match(modelo.mensagem, /publicad/i);
  assert.equal(modeloDosSinais(null).vazio, true);
});

function tela() {
  const dom = new JSDOM('<section class="page-block"><div id="alvo"></div></section>');
  return { doc: dom.window.document, alvo: dom.window.document.getElementById('alvo') };
}

test('a tela reaproveita as classes que Analytics já tem: nenhuma classe nova', () => {
  const { doc, alvo } = tela();
  pintarSinaisDeBloco(alvo, relatorio, { doc });
  const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
  const classes = new Set([...alvo.querySelectorAll('[class]')].flatMap((no) => [...no.classList]));
  assert.ok(classes.size > 0);
  for (const classe of classes) assert.ok(css.includes(`.${classe}`), `.${classe} não existe em styles.css`);
  // A única coisa inline é a variável --p da barra, como em pintarRankList (app.js).
  for (const no of alvo.querySelectorAll('[style]')) assert.match(no.getAttribute('style'), /^--p:\s*\d+%;?$/);
  assert.equal(alvo.querySelectorAll('.rank-row').length, 4 + 3 * 3);
});

test('o rótulo vem do que o dono escreveu e entra como texto, nunca como marcação', () => {
  const { doc, alvo } = tela();
  const perigoso = { paginas: [{ ...relatorio.paginas[0], nome: '<img src=x onerror=alert(1)>', blocos: [{ ...relatorio.paginas[0].blocos[0], rotulo: '<b>x</b>' }] }] };
  pintarSinaisDeBloco(alvo, perigoso, { doc });
  assert.equal(alvo.querySelector('img'), null);
  assert.equal(alvo.querySelector('b'), null);
  assert.match(alvo.textContent, /<b>x<\/b>/);
});

test('o estado vazio e o de erro usam o cartão vazio existente', () => {
  const { doc, alvo } = tela();
  pintarSinaisDeBloco(alvo, { paginas: [] }, { doc });
  assert.ok(alvo.querySelector('.dashboard-empty'));
  pintarSinaisDeBloco(alvo, null, { doc, erro: 'Falhou.' });
  assert.match(alvo.textContent, /Falhou\./);
});

test('carregar pede a rota do projeto na janela escolhida e descarta a resposta de um projeto antigo', async () => {
  const { doc, alvo } = tela();
  const chamadas = [];
  const api = async (caminho) => { chamadas.push(caminho); return relatorio; };
  let atual = true;
  await carregarSinaisDeBloco({ api, projectId: 'p1', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z', alvo, doc, aindaVale: () => atual });
  assert.equal(chamadas[0], '/projects/p1/analytics/blocks?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-02T00%3A00%3A00.000Z');
  assert.ok(alvo.querySelector('.rank-row'));
  const { doc: doc2, alvo: alvo2 } = tela();
  atual = false;
  await carregarSinaisDeBloco({ api, projectId: 'p1', from: 'a', to: 'b', alvo: alvo2, doc: doc2, aindaVale: () => atual });
  assert.equal(alvo2.children.length, 0);
});

test('falha da API vira mensagem na própria seção e não derruba o resto de Analytics', async () => {
  const { doc, alvo } = tela();
  await carregarSinaisDeBloco({ api: async () => { throw new Error('Sem rede.'); }, projectId: 'p1', from: 'a', to: 'b', alvo, doc, aindaVale: () => true });
  assert.match(alvo.textContent, /Sem rede\./);
});

test('página medida sem blocos diz ao dono o que fazer: salvar e publicar de novo', () => {
  const modelo = modeloDosSinais({ paginas: [{ urlPath: '/antiga', nome: 'Oferta', visitas: 10, semBlocos: true, rolagem: [], blocos: [] }] });
  assert.match(modelo.paginas[0].aviso, /salve a página e publique de novo/i);
  assert.match(modelo.paginas[0].aviso, /publicar sozinho não basta|só publicar não basta/i);
});

test('o texto de "ainda não há sinais" é para leigo, sem a palavra tracker', () => {
  const modelo = modeloDosSinais({ paginas: [] });
  assert.doesNotMatch(modelo.mensagem, /tracker/i);
  assert.match(modelo.mensagem, /visitas/);
});
