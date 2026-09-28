// Os modelos do editor novo: todo modelo publica e captura lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDoModelo, modelosAlva } from '../public/modelos-alva.js';
import { capturasDoEstado, documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';

for (const modelo of modelosAlva) {
  test(`modelo ${modelo.name}: desenha e já nasce com formulário`, () => {
    const estado = normalizarEstadoAlva(estadoDoModelo(modelo.id, 'Teste'));
    assert.match(documentoDaPagina(estado), /<form class="alva-form"/);
    assert.ok(capturasDoEstado(estado).forms[0].fields.some((campo) => campo.id === 'email'));
  });
}

test('seção com fundo e três colunas saem com as classes que têm regra na folha', async () => {
  const { elementosCss } = await import('../public/catalogo-elementos.js');
  const html = documentoDaPagina(normalizarEstadoAlva(estadoDoModelo('captura')));
  for (const classe of ['alva-secao-escura', 'alva-colunas-3']) {
    assert.match(html, new RegExp(`class="[^"]*${classe}`));
    assert.match(elementosCss, new RegExp(`\\.${classe}\\{`));
  }
});
