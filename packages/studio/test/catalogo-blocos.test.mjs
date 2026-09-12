import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';
import { catalogo } from '../public/catalogo-elementos.js';

const porId = new Map(blocks.map(([id, rotulo, grupo, conteudo]) => [id, { rotulo, grupo, conteudo }]));

test('todo elemento do catálogo vira bloco do editor', () => {
  // A partir da Tarefa 5, o catálogo também carrega elementos que só existem no
  // canvas do quiz (id com prefixo "quiz-", exceto os de escolha, que nem vêm do
  // catálogo): esses viram bloco em quizBlocks, dentro de editor-shell.js, não neste
  // `blocks` de página — arrastar "Escala" para uma landing page não faz sentido.
  // Esta prova continua cobrindo todo elemento pensado para a página geral.
  for (const elemento of catalogo) {
    if (elemento.id.startsWith('quiz-')) continue;
    const bloco = porId.get(elemento.id);
    assert.ok(bloco, `o bloco ${elemento.id} sumiu do catálogo do editor`);
    assert.equal(bloco.rotulo, elemento.nome);
    assert.equal(bloco.grupo, elemento.grupo);
    assert.equal(bloco.conteudo, elemento.render());
  }
});

test('os blocos que ainda não migraram continuam de pé', () => {
  for (const id of ['columns', 'image', 'vsl', 'form', 'input']) {
    assert.ok(porId.get(id), `o bloco ${id} desapareceu`);
  }
});

test('todo bloco tem descrição', () => {
  for (const [id] of blocks) assert.ok(blockDescriptions[id], `falta descrição de ${id}`);
});
