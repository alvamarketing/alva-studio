import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { temProjetoSalvo } from '../public/editor-shell.js';

// Página nova nasce com project: {} — objeto vazio, mas verdadeiro num if.
// O editor carregava esse projeto vazio e o template escolhido nunca chegava ao
// canvas: toda página criada abria em branco, qualquer que fosse o modelo.

test('projeto vazio não conta como projeto salvo', () => {
  assert.equal(temProjetoSalvo({}), false, 'objeto vazio é página nova, não canvas salvo');
  assert.equal(temProjetoSalvo(null), false);
  assert.equal(temProjetoSalvo(undefined), false);
});

test('projeto com conteúdo conta como projeto salvo', () => {
  assert.equal(temProjetoSalvo({ pages: [{ frames: [] }] }), true);
  assert.equal(temProjetoSalvo({ assets: [] }), true, 'qualquer chave já é estado salvo pelo editor');
});

test('uma página esvaziada de propósito continua vazia ao reabrir', () => {
  // quem apagou tudo não quer o modelo de volta na próxima abertura
  const esvaziada = { pages: [{ frames: [{ component: { components: [] } }] }] };
  assert.equal(temProjetoSalvo(esvaziada), true);
});

test('o editor decide pelo conteúdo do projeto, não pela existência do objeto', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /if \(temProjetoSalvo\(project\)\) editor\.loadProjectData\(project\);/);
  assert.doesNotMatch(fonte, /if \(project\) editor\.loadProjectData/, 'o if truthy é justamente o que deixava a página em branco');
});
