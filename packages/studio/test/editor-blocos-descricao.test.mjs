import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blocks, blockDescriptions } from '../public/templates.js';

test('todo bloco da biblioteca explica o que faz', () => {
  const semDescricao = blocks.map(([id]) => id).filter((id) => !blockDescriptions[id]);
  assert.deepEqual(semDescricao, [], 'blocos sem descrição não dizem nada a quem não é técnico');
});

test('as descrições falam de resultado, não de html', () => {
  assert.match(blockDescriptions.input, /respost|escrev|digit/i);
  assert.match(blockDescriptions['hero-section'], /topo|abertura|primeira/i);
  assert.match(blockDescriptions.columns, /lado a lado|colunas/i);
  for (const texto of Object.values(blockDescriptions)) {
    assert.doesNotMatch(texto, /<[a-z]+>|\bdiv\b|\bsection\b|\bcss\b|\bhtml\b/i, `descrição técnica demais: ${texto}`);
  }
});

test('o grupo genérico ganha nome que diz o que ele é', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  // "Grupo" não diz nada; o rótulo passa a descrever o que está dentro
  assert.match(fonte, /Bloco de conteúdo/);
});
