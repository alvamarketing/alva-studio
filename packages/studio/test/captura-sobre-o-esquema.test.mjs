import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairCapturas } from '../public/page-schema.js';

// Descobrir os campos de um formulário era um caminhador escrito contra a forma de nó do
// GrapesJS: procurava `<input>` dentro de `tagName`/`components`/`attributes`. Com o
// esquema do Alva, um campo é um nó de tipo `field` — a descoberta vira uma caminhada, e
// deixa de depender de qual editor produziu a árvore.
const pagina = [
  { type: 'section', children: [
    { type: 'heading', props: { text: 'Fale com a gente' } },
    { id: 'f1', type: 'form', props: { submitLabel: 'Quero falar' }, children: [
      { type: 'field', props: { label: 'Nome', name: 'nome', fieldType: 'text', required: true } },
      { type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true } },
      { type: 'field', props: { label: 'Quando', name: 'quando', fieldType: 'date' } },
    ] },
  ] },
];

test('cada formulário da página vira uma captura, com seus campos', () => {
  const capturas = extrairCapturas(pagina);
  assert.equal(capturas.length, 1);
  assert.equal(capturas[0].id, 'f1');
  assert.deepEqual(capturas[0].fields.map((campo) => [campo.name, campo.type, campo.required]), [
    ['nome', 'text', true], ['email', 'email', true], ['quando', 'date', false],
  ]);
});

test('o nome do formulário vem do título mais próximo acima dele', () => {
  assert.equal(extrairCapturas(pagina)[0].name, 'Fale com a gente');
});

test('página sem formulário não produz captura, e isso não é erro', () => {
  assert.deepEqual(extrairCapturas([{ type: 'text', props: { text: 'só conteúdo' } }]), []);
});

// Dois formulários na mesma página precisam ser distinguíveis, senão as respostas de um
// chegam marcadas como do outro.
test('dois formulários viram duas capturas distintas', () => {
  const capturas = extrairCapturas([
    { id: 'a', type: 'form', children: [{ type: 'field', props: { label: 'A', name: 'a', fieldType: 'text' } }] },
    { id: 'b', type: 'form', children: [{ type: 'field', props: { label: 'B', name: 'b', fieldType: 'text' } }] },
  ]);
  assert.deepEqual(capturas.map((captura) => captura.id), ['a', 'b']);
});

test('formulário sem identificador é recusado: resposta sem endereço não tem para onde ir', () => {
  assert.throws(() => extrairCapturas([{ type: 'form', children: [] }]), /identificador/i);
});

// Um campo fora de formulário não é captura — é decoração, e cobrá-lo como resposta seria
// o mesmo defeito do elemento decorativo obrigatório no quiz.
test('campo solto fora de formulário não vira captura', () => {
  assert.deepEqual(extrairCapturas([{ type: 'field', props: { label: 'Solto', name: 'solto', fieldType: 'text' } }]), []);
});
