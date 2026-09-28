import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFormAnswers } from '../server/form-answer-validation.mjs';

// O servidor refaz o caminho do quiz a partir das respostas: só cobra a etapa que a
// pessoa de fato visitou e recusa resposta para uma etapa que a ramificação pulou.
const quiz = () => ({
  steps: [
    { id: 'entrada', title: 'Entrada', elements: [{ id: 'perfil', type: 'single_choice', title: 'Perfil', required: true, options: ['Oferta', 'Outro'] }], branching: { rules: [{ fieldId: 'perfil', operator: 'equals', value: 'Oferta', nextScreenId: 'oferta' }] } },
    { id: 'desvio', title: 'Desvio', elements: [{ id: 'nota', type: 'number', title: 'Nota', required: true }] },
    { id: 'oferta', title: 'Oferta', elements: [{ id: 'aviso', type: 'text', title: 'Resultado' }] },
  ],
});

test('valida somente a rota recalculada e rejeita resposta forjada de tela pulada', () => {
  assert.deepEqual(validateFormAnswers(quiz(), { answers: { perfil: 'Oferta' } }), { perfil: 'Oferta', aviso: '' });
  assert.throws(() => validateFormAnswers(quiz(), { answers: { perfil: 'Oferta', nota: '10' } }), /não visitada/);
  assert.throws(() => validateFormAnswers(quiz(), { answers: { perfil: 'Falso' } }), /Escolha uma resposta válida/);
  assert.throws(() => validateFormAnswers(quiz(), { answers: { perfil: 'Outro' } }), /Nota/);
  assert.deepEqual(validateFormAnswers(quiz(), { answers: { perfil: 'Outro', nota: '7' } }), { perfil: 'Outro', nota: '7', aviso: '' });
});
