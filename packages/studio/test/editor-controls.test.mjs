import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDestination, componentLabel } from '../public/editor-shell.js';

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
