import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerUI } from '../public/owner.js';

// O portão de acesso mostrava um modo OU o outro, decidido só pelo servidor: quem
// abrisse o Studio que já tem dono via apenas "Entrar", e quem abrisse um Studio vazio
// via apenas "Criar conta". Não havia como ir de um lado ao outro — nem para conferir
// em qual dos dois se está. É o básico de uma tela de acesso.
async function portao({ setupRequired }) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  const anterior = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const mount = dom.window.document.createElement('div');
  dom.window.document.body.append(mount);
  const ui = createOwnerUI({
    api: async (rota) => (rota === '/session' ? { authenticated: false, setupRequired } : {}),
    onAuthenticated: async () => {},
    onLoggedOut: () => {},
    onSettingsChanged: () => {},
    settingsMount: mount,
    toast: () => {},
  });
  await ui.initialize();
  const $ = (s) => dom.window.document.querySelector(s);
  return { $, fechar: () => { Object.assign(globalThis, anterior); dom.window.close(); } };
}

test('o portão oferece o caminho para o outro modo em vez de prender a pessoa', async () => {
  const { $, fechar } = await portao({ setupRequired: true });
  try {
    assert.equal($('#access-gate').dataset.setup, 'true');
    const troca = $('#access-switch');
    assert.ok(troca, 'não existe botão para trocar de modo');
    assert.ok(!troca.hidden, 'o botão de trocar de modo está escondido');
    assert.match(troca.textContent, /entrar/i, 'no primeiro acesso o caminho oferecido é entrar');
    troca.click();
    assert.equal($('#access-gate').dataset.setup, 'false', 'clicar não trocou de modo');
    assert.match($('#access-title').textContent, /Entre no seu Studio/);
    assert.equal($('#access-name-label').hidden, true, 'o campo de nome ficou no formulário de entrar');
    assert.equal($('#access-submit').disabled, false, 'entrar sempre é possível');
    troca.click();
    assert.equal($('#access-gate').dataset.setup, 'true', 'não deu para voltar');
    assert.equal($('#access-submit').disabled, false, 'criar conta é possível no primeiro acesso');
  } finally {
    fechar();
  }
});

test('num Studio que já tem dono, criar conta diz por que não dá, em vez de falhar no envio', async () => {
  // /api/setup roda uma vez na vida (session-service.mjs: 409 depois disso). Um botão
  // que leva a um formulário condenado é o "botão bonito que não faz nada"; o motivo
  // escrito e o envio desligado é a versão honesta da mesma tela.
  const { $, fechar } = await portao({ setupRequired: false });
  try {
    assert.equal($('#access-gate').dataset.setup, 'false');
    assert.equal($('#access-note').hidden, true, 'entrar não tem por que trazer aviso');
    $('#access-switch').click();
    assert.equal($('#access-gate').dataset.setup, 'true');
    assert.equal($('#access-note').hidden, false, 'o motivo não apareceu');
    assert.match($('#access-note').textContent, /já tem/i);
    assert.equal($('#access-submit').disabled, true, 'o envio condenado continuou ligado');
    $('#access-switch').click();
    assert.equal($('#access-submit').disabled, false, 'voltar para entrar não reabilitou o envio');
    assert.equal($('#access-note').hidden, true);
  } finally {
    fechar();
  }
});
