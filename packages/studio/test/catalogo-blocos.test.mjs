import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, blockDescriptions } from '../public/templates.js';
import { catalogo } from '../public/catalogo-elementos.js';

const porId = new Map(blocks.map(([id, rotulo, grupo, conteudo]) => [id, { rotulo, grupo, conteudo }]));

test('todo elemento do catálogo vira bloco do editor certo — e só dele', () => {
  // A partir da Tarefa 5, o catálogo também carrega elementos que só existem no canvas
  // do quiz (registro: 'quiz'): esses viram bloco em quizBlocks, dentro de
  // editor-shell.js, não neste `blocks` de página — arrastar "Escala" para uma landing
  // page não faz sentido. `registro` é campo obrigatório (ver catalogo-elementos.test.mjs),
  // então a prova é nos dois sentidos por construção, não por convenção de nome: uma
  // entrada com registro: 'pagina' tem que estar em `blocks`; uma com registro: 'quiz'
  // tem que NÃO estar. Assim nenhuma entrada do catálogo fica de fora de alguma
  // afirmação — o problema do prefixo de id, que uma entrada mal nomeada escapava sem
  // que nada acusasse, deixa de existir.
  for (const elemento of catalogo) {
    const bloco = porId.get(elemento.id);
    if (elemento.registro === 'pagina') {
      assert.ok(bloco, `o bloco ${elemento.id} sumiu do catálogo do editor`);
      assert.equal(bloco.rotulo, elemento.nome);
      assert.equal(bloco.grupo, elemento.grupo);
      assert.equal(bloco.conteudo, elemento.render());
    } else {
      assert.equal(bloco, undefined, `${elemento.id} tem registro: 'quiz' mas apareceu em blocks, o bloco geral de página`);
    }
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
