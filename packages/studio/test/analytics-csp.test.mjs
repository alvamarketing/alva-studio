import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNonce, formContentSecurityPolicy } from '../server/content-security-policy.mjs';

function basePolicy(overrides = {}) {
  return formContentSecurityPolicy({
    nonce: createNonce(),
    studioOrigin: 'https://studio.example.test',
    actionOrigin: 'https://studio.example.test/api/public/forms/x/submissions',
    ...overrides,
  });
}

test('nunca emite unsafe-inline em script-src', () => {
  const policy = basePolicy();
  const scriptSrc = policy.split('; ').find((directive) => directive.startsWith('script-src'));
  assert.ok(scriptSrc);
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
});

test('nonce é diferente a cada chamada', () => {
  assert.notEqual(createNonce(), createNonce());
});

test('pixelDomains vazio não deixa vírgula, espaço duplo nem diretiva órfã', () => {
  const policy = basePolicy({ pixelDomains: [] });
  assert.doesNotMatch(policy, /,/);
  assert.doesNotMatch(policy, /  /);
  assert.doesNotMatch(policy, /;\s*;/);
  assert.doesNotMatch(policy, /-src\s*;/);
});

test('domínio de pixel só aparece quando passado', () => {
  const withoutPixel = basePolicy();
  assert.doesNotMatch(withoutPixel, /ads\.example\.com/);
  const withPixel = basePolicy({ pixelDomains: ['https://ads.example.com'] });
  assert.match(withPixel, /ads\.example\.com/);
});

test('modo reportOnly muda apenas o nome do cabeçalho, não a política', () => {
  const nonce = createNonce();
  const enforced = formContentSecurityPolicy({
    nonce,
    studioOrigin: 'https://studio.example.test',
    actionOrigin: 'https://studio.example.test/api/public/forms/x/submissions',
    reportOnly: false,
  });
  const reportOnly = formContentSecurityPolicy({
    nonce,
    studioOrigin: 'https://studio.example.test',
    actionOrigin: 'https://studio.example.test/api/public/forms/x/submissions',
    reportOnly: true,
  });
  assert.equal(enforced, reportOnly);
});
