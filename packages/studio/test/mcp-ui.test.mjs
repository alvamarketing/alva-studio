import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('projeto inclui conexão MCP simples sem anunciar ferramentas fora do escopo', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="project-agent-keys"/);
  assert.match(html, /id="mcp-key-form"/);
  assert.match(html, /class="mcp-key-scope"/);
  assert.match(html, /class="mcp-key-scope-input"/);
  assert.match(styles, /\.project-columns > \.project-surface,[\s\S]*?min-width: 0/);
  assert.match(styles, /\.publication-details \.mcp-key-scope-input[\s\S]*?width: auto[\s\S]*?min-height: 0/);
  assert.match(app, /\/mcp\/keys/);
  assert.doesNotMatch(html + app, /WaveSpeed|Apps ou Lab|carteira de créditos/);
});
