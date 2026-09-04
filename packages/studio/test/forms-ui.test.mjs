import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStep, moveStep, parseOptions } from '../public/forms.js';

const htmlPath = new URL('../public/index.html', import.meta.url);
const cssPath = new URL('../public/forms.css', import.meta.url);

test('dashboard oferece páginas e formulários dinâmicos como destinos principais', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /id="nav-pages"/);
  assert.match(html, /id="nav-forms"/);
  assert.match(html, /Formulários Dinâmicos/);
  assert.match(html, /id="forms-view"/);
  assert.match(html, /id="new-form"/);
  assert.match(html, /id="form-editing"/);
  assert.match(html, /id="form-responses-dialog"/);
});

test('editor cria e reordena etapas sem alterar o array original', () => {
  const step = createStep('single_choice', 'etapa-1');
  assert.equal(step.type, 'single_choice');
  assert.equal(step.options.length, 2);
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveStep(rows, 1, -1).map((row) => row.id), ['b', 'a', 'c']);
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(moveStep(rows, 0, -1), rows);
});

test('opções eliminam linhas vazias e preservam rótulos únicos', () => {
  assert.deepEqual(parseOptions(' Empresa\n\nProfissional\nEmpresa '), ['Empresa', 'Profissional']);
});

test('editor dinâmico tem layout responsivo e controles acessíveis', async () => {
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /\.dynamic-editor-grid/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /\.dynamic-step-button\[aria-current=['"]true['"]\]/);
});
