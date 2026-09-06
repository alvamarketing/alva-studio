import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRuntimeFlags, requiredTrackingEngines } from '../server/runtime-flags.mjs';

test('flags de runtime exigem opt-in literal e permanecem desligadas por padrão', () => {
  assert.deepEqual(readRuntimeFlags({}), {
    umamiRuntime: false,
    nvsRuntime: false,
    pixels: false,
    mediaPipeline: false,
    billingEnforcement: false,
  });
  assert.deepEqual(readRuntimeFlags({
    UMAMI_RUNTIME_ENABLED: 'TRUE',
    NVS_RUNTIME_ENABLED: '1',
    PIXELS_ENABLED: 'yes',
    MEDIA_PIPELINE_ENABLED: ' false ',
    BILLING_ENFORCEMENT: 'enabled',
  }), {
    umamiRuntime: false,
    nvsRuntime: false,
    pixels: false,
    mediaPipeline: false,
    billingEnforcement: false,
  });
  assert.deepEqual(readRuntimeFlags({
    UMAMI_RUNTIME_ENABLED: 'true',
    NVS_RUNTIME_ENABLED: 'true',
    PIXELS_ENABLED: 'true',
    MEDIA_PIPELINE_ENABLED: 'true',
    BILLING_ENFORCEMENT: 'true',
  }), {
    umamiRuntime: true,
    nvsRuntime: true,
    pixels: true,
    mediaPipeline: true,
    billingEnforcement: true,
  });
});

test('motores obrigatórios de rastreamento seguem exatamente as flags ativas', () => {
  for (const [environment, expected] of [
    [{}, []],
    [{ UMAMI_RUNTIME_ENABLED: 'true' }, ['umami']],
    [{ NVS_RUNTIME_ENABLED: 'true' }, ['nvs']],
    [{ UMAMI_RUNTIME_ENABLED: 'true', NVS_RUNTIME_ENABLED: 'true' }, ['umami', 'nvs']],
  ]) assert.deepEqual(requiredTrackingEngines(readRuntimeFlags(environment)), expected);
});
