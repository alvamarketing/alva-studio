import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStep, createScreen, moveStep, parseOptions } from '../public/forms.js';

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

test('catálogo dinâmico oferece perguntas, mídia, conversão e gráficos com ícone e movimento', () => {
  for (const type of ['long_text', 'multiple_choice', 'image', 'video', 'date', 'number', 'scale', 'address', 'file', 'cta', 'statement', 'chart']) {
    const step = createStep(type, `etapa-${type}`);
    assert.equal(step.type, type);
    assert.match(step.icon, /^[a-z_]+$/);
    assert.equal(step.motion, 'fade-up');
  }
  assert.deepEqual(createStep('scale', 'escala').range, { min: 1, max: 10 });
  assert.deepEqual(createStep('chart', 'grafico').chart.values, [72, 48, 86]);
});

test('opções eliminam linhas vazias e preservam rótulos únicos', () => {
  assert.deepEqual(parseOptions(' Empresa\n\nProfissional\nEmpresa '), ['Empresa', 'Profissional']);
});

test('editor dinâmico tem layout responsivo e controles acessíveis', async () => {
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /\.dynamic-editor-grid/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /\.dynamic-step-button\[aria-current=['"]true['"]\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.material-symbols-outlined/);
});

test('editor cria telas compostas com mais de um elemento', () => {
  const screen = createScreen('capture', 'tela-inicial');
  assert.equal(screen.id, 'tela-inicial');
  assert.ok(screen.elements.length >= 3);
  assert.ok(screen.elements.some((element) => element.type === 'short_text'));
  assert.ok(screen.elements.some((element) => element.type === 'phone'));
});
