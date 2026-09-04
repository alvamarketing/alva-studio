import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme, resolveTheme, nextTheme, nextSidebarState } from '../public/ui-preferences.js';

test('aparência aceita claro, escuro e sistema com fallback seguro', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('system'), 'system');
  assert.equal(normalizeTheme('qualquer-coisa'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('botão de aparência percorre sistema, claro e escuro', () => {
  assert.equal(nextTheme('system'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'system');
});

test('botão lateral alterna entre menu aberto e recolhido', () => {
  assert.equal(nextSidebarState(false), true);
  assert.equal(nextSidebarState(true), false);
});
