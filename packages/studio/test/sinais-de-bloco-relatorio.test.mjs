// Etapa 7, passo 3 (parte pura): juntar o que o banco agregou com a estrutura da página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocosDaPagina, montarRelatorioDeSinais } from '../server/sinais-de-bloco.mjs';

const estado = {
  formato: 'alva/1', root: { title: 'Oferta' },
  content: [
    { id: 'secao-topo', type: 'section', props: {}, children: [
      { id: 'titulo-1', type: 'heading', props: { text: 'Emagreça sem sofrer', level: 1 }, children: [] },
      { id: 'botao-1', type: 'button', props: { text: 'Quero agora', href: '#x' }, children: [] },
    ] },
    { id: 'secao-form', type: 'section', props: {}, children: [
      { id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', type: 'form', props: {}, children: [
        { id: 'campo-1', type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email' }, children: [] },
      ] },
    ] },
  ],
};

test('os blocos da página saem na ordem em que aparecem, com tipo e rótulo legíveis; campo não entra', () => {
  assert.deepEqual(blocosDaPagina(estado).map(({ id, tipo, rotulo }) => [id, tipo, rotulo]), [
    ['secao-topo', 'Seção', 'Seção · Emagreça sem sofrer'],
    ['titulo-1', 'Título', 'Título · Emagreça sem sofrer'],
    ['botao-1', 'Botão', 'Botão · Quero agora'],
    ['secao-form', 'Seção', 'Seção'],
    ['3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', 'Formulário', 'Formulário'],
  ]);
});

test('o rótulo é curto, e o texto nunca é lido de um campo', () => {
  const longo = { content: [{ id: 'a', type: 'text', props: { text: 'x'.repeat(500) }, children: [] }] };
  assert.ok(blocosDaPagina(longo)[0].rotulo.length <= 70);
  assert.equal(blocosDaPagina(estado).some((bloco) => bloco.id === 'campo-1'), false);
});

test('estado vazio ou inválido não derruba o relatório', () => {
  assert.deepEqual(blocosDaPagina(null), []);
  assert.deepEqual(blocosDaPagina({ content: 'x' }), []);
});

const agregado = {
  visitas: [{ urlPath: '/oferta', total: 200 }, { urlPath: '/sem-pagina', total: 10 }],
  blocos: [
    { urlPath: '/oferta', blockId: 'botao-1', entradas: 60, segundos: 300, cliques: 18 },
    { urlPath: '/oferta', blockId: 'secao-topo', entradas: 180, segundos: 1800, cliques: 18 },
    { urlPath: '/oferta', blockId: 'removido-1', entradas: 5, segundos: 10, cliques: 0 },
    { urlPath: '/sem-pagina', blockId: 'x1', entradas: 4, segundos: 8, cliques: 1 },
  ],
  rolagem: [
    { urlPath: '/oferta', marco: 25, total: 190 }, { urlPath: '/oferta', marco: 50, total: 120 },
    { urlPath: '/oferta', marco: 75, total: 60 }, { urlPath: '/oferta', marco: 100, total: 20 },
  ],
};
const paginas = [{ route: '/Oferta/', name: 'Oferta', editorState: estado }];

test('o relatório agrega por página e por bloco: entradas, tempo médio, cliques e % que chegou', () => {
  const { paginas: relatorio } = montarRelatorioDeSinais({ ...agregado, paginas });
  const oferta = relatorio.find((pagina) => pagina.urlPath === '/oferta');
  assert.equal(oferta.nome, 'Oferta');
  assert.equal(oferta.visitas, 200);
  assert.deepEqual(oferta.rolagem, [
    { marco: 25, visitas: 190, percentual: 95 }, { marco: 50, visitas: 120, percentual: 60 },
    { marco: 75, visitas: 60, percentual: 30 }, { marco: 100, visitas: 20, percentual: 10 },
  ]);
  // Na ordem da página; o que saiu dela vai para o fim, marcado.
  assert.deepEqual(oferta.blocos.map((bloco) => bloco.id), ['secao-topo', 'botao-1', 'removido-1']);
  const topo = oferta.blocos[0];
  assert.deepEqual({ ...topo }, { id: 'secao-topo', tipo: 'Seção', rotulo: 'Seção · Emagreça sem sofrer', naPagina: true, entradas: 180, alcance: 90, segundosMedios: 10, cliques: 18 });
  assert.equal(oferta.blocos[1].alcance, 30);
  assert.equal(oferta.blocos[1].segundosMedios, 5);
  assert.equal(oferta.blocos[2].naPagina, false);
});

test('página que não existe mais aparece com os ids, sem rótulo inventado', () => {
  const { paginas: relatorio } = montarRelatorioDeSinais({ ...agregado, paginas });
  const solta = relatorio.find((pagina) => pagina.urlPath === '/sem-pagina');
  assert.equal(solta.nome, null);
  assert.equal(solta.blocos[0].rotulo, 'Bloco x1');
  assert.equal(solta.blocos[0].naPagina, false);
});

test('o percentual nunca passa de 100, mesmo se a visita foi medida e o pageview, não', () => {
  const { paginas: relatorio } = montarRelatorioDeSinais({
    visitas: [{ urlPath: '/a', total: 2 }],
    blocos: [{ urlPath: '/a', blockId: 'b', entradas: 5, segundos: 5, cliques: 0 }],
    rolagem: [{ urlPath: '/a', marco: 25, total: 5 }],
    paginas: [],
  });
  assert.equal(relatorio[0].visitas, 5);
  assert.equal(relatorio[0].blocos[0].alcance, 100);
});

test('sem dados, o relatório é vazio (não um erro)', () => {
  assert.deepEqual(montarRelatorioDeSinais({ visitas: [], blocos: [], rolagem: [], paginas: [] }), { paginas: [] });
});

test('o tempo médio é por entrada, com uma casa', () => {
  const { paginas: relatorio } = montarRelatorioDeSinais({
    visitas: [{ urlPath: '/a', total: 3 }],
    blocos: [{ urlPath: '/a', blockId: 'b', entradas: 3, segundos: 10, cliques: 0 }], rolagem: [], paginas: [],
  });
  assert.equal(relatorio[0].blocos[0].segundosMedios, 3.3);
});

// --- Conferência de 02/10/2026: o relatório tem teto ---
// O tracker público é conhecido por qualquer um: dá para forjar ids válidos e caminhos
// arbitrários. Sem teto, 100.000 linhas forjadas viravam 13 MB de resposta.
test('o relatório limita páginas e blocos órfãos: dado forjado não vira resposta gigante', () => {
  const blocos = [];
  const rolagem = [];
  for (let p = 0; p < 80; p += 1) {
    for (let b = 0; b < 300; b += 1) blocos.push({ urlPath: `/forjada-${p}`, blockId: `id-${b}`, entradas: 1 + (b % 7), segundos: 1, cliques: 0 });
    rolagem.push({ urlPath: `/forjada-${p}`, marco: 25, total: 1 });
  }
  const { paginas } = montarRelatorioDeSinais({ visitas: [], blocos, rolagem, paginas: [] });
  assert.ok(paginas.length <= 50, `no máximo 50 páginas (veio ${paginas.length})`);
  assert.ok(paginas.every((pagina) => pagina.blocos.length <= 20), 'no máximo 20 blocos que saíram da página, por página');
});

test('as páginas mais visitadas é que ficam quando o teto corta', () => {
  const blocos = [];
  for (let p = 0; p < 60; p += 1) blocos.push({ urlPath: `/p-${p}`, blockId: 'a', entradas: p + 1, segundos: 1, cliques: 0 });
  const visitas = Array.from({ length: 60 }, (_, p) => ({ urlPath: `/p-${p}`, total: p + 1 }));
  const { paginas } = montarRelatorioDeSinais({ visitas, blocos, rolagem: [], paginas: [] });
  assert.equal(paginas[0].urlPath, '/p-59');
  assert.equal(paginas.some((pagina) => pagina.urlPath === '/p-0'), false);
});

test('página que só mandou rolagem (publicada antes dos sinais) vem marcada, para a tela explicar', () => {
  const { paginas } = montarRelatorioDeSinais({
    visitas: [{ urlPath: '/antiga', total: 10 }], blocos: [],
    rolagem: [{ urlPath: '/antiga', marco: 25, total: 8 }], paginas: [],
  });
  assert.equal(paginas[0].semBlocos, true);
  const comBlocos = montarRelatorioDeSinais({
    visitas: [{ urlPath: '/nova', total: 10 }],
    blocos: [{ urlPath: '/nova', blockId: 'a', entradas: 4, segundos: 8, cliques: 1 }], rolagem: [], paginas: [],
  });
  assert.equal(comBlocos.paginas[0].semBlocos, false);
});
