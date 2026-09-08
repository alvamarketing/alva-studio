import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const dialog = markup.slice(markup.indexOf('id="settings-dialog"'), markup.indexOf('id="settings-dialog"') + 3000);

test('o diálogo separa recebimento de respostas de publicação', () => {
  assert.match(dialog, /Respostas do formulário/);
  assert.match(dialog, /Publicação e domínio/);
  assert.match(dialog, /class="dialog-section"/);
});

test('o campo de webhook explica o que faz antes de pedir a url', () => {
  const secao = dialog.slice(dialog.indexOf('Respostas do formulário'), dialog.indexOf('Publicação e domínio'));
  assert.match(secao, /name="webhook"/);
  assert.match(secao, /Studio/, 'diz onde as respostas ficam por padrão');
});

test('abrir pelo formulário leva direto ao recebimento das respostas', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /onOpenFormSettings: \(\) => abrirConfiguracoesDaPagina\('respostas'\)/);
  assert.match(app, /function abrirConfiguracoesDaPagina\(/);
});
