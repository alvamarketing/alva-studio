import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLICOS, publicoPorChave, regraDoPublico, RETENCAO_MAXIMA_DIAS } from '../server/meta-publicos.mjs';
import { createRuntimeLoader } from '../server/publication-runtime.mjs';
import { nomeNaPlataforma } from '../server/nomes-de-evento.mjs';

const PIXEL = '123456789012345';

test('o catálogo cobre os públicos pedidos e tem chaves únicas', () => {
  const chaves = PUBLICOS.map((p) => p.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  for (const esperado of ['vsl_50', 'vsl_completa', 'vsl_cta', 'lead']) assert.ok(chaves.includes(esperado), esperado);
  for (const publico of PUBLICOS) {
    assert.match(publico.nome, /\S/);
    assert.match(publico.descricao, /\S/);
    assert.ok(Number.isInteger(publico.retencaoDias) && publico.retencaoDias >= 1 && publico.retencaoDias <= RETENCAO_MAXIMA_DIAS, `${publico.chave}: retenção`);
    assert.ok(['remarketing', 'exclusao'].includes(publico.uso));
  }
});

// A Meta só monta público com o que o pixel recebeu. Um público de um evento que o Studio
// nunca dispara ficaria vazio para sempre e o dono acharia que o remarketing está rodando.
test('todo evento do catálogo é um evento que o pixel da Meta realmente recebe hoje', () => {
  const carregador = createRuntimeLoader({
    publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.exemplo.test', domain: 'lp.exemplo.test',
    environment: 'production', providers: [{ provider: 'meta', id: PIXEL }],
  });
  const nomeDoLead = nomeNaPlataforma('meta', 'lead');
  for (const publico of PUBLICOS) {
    if (publico.evento === nomeDoLead) {
      assert.ok(carregador.includes(`"lead":"${nomeDoLead}"`), 'o lead sai do navegador com o nome padrão');
      continue;
    }
    assert.ok(carregador.includes(`'${publico.evento}'`), `${publico.chave}: ${publico.evento} não é disparado pelo carregador do pixel`);
  }
});

test('a regra no formato da Meta: evento, fonte pixel e retenção em segundos', () => {
  const regra = regraDoPublico(publicoPorChave('vsl_completa'), PIXEL);
  assert.deepEqual(regra, {
    inclusions: {
      operator: 'or',
      rules: [{
        event_sources: [{ id: PIXEL, type: 'pixel' }],
        retention_seconds: 30 * 86400,
        filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'vsl_complete' }] },
      }],
    },
  });
});

test('o marco da VSL filtra pelo parâmetro value, no formato aninhado da documentação', () => {
  const regra = regraDoPublico(publicoPorChave('vsl_50'), PIXEL);
  assert.deepEqual(regra.inclusions.rules[0].filter, {
    operator: 'and',
    filters: [
      { field: 'event', operator: 'eq', value: 'vsl_progress' },
      { operator: 'or', filters: [{ field: 'value', operator: '>=', value: '50' }] },
    ],
  });
});

test('o lead usa o nome padrão da Meta e a janela mais longa permitida', () => {
  const publico = publicoPorChave('lead');
  assert.equal(publico.evento, 'Lead');
  assert.equal(publico.uso, 'exclusao');
  assert.equal(publico.retencaoDias, RETENCAO_MAXIMA_DIAS);
});

test('pixel inválido ou público desconhecido são recusados antes de qualquer chamada', () => {
  assert.throws(() => regraDoPublico(publicoPorChave('lead'), 'abc'), /pixel/i);
  assert.equal(publicoPorChave('inventado'), null);
});

test('o catálogo é imutável', () => {
  assert.throws(() => { PUBLICOS[0].nome = 'x'; }, TypeError);
  assert.throws(() => PUBLICOS.push({}), TypeError);
});
