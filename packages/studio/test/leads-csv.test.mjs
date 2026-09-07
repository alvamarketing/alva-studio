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

test('renderLeadsCsv não atribui o rótulo atual a campo histórico renomeado', () => {
  const csv = renderLeadsCsv({
    submissions: [
      { sourceVersionId: 'versao-a', formName: 'Contato', submittedAt: '2026-09-01T00:00:00.000Z', fields: [{ id: 'email', title: 'E-mail pessoal' }], answers: { email: 'ana@exemplo.test' } },
      { sourceVersionId: 'versao-b', formName: 'Contato', submittedAt: '2026-09-02T00:00:00.000Z', fields: [{ id: 'email', title: 'E-mail corporativo' }], answers: { email: 'ana@empresa.test' } },
    ],
  });
  assert.match(csv, /E-mail pessoal,E-mail corporativo/);
  assert.match(csv, /ana@exemplo\.test,\r\n/);
  assert.match(csv, /,ana@empresa\.test\r\n/);
});

test('renderLeadsCsv identifica captura de página e não confunde metadados com campos', () => {
  const csv = renderLeadsCsv({
    submissions: [
      { sourceKind: 'page', sourceName: 'LP do diagnóstico', captureName: 'Contato', submittedAt: '2026-09-01T00:00:00.000Z', fields: [{ id: 'submittedAt', title: 'Quando preferir' }], answers: { submittedAt: 'à tarde' } },
      { sourceKind: 'page', sourceName: 'LP do diagnóstico', captureName: 'Orçamento', submittedAt: '2026-09-02T00:00:00.000Z', fields: [{ id: 'submittedAt', title: 'Quando preferir' }], answers: { submittedAt: 'amanhã' } },
    ],
  });
  assert.match(csv, /Recebida em,Formulário,Captura,Quando preferir/);
  assert.match(csv, /2026-09-01T00:00:00.000Z,LP do diagnóstico,Contato,à tarde/);
  assert.match(csv, /2026-09-02T00:00:00.000Z,LP do diagnóstico,Orçamento,amanhã/);
});
