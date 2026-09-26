import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractPageCaptureSchema, normalizePageCaptureIds } from '../server/page-capture-schema.mjs';
import { TIPOS_SEM_RESPOSTA } from '../public/quiz-elements.js';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';

function campo(type) {
  // O identificador estável da captura é atribuído por `normalizePageCaptureIds`, como
  // acontece a cada gravação da página — o fixture passa pelo mesmo caminho.
  return normalizePageCaptureIds({ pages: [{ frames: [{ component: { tagName: 'body', components: [
    { tagName: 'form', components: [
      { tagName: 'label', components: [
        { type: 'textnode', content: 'Quando' },
        { tagName: 'input', attributes: { type, name: 'quando', required: true } },
      ] },
      { tagName: 'button', attributes: { type: 'submit' }, components: [{ type: 'textnode', content: 'Enviar' }] },
    ] },
  ] } }] }] }, () => '11111111-1111-4111-8111-111111111111');
}

// O inspetor de campo oferece sete tipos de resposta. A captação de uma landing aceitava
// cinco deles, e a divergência só aparecia no botão Publicar — depois de a pessoa ter
// montado a página inteira, com uma mensagem que não diz qual campo nem o que fazer.
test('todo tipo que o editor oferece é aceito na captação de uma landing', async () => {
  const shell = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const oferecidos = Object.keys(JSON.parse(
    `{${shell.match(/const TIPOS_DE_CAMPO = \{([^}]+)\}/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')}}`,
  ));
  assert.ok(oferecidos.length >= 6, `esperava a lista do inspetor, veio ${oferecidos}`);
  for (const tipo of oferecidos) {
    if (tipo === 'textarea') continue; // textarea é tag, não type de input
    assert.doesNotThrow(() => extractPageCaptureSchema(campo(tipo)), `tipo ${tipo} recusado na captação`);
  }
});

// Um elemento decorativo marcado como obrigatório tornava o quiz impossível de enviar: a
// tela publicada não desenha campo nenhum para ele, e o servidor exigia resposta de algo
// que a pessoa não tem como preencher nem enxergar.
test('elemento sem campo de resposta nunca é cobrado como pergunta', () => {
  for (const tipo of ['title', 'heading', 'text', 'paragraph', 'statement']) {
    assert.ok(TIPOS_SEM_RESPOSTA.has(tipo), `${tipo} desenha só decoração e precisa estar na lista`);
    const schema = { steps: [{ id: 'd1', type: tipo, title: 'Uma frase', required: true }, { id: 'nome', type: 'short_text', title: 'Nome', required: true }] };
    assert.doesNotThrow(() => validateFormAnswers(schema, { answers: { nome: 'Pessoa' } }), `${tipo} obrigatório travou o envio`);
  }
});

test('o que tem campo de resposta continua sendo cobrado', () => {
  const schema = { steps: [{ id: 'nome', type: 'short_text', title: 'Nome', required: true }] };
  assert.throws(() => validateFormAnswers(schema, { answers: {} }), /Responda/);
});
