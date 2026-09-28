// O aviso de privacidade volta ao formulário: morava no formulário do editor antigo e o do
// editor novo nasceu sem ele. Com pixels e conversões ligados, quem deixa o contato precisa
// saber para que ele serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVISO_DE_PRIVACIDADE, renderNode } from '../public/page-schema.js';
import { documentoDaPagina, estadoDoQuiz, normalizarEstadoAlva } from '../public/pagina-alva.js';

const formulario = (props = {}) => renderNode({ id: '11111111-1111-4111-8111-111111111111', type: 'form', props: { submitLabel: 'Enviar', ...props }, children: [] });

test('todo formulário nasce com o aviso, abaixo do botão', () => {
  assert.match(formulario(), new RegExp(`</button><p class="alva-aviso-privacidade">${AVISO_DE_PRIVACIDADE}</p></form>`));
});

test('com o link da política, o aviso aponta para ela; link que não é https não entra', () => {
  assert.match(formulario({ politica: 'https://cliente.com.br/privacidade' }), /<a href="https:\/\/cliente\.com\.br\/privacidade" target="_blank" rel="noopener noreferrer">Política de privacidade<\/a>/);
  assert.doesNotMatch(formulario({ politica: 'javascript:alert(1)' }), /<a /);
});

test('apagar o texto tira o aviso; texto próprio substitui o padrão', () => {
  assert.doesNotMatch(formulario({ aviso: '' }), /alva-aviso-privacidade/);
  assert.match(formulario({ aviso: 'Seus dados ficam com a Clínica X.' }), /Seus dados ficam com a Clínica X\./);
});

test('o quiz novo traz o aviso na etapa de contato', () => {
  const html = documentoDaPagina(normalizarEstadoAlva(estadoDoQuiz('Quiz')));
  assert.ok(html.includes(AVISO_DE_PRIVACIDADE));
});
