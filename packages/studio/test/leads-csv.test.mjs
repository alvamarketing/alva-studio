import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLeadsCsv } from '../server/leads-csv.mjs';

test('renderLeadsCsv mantém cabeçalhos estáveis e protege células perigosas', () => {
  const csv = renderLeadsCsv({
    formName: 'Diagnóstico',
    fields: [
      { id: 'nome', title: 'Nome' },
      { id: 'comentario', title: 'Comentário' },
      { id: 'interesses', title: 'Interesses' },
    ],
    submissions: [{
      submittedAt: '2026-09-05T12:00:00.000Z',
      formName: 'Diagnóstico',
      answers: {
        nome: '=IMPORTXML(A1)',
        comentario: 'linha 1\n"linha 2"',
        interesses: ['Sites', '+Tráfego'],
        antigo: '@histórico',
      },
    }],
  });

  assert.equal(csv,
    '\uFEFFRecebida em,Formulário,Nome,Comentário,Interesses,antigo\r\n'
    + "2026-09-05T12:00:00.000Z,Diagnóstico,'=IMPORTXML(A1),\"linha 1\n\"\"linha 2\"\"\",Sites; +Tráfego,'@histórico\r\n");
});
