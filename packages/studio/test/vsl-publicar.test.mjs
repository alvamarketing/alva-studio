import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vslUiAccessPolicy } from '../public/vsl-ui.js';

// Publicar só faz sentido quando a VSL já existe, então o botão nasce escondido no
// formulário em branco. O que faltava era reapresentar o formulário depois de salvar:
// a VSL passava a existir e o botão continuava escondido até sair e reabrir pela lista.

test('sem VSL salva não há o que publicar', () => {
  const politica = vslUiAccessPolicy({ hasVideo: false, can: () => true });
  assert.equal(politica.canPublish, false);
  assert.equal(politica.canEdit, true, 'dá para preencher antes de existir');
});

test('com a VSL salva e permissão, publicar fica disponível', () => {
  assert.equal(vslUiAccessPolicy({ hasVideo: true, can: () => true }).canPublish, true);
});

test('permissão de publicar é separada da de editar', () => {
  const so_edita = vslUiAccessPolicy({ hasVideo: true, can: (c) => c === 'video.write' });
  assert.equal(so_edita.canEdit, true);
  assert.equal(so_edita.canPublish, false);
});

test('salvar reapresenta o formulário, para o botão de publicar aparecer', async () => {
  const fonte = await readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  const salvar = fonte.slice(fonte.indexOf('current = saved'), fonte.indexOf('current = saved') + 220);
  assert.match(salvar, /showForm\(saved\)/, 'sem isto a VSL existe e o botão segue escondido');
});

test('quando publicar está fora de alcance, o botão não fica só escondido em silêncio', async () => {
  const fonte = await readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  const handler = fonte.slice(fonte.indexOf("field(form(), 'publish').onclick"));
  const guarda = handler.slice(0, handler.indexOf('\n      const projectId'));
  // sair no return sem dizer nada é o mesmo defeito do confirm() suprimido: a ação
  // some e ninguém entende por quê
  assert.doesNotMatch(guarda, /\)\s*return;/, 'recusa muda deixa a pessoa clicando à toa');
  assert.match(guarda, /throw new Error/, 'a recusa precisa dizer o motivo');
});
