import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alvaStudioTheme, studioEditorOptions } from '../public/studio-sdk-editor.js';

// O SDK vem com a cara deles — roxo, escuro. Aqui ele veste a paleta do Alva: as mesmas
// cores, cantos e distâncias do resto do sistema, para não parecer outro produto dentro
// do produto.

test('o tema sai dos tokens do Alva, não do roxo de fábrica', () => {
  const tema = alvaStudioTheme();
  const cores = JSON.stringify(tema);
  assert.match(cores, /#286eea/i, 'o azul do Alva é a cor de ação');
  assert.doesNotMatch(cores, /hsl\(258 90% 66%\)|#8b5cf6|#7c3aed/i, 'o roxo do SDK não entra');
  assert.match(cores, /#101828/i, 'a tinta do texto é a nossa');
});

test('o editor guarda no nosso banco, não na nuvem deles', () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async () => {} });
  assert.equal(opcoes.storage.type, 'self');
  assert.equal(typeof opcoes.storage.onLoad, 'function');
  assert.equal(typeof opcoes.storage.onSave, 'function');
  assert.ok(!('cloud' in (opcoes.storage || {})));
});

test('a página aberta é a que o Studio mandou abrir', async () => {
  const carregadas = [];
  const opcoes = studioEditorOptions({
    pageId: 'pagina-7',
    carregar: async (id) => { carregadas.push(id); return { pages: [{ name: 'Home', component: '<h1>Oi</h1>' }] }; },
    salvar: async () => {},
  });
  const resultado = await opcoes.storage.onLoad();
  assert.deepEqual(carregadas, ['pagina-7']);
  assert.equal(resultado.project.pages[0].component, '<h1>Oi</h1>');
});

test('página nova abre com conteúdo, não com o canvas vazio do SDK', async () => {
  const opcoes = studioEditorOptions({ pageId: 'nova', carregar: async () => null, salvar: async () => {} });
  const resultado = await opcoes.storage.onLoad();
  assert.ok(Array.isArray(resultado.project.pages) && resultado.project.pages.length >= 1);
});

test('salvar entrega o projeto para quem sabe gravar', async () => {
  const gravados = [];
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async (id, projeto) => gravados.push([id, projeto]) });
  await opcoes.storage.onSave({ project: { pages: [] } });
  assert.deepEqual(gravados, [['p1', { pages: [] }]]);
});

test('o SDK é servido pelo nosso servidor, não por CDN de terceiro', async () => {
  const servidor = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(servidor, /'\/vendor\/studio-sdk\.umd\.js'/);
  assert.match(servidor, /'\/vendor\/studio-sdk\.css'/);
  const fonte = await readFile(new URL('../public/studio-sdk-editor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /unpkg\.com|cdn\.jsdelivr/, 'a página publicada não pode depender de CDN externo');
});

test('salvar leva o HTML junto, senão a página publicada fica para trás', async () => {
  const gravados = [];
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async (...args) => gravados.push(args) });
  await opcoes.storage.onSave({
    project: { pages: [] },
    editor: { getHtml: () => '<h1>Novo</h1>', getCss: () => 'h1{color:red}' },
  });
  const [, , extras] = gravados[0];
  assert.equal(extras.html, '<h1>Novo</h1>');
  assert.equal(extras.css, 'h1{color:red}');
});

test('editor sem exportação não derruba o salvamento', async () => {
  const gravados = [];
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({}), salvar: async (...args) => gravados.push(args) });
  await opcoes.storage.onSave({ project: { pages: [] } });
  assert.equal(gravados.length, 1);
});

test('a página carregada leva o nome que a pessoa deu, não o identificador', async () => {
  const opcoes = studioEditorOptions({
    pageId: 'p1',
    nomeDaPagina: 'Campanha de verão',
    carregar: async () => ({ pages: [{ id: 'u0S8XWDXI4', component: '<h1>Oi</h1>' }] }),
    salvar: async () => {},
  });
  const { project } = await opcoes.storage.onLoad();
  // sem nome, o gerenciador de páginas do SDK mostra o id cru e ninguém reconhece nada
  assert.equal(project.pages[0].name, 'Campanha de verão');
});

test('página que já tem nome não é renomeada por cima', async () => {
  const opcoes = studioEditorOptions({
    pageId: 'p1',
    nomeDaPagina: 'Campanha',
    carregar: async () => ({ pages: [{ name: 'Etapa 2', component: '<h1>Oi</h1>' }] }),
    salvar: async () => {},
  });
  const { project } = await opcoes.storage.onLoad();
  assert.equal(project.pages[0].name, 'Etapa 2');
});

test('sem nome informado o carregamento não quebra', async () => {
  const opcoes = studioEditorOptions({ pageId: 'p1', carregar: async () => ({ pages: [{ component: '<h1>Oi</h1>' }] }), salvar: async () => {} });
  const { project } = await opcoes.storage.onLoad();
  assert.equal(project.pages.length, 1);
});
