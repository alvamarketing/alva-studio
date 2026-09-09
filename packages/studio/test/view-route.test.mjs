import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewToHash, hashToView, createViewRouter, viewToRestore } from '../public/view-route.js';

test('cada view do painel vira um endereço e volta igual', () => {
  for (const view of ['home', 'company', 'history', 'settings', 'project', 'pages', 'forms', 'vsl']) {
    assert.equal(hashToView(viewToHash(view)).view, view, `round-trip falhou para ${view}`);
  }
});

test('endereço ausente ou desconhecido cai na home sem quebrar', () => {
  assert.equal(hashToView('').view, 'home');
  assert.equal(hashToView('#').view, 'home');
  assert.equal(hashToView('#/inexistente').view, 'home');
  assert.equal(hashToView(undefined).view, 'home');
});

test('configurações preservam a aba aberta no endereço', () => {
  const hash = viewToHash('settings', { settingsTab: 'vercel' });
  assert.deepEqual(hashToView(hash), { view: 'settings', settingsTab: 'vercel' });
});

test('configurações sem aba explícita abrem em conta', () => {
  assert.deepEqual(hashToView(viewToHash('settings')), { view: 'settings', settingsTab: 'account' });
});

function fakeWindow(hash = '') {
  const listeners = {};
  return {
    location: { hash },
    addEventListener: (name, fn) => ((listeners[name] ??= []).push(fn)),
    emit: (name) => (listeners[name] ?? []).forEach((fn) => fn()),
  };
}

test('trocar de tela grava o endereço para sobreviver ao recarregar', () => {
  const win = fakeWindow();
  const router = createViewRouter({ window: win, onNavigate: () => {} });
  router.commit('pages');
  assert.equal(win.location.hash, '#/paginas');
});

test('recarregar em um endereço abre aquela tela, não a home', () => {
  const router = createViewRouter({ window: fakeWindow('#/formularios'), onNavigate: () => {} });
  assert.deepEqual(router.current(), { view: 'forms', settingsTab: 'account' });
});

test('voltar no navegador avisa a aplicação qual tela abrir', () => {
  const win = fakeWindow('#/paginas');
  const vistas = [];
  const router = createViewRouter({ window: win, onNavigate: (destino) => vistas.push(destino.view) });
  router.start();
  win.location.hash = '#/projeto';
  win.emit('hashchange');
  assert.deepEqual(vistas, ['project']);
});

test('a aplicação não é avisada quando foi ela mesma que trocou de tela', () => {
  const win = fakeWindow();
  const vistas = [];
  const router = createViewRouter({ window: win, onNavigate: (destino) => vistas.push(destino.view) });
  router.start();
  router.commit('vsl');
  win.emit('hashchange');
  assert.deepEqual(vistas, []);
});

test('tela de projeto só é restaurada quando existe projeto atual', () => {
  assert.equal(viewToRestore({ view: 'pages' }, { hasProject: true }), 'pages');
  assert.equal(viewToRestore({ view: 'pages' }, { hasProject: false }), 'home');
  assert.equal(viewToRestore({ view: 'vsl' }, { hasProject: false }), 'home');
});

test('telas sem projeto são restauradas mesmo sem projeto atual', () => {
  assert.equal(viewToRestore({ view: 'settings' }, { hasProject: false }), 'settings');
  assert.equal(viewToRestore({ view: 'history' }, { hasProject: false }), 'history');
});

test('sem endereço na barra o painel abre no projeto atual, se houver', () => {
  assert.equal(viewToRestore(null, { hasProject: true }), 'project');
  assert.equal(viewToRestore(null, { hasProject: false }), 'home');
});

test('as telas restauradas pelo endereço carregam o mesmo conteúdo do clique no menu', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  // páginas e formulários só ganham conteúdo em abrirPaginas/abrirFormularios;
  // restaurar pelo endereço precisa passar por elas, não por setDashboardView cru.
  assert.match(app, /async function abrirPaginas\(\)/);
  assert.match(app, /async function abrirFormularios\(\)/);
  assert.match(app, /function abrirView\(/);
  assert.match(app, /\$\('#nav-pages'\)\.onclick = action\(abrirPaginas\)/);
  assert.match(app, /\$\('#nav-forms'\)\.onclick = action\(abrirFormularios\)/);
  assert.match(app, /onNavigate: \(\{ view, settingsTab \}\) => abrirView\(view, \{ settingsTab, fromHistory: true \}\)/);
  assert.match(app, /abrirView\(viewToRestore\(rota, \{ hasProject \}\)/);
});

test('agentes e publicação têm endereço próprio e exigem projeto', () => {
  assert.equal(hashToView(viewToHash('agents')).view, 'agents');
  assert.equal(hashToView(viewToHash('publication')).view, 'publication');
  assert.equal(viewToRestore({ view: 'agents' }, { hasProject: false }), 'home');
  assert.equal(viewToRestore({ view: 'publication' }, { hasProject: true }), 'publication');
});

// O endereço é o que a pessoa copia e manda para alguém. "formularios" ficou de um produto
// que não existe mais; o endereço passa a dizer quiz, sem quebrar quem guardou o antigo.
test('a tela de quizzes tem endereço próprio e ainda atende o antigo', () => {
  assert.equal(viewToHash('forms'), '#/quizzes');
  assert.equal(hashToView('#/quizzes').view, 'forms');
  assert.equal(hashToView('#/formularios').view, 'forms');
});
