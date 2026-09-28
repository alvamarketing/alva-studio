// A ponte entre o esquema do Alva e o Puck: ida e volta sem perder nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';
import { normalizarEstadoAlva } from '../public/pagina-alva.js';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const estado = normalizarEstadoAlva({
  formato: 'alva/1', root: { title: 'Oferta' },
  content: [{ id: 'secao-1', type: 'section', props: {}, children: [
    { id: 'titulo-1', type: 'heading', props: { text: 'Olá', level: 1 } },
    { id: ID, type: 'form', props: { submitLabel: 'Enviar' }, children: [
      { id: 'campo-1', type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true } },
    ] },
  ] }],
});

test('ida e volta devolve o mesmo esquema', () => {
  assert.deepEqual(normalizarEstadoAlva(puckParaAlva(alvaParaPuck(estado))), estado);
});

test('no Puck, os filhos moram no slot e o formulário leva o id da captura', () => {
  const dados = alvaParaPuck(estado);
  assert.equal(dados.root.props.title, 'Oferta');
  const formulario = dados.content[0].props.itens[1];
  assert.equal(formulario.props.captureId, ID);
  assert.equal(formulario.props.itens[0].props.name, 'email');
});

test('o id que o Puck dá ao formulário não vira id da captura', () => {
  const dados = alvaParaPuck(estado);
  dados.content[0].props.itens[1].props.id = 'form-gerado-pelo-puck';
  assert.equal(puckParaAlva(dados).content[0].children[1].id, ID);
});
