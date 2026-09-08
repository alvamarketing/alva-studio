import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fieldPlacementHint } from '../public/editor-shell.js';

test('o campo explica que a resposta viaja no envio do formulário, sem avançar tela', () => {
  const dentro = fieldPlacementHint({ dentroDeFormulario: true, quiz: false });
  assert.match(dentro, /envi/i);
  assert.doesNotMatch(dentro, /avanç/i, 'em página não há avanço de tela');
});

test('campo solto avisa que ainda não recebe resposta nenhuma', () => {
  const solto = fieldPlacementHint({ dentroDeFormulario: false, quiz: false });
  assert.match(solto, /formulário/i);
  assert.match(solto, /não/i, 'diz claramente que ainda não chega a lugar nenhum');
});

test('no quiz o campo avança de tela, e o texto muda', () => {
  const noQuiz = fieldPlacementHint({ dentroDeFormulario: true, quiz: true });
  assert.match(noQuiz, /tela/i);
});

test('o inspetor mostra a explicação do campo', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /fieldPlacementHint/);
});
