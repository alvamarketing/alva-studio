import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/editor-shell.css', import.meta.url), 'utf8');

test('o editor declara a própria paleta clara em vez de herdar a do tema do app', () => {
  // O editor pinta fundo branco fixo. Sem redeclarar os tokens, --alva-ink vem do tema
  // escuro (#f2f4f7) e o texto fica branco sobre branco: 1,1:1 de contraste.
  const escopo = css.slice(css.indexOf('#editing'), css.indexOf('#editing') + 900);
  assert.match(escopo, /--alva-ink:/);
  assert.match(escopo, /--alva-muted:/);
  assert.match(escopo, /--alva-line:/);
});

test('a paleta do editor não usa os tons claros do tema escuro para texto', () => {
  const escopo = css.slice(css.indexOf('#editing'), css.indexOf('#editing') + 900);
  assert.doesNotMatch(escopo, /--alva-ink:\s*#f2f4f7/i);
  assert.match(escopo, /--alva-ink:\s*#101828/i);
});
