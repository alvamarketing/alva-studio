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
import { vslCapabilityPolicy } from '../public/studio-shell.js';

test('editor escreve conteúdo atribuído mas não publica', () => {
  assert.equal(hasCapability('editor', 'page.write'), true);
  assert.equal(hasCapability('editor', 'video.read'), true);
  assert.equal(hasCapability('editor', 'video.write'), true);
  assert.equal(hasCapability('editor', 'deployment.publish'), false);
});

test('analyst lê VSL e viewer não acessa a superfície', () => {
  assert.equal(hasCapability('analyst', 'video.read'), true);
  assert.equal(hasCapability('analyst', 'video.write'), false);
  assert.equal(hasCapability('analyst', 'deployment.publish'), false);
  assert.equal(hasCapability('viewer', 'video.read'), false);
  assert.equal(hasCapability('viewer', 'video.write'), false);
});

test('analytics.read chega a proprietário, administrador e editor sem tirar capacidade existente', () => {
  assert.equal(hasCapability('owner', 'analytics.read'), true);
  assert.equal(hasCapability('admin', 'analytics.read'), true);
  assert.equal(hasCapability('editor', 'analytics.read'), true);
  assert.equal(hasCapability('analyst', 'analytics.read'), true);
  assert.equal(hasCapability('owner', 'billing.manage'), true);
  assert.equal(hasCapability('admin', 'member.manage'), true);
  assert.equal(hasCapability('editor', 'video.write'), true);
  assert.equal(hasCapability('editor', 'deployment.publish'), false);
  assert.equal(hasCapability('analyst', 'video.write'), false);
});

test('expõe papéis e capacidades imutáveis', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'editor', 'analyst']);
  assert.equal(Object.isFrozen(ROLES), true);
  assert.equal(Object.isFrozen(CAPABILITIES), true);
  assert.equal(Object.isFrozen(CAPABILITIES.owner), true);
  assert.deepEqual(capabilitiesFor('analyst'), ['submission.read', 'analytics.read', 'video.read']);
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

test('separa leitura, edição do conteúdo consumidor e CRUD da VSL', () => {
  assert.deepEqual(vslCapabilityPolicy({
    can: (capability) => capability === 'video.write',
    consumer: 'page',
  }), {
    canList: false,
    canSelect: false,
    canEditConsumer: false,
    canManageVideo: true,
    canPublish: false,
  });
  assert.deepEqual(vslCapabilityPolicy({
    can: (capability) => ['video.read', 'page.write'].includes(capability),
    consumer: 'page',
  }), {
    canList: true,
    canSelect: true,
    canEditConsumer: true,
    canManageVideo: false,
    canPublish: false,
  });
});
