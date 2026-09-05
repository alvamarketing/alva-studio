import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITIES,
  ROLES,
  capabilitiesFor,
  hasCapability,
  normalizeProjectSlug,
  normalizeRoute,
} from '../server/domain/access.mjs';

test('editor escreve conteúdo atribuído mas não publica', () => {
  assert.equal(hasCapability('editor', 'page.write'), true);
  assert.equal(hasCapability('editor', 'deployment.publish'), false);
});

test('expõe papéis e capacidades imutáveis', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'editor', 'analyst']);
  assert.equal(Object.isFrozen(ROLES), true);
  assert.equal(Object.isFrozen(CAPABILITIES), true);
  assert.equal(Object.isFrozen(CAPABILITIES.owner), true);
  assert.deepEqual(capabilitiesFor('analyst'), ['submission.read', 'analytics.read']);
  assert.deepEqual(capabilitiesFor('unknown'), []);
});

test('normaliza slugs com Unicode e hífens', () => {
  assert.equal(normalizeProjectSlug('  Imobiliárias & Lançamentos  '), 'imobiliarias-lancamentos');
  assert.equal(normalizeProjectSlug('São José___Centro'), 'sao-jose-centro');
  assert.throws(() => normalizeProjectSlug(''), /slug/i);
});

test('rejeita slugs ausentes, não textuais ou em branco', () => {
  for (const value of [undefined, null, 123, {}, [], '   ']) {
    assert.throws(() => normalizeProjectSlug(value), /slug/i);
  }
});

test('normaliza rotas e rejeita caminhos reservados', () => {
  assert.equal(normalizeRoute(' Imobiliárias/ '), '/imobiliarias');
  assert.equal(normalizeRoute('/'), '/');
  assert.throws(() => normalizeRoute('/api/leads'), /reservada/);
});

test('rejeita rotas ausentes, não textuais ou em branco', () => {
  for (const value of [undefined, null, 123, {}, [], '   ']) {
    assert.throws(() => normalizeRoute(value), /rota/i);
  }
});

test('rejeita segmentos inválidos e rotas longas', () => {
  assert.throws(() => normalizeRoute('/foo//bar'), /segmentos vazios/);
  assert.throws(() => normalizeRoute('/foo/./bar'), /reservado/);
  assert.throws(() => normalizeRoute('/foo/../bar'), /reservado/);
  assert.throws(() => normalizeRoute('/foo_bar'), /permitidos/);
  assert.throws(() => normalizeRoute(`/${'a'.repeat(120)}`), /120/);
});
