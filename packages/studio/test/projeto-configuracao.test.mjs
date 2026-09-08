import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = () => readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = () => readFile(new URL('../public/app.js', import.meta.url), 'utf8');

// Configurar um projeto é mexer no nome e no identificador dele. O botão apontava para
// a tela de publicação, que é outra coisa: publicar é levar ao ar o que já está pronto.
// PUT /api/projects/:id já existia e nunca tinha sido usado pela interface.

test('existe uma tela de configuração do projeto com nome e identificador', async () => {
  const fonte = await html();
  const dialogo = fonte.slice(fonte.indexOf('id="project-settings-dialog"'));
  assert.ok(dialogo, 'sem diálogo não há onde configurar o projeto');
  const corpo = dialogo.slice(0, dialogo.indexOf('</dialog>'));
  assert.match(corpo, /name="name"/);
  assert.match(corpo, /name="slug"/);
  assert.match(corpo, /id="project-settings-error"/, 'erro de identificador repetido precisa aparecer no diálogo');
});

test('"Configurar projeto" abre a configuração, não a publicação', async () => {
  const fonte = await app();
  const handler = fonte.slice(fonte.indexOf("$('#project-settings-action').onclick"));
  const corpo = handler.slice(0, handler.indexOf('\n});'));
  assert.match(corpo, /#project-settings-dialog/);
  assert.doesNotMatch(corpo, /setDashboardView\('publication'\)/, 'publicar e configurar são coisas diferentes');
});

test('a configuração salva pelo endpoint que já existia', async () => {
  const fonte = await app();
  const envio = fonte.slice(fonte.indexOf("$('#project-settings-form').onsubmit"));
  const corpo = envio.slice(0, envio.indexOf('\n});'));
  assert.match(corpo, /'\/projects\/' \+ [a-zA-Z]+, 'PUT'/, 'o PUT de projeto já existe no servidor');
  assert.match(corpo, /name/);
  assert.match(corpo, /slug/);
});

test('o identificador aparece com a explicação do que ele afeta', async () => {
  const fonte = await html();
  const dialogo = fonte.slice(fonte.indexOf('id="project-settings-dialog"'));
  const corpo = dialogo.slice(0, dialogo.indexOf('</dialog>'));
  // trocar o identificador muda endereços que já podem estar publicados
  assert.match(corpo, /endereç|publicad|link/i);
});
