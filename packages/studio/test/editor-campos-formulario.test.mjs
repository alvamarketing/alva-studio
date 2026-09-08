import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formFieldSummary } from '../public/editor-shell.js';

test('cada campo do formulário aparece por nome e tipo, para poder ser reconhecido', () => {
  assert.deepEqual(formFieldSummary({ type: 'email', name: 'email', label: 'E-mail' }), { titulo: 'E-mail', tipo: 'E-mail' });
  assert.deepEqual(formFieldSummary({ type: 'tel', name: 'telefone', label: 'WhatsApp' }), { titulo: 'WhatsApp', tipo: 'Telefone' });
  assert.deepEqual(formFieldSummary({ type: 'text', name: 'nome', label: '' }), { titulo: 'nome', tipo: 'Texto' });
  assert.deepEqual(formFieldSummary({}), { titulo: 'Campo', tipo: 'Texto' });
});

test('o inspetor do formulário lista os campos com remover ao lado', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /fe-field-list/);
  assert.match(fonte, /Remover campo/);
  // o botão de adicionar continua, agora junto da lista
  assert.match(fonte, /\+ Adicionar campo/);
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.fe-field-list/);
});
