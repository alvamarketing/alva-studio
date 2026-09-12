import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';
import { catalogo } from '../public/catalogo-elementos.js';

const porId = new Map(blocks.map(([id, rotulo, grupo, conteudo]) => [id, { rotulo, grupo, conteudo }]));

test('todo elemento do catálogo vira bloco do editor', () => {
  for (const elemento of catalogo) {
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
