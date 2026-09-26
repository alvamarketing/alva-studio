import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingRuntimeEnvironment, readRuntimeFlags, requiredTrackingEngines } from '../server/runtime-flags.mjs';

test('flags de runtime exigem opt-in literal e permanecem desligadas por padrão', () => {
  assert.deepEqual(readRuntimeFlags({}), {
    conversions: false,
    pixels: false,
    mediaPipeline: false,
    billingEnforcement: false,
  });
  assert.deepEqual(readRuntimeFlags({
    CONVERSIONS_ENABLED: '1',
    PIXELS_ENABLED: 'yes',
    MEDIA_PIPELINE_ENABLED: ' false ',
    BILLING_ENFORCEMENT: 'enabled',
  }), {
    conversions: false,
    pixels: false,
    mediaPipeline: false,
    billingEnforcement: false,
  });
  assert.deepEqual(readRuntimeFlags({
    CONVERSIONS_ENABLED: 'true',
    PIXELS_ENABLED: 'true',
    MEDIA_PIPELINE_ENABLED: 'true',
    BILLING_ENFORCEMENT: 'true',
  }), {
    conversions: true,
    pixels: true,
    mediaPipeline: true,
    billingEnforcement: true,
  });
});

test('motores obrigatórios de rastreamento seguem exatamente as flags ativas', () => {
  for (const [environment, expected] of [
    [{}, []],
    [{ CONVERSIONS_ENABLED: 'true' }, ['conversions']],
  ]) assert.deepEqual(requiredTrackingEngines(readRuntimeFlags(environment)), expected);
});

test('cobrança usa sandbox por padrão e exige produção explícita', () => {
  assert.equal(billingRuntimeEnvironment({}), 'sandbox');
  assert.equal(billingRuntimeEnvironment({ ASAAS_ENVIRONMENT: 'production' }), 'production');
  assert.equal(billingRuntimeEnvironment({ ASAAS_ENVIRONMENT: 'PRODUCTION' }), 'sandbox');
});
