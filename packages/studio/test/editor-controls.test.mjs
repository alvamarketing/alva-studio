import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  safeDestination,
  componentLabel,
  panelMode,
  editorActionMeta,
  isCanvasBackgroundElement,
} from '../public/editor-shell.js';

test('endereços de botão permitem contatos e links de seção sem executar código', () => {
  for (const url of [
    'https://example.com/path?q=1',
    'http://example.com',
    '#contato',
    '/contato',
    './obrigado.html',
    'mailto:oi@example.com',
    'tel:+5511999999999',
  ]) {
    assert.equal(safeDestination(url), url);
  }
  for (const url of [
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,hello',
    '//example.com',
    'https://example.com/a b',
  ]) {
    assert.throws(() => safeDestination(url));
  }
});

test('imagem local aceita apenas dados raster e não conteúdo executável', () => {
  assert.equal(safeDestination('data:image/png;base64,aGVsbG8=', true), 'data:image/png;base64,aGVsbG8=');
  for (const url of [
    'data:image/svg+xml;base64,aGVsbG8=',
    'data:text/html;base64,aGVsbG8=',
    'javascript:alert(1)',
    'mailto:oi@example.com',
  ]) {
    assert.throws(() => safeDestination(url, true));
  }
});

test('nomes visíveis dos componentes usam linguagem de edição', () => {
  const component = (tag) => ({ get: () => tag, is: () => false });
  assert.equal(componentLabel(component('h1')), 'Título');
  assert.equal(componentLabel(component('input')), 'Campo');
  assert.equal(componentLabel(component('section')), 'Seção');
  assert.equal(componentLabel(component('div')), 'Grupo de elementos');
  assert.equal(componentLabel({ is: () => true, get: () => 'body' }), 'Página');
});

test('o painel único alterna entre elementos e edição conforme a seleção', () => {
  assert.equal(panelMode(null), 'library');
  assert.equal(panelMode({ is: (type) => type === 'wrapper' }), 'library');
  assert.equal(panelMode({ is: () => false }), 'inspector');
});

test('ações compactas preservam nomes acessíveis e ícones', () => {
  for (const action of ['undo', 'redo', 'moveUp', 'moveDown', 'selectParent', 'duplicate', 'delete']) {
    assert.match(editorActionMeta[action].label, /\S/);
    assert.match(editorActionMeta[action].icon, /^<svg/);
    assert.match(editorActionMeta[action].icon, /aria-hidden="true"/);
  }
});

test('somente o fundo estrutural do canvas fecha a edição', () => {
  const element = (tagName) => ({ tagName });
  assert.equal(isCanvasBackgroundElement(element('BODY')), true);
  assert.equal(isCanvasBackgroundElement(element('MAIN')), true);
  assert.equal(isCanvasBackgroundElement(element('SECTION')), true);
  assert.equal(isCanvasBackgroundElement(element('DIV')), false);
  assert.equal(isCanvasBackgroundElement(element('BUTTON')), false);
  assert.equal(isCanvasBackgroundElement(null), false);
});

test('layout móvel empilha painel e canvas sem largura mínima forçada', async () => {
  const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');
  const mobile = css.match(/@media \(max-width: 740px\) \{([\s\S]+)\}\s*$/)?.[1] || '';
  assert.match(mobile, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(mobile, /grid-template-rows:/);
  assert.match(mobile, /\.fe-element-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*height:\s*calc\(100dvh - 112px\)/);
});
