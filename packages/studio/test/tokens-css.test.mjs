// O editor de landing (Puck) não carrega styles.css inteiro — as regras globais de botão e
// campo do Studio quebrariam os painéis do Puck. Ele recebe só os tokens, do mesmo arquivo,
// para não existir uma segunda cópia das cores e da fonte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blocoDeTokens } from '../server/tokens-css.mjs';

test('só o bloco :root claro de styles.css vira tokens.css', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const tokens = blocoDeTokens(css);
  assert.match(tokens, /^:root \{/);
  assert.match(tokens, /--font-sans: 'Inter'/);
  assert.match(tokens, /--alva-blue: #286eea;/);
  assert.doesNotMatch(tokens, /^(button|body|\*)[ ,{]|data-color-scheme/m);
  assert.match(tokens, /\}\n$/);
});
