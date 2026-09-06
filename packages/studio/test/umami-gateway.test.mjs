import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUmamiGatewayPayload } from '../server/umami-gateway.mjs';

test('gateway troca somente o token público pelo website interno e descarta identificadores enviados pelo navegador', () => {
  const result = normalizeUmamiGatewayPayload({
    type: 'event',
    payload: {
      website: 'token-publico-opaco',
      hostname: 'pagina.example.test',
      url: 'https://pagina.example.test/oferta?utm_source=meta',
      referrer: '',
      screen: '1440x900',
      language: 'pt-BR',
      name: 'form_start',
      data: { formId: 'form-123' },
      companyId: 'empresa-maliciosa',
      projectId: 'projeto-malicioso',
    },
  }, { publicToken: 'token-publico-opaco', remoteWebsiteId: '0d8a9f7e-2aa4-4d0f-aef7-bd850453ccb6' });

  assert.deepEqual(result, {
    type: 'event',
    payload: {
      website: '0d8a9f7e-2aa4-4d0f-aef7-bd850453ccb6',
      hostname: 'pagina.example.test',
      url: 'https://pagina.example.test/oferta?utm_source=meta',
      referrer: '',
      screen: '1440x900',
      language: 'pt-BR',
      name: 'form_start',
      data: { formId: 'form-123' },
    },
  });
});

test('gateway recusa token divergente, PII e eventos fora da allowlist antes de falar com o Umami', () => {
  const remote = { publicToken: 'token-publico-opaco', remoteWebsiteId: '0d8a9f7e-2aa4-4d0f-aef7-bd850453ccb6' };
  for (const payload of [
    { type: 'event', payload: { website: 'outro-token', hostname: 'pagina.example.test', url: 'https://pagina.example.test/' } },
    { type: 'event', payload: { website: remote.publicToken, hostname: 'pagina.example.test', url: 'https://pagina.example.test/?email=ana%40example.test' } },
    { type: 'event', payload: { website: remote.publicToken, hostname: 'pagina.example.test', url: 'https://pagina.example.test/', name: 'lead' } },
  ]) {
    assert.throws(() => normalizeUmamiGatewayPayload(payload, remote), (error) => error.status === 400);
  }
});

test('gateway recusa PII aninhada, arrays e telefone numérico', () => {
  const base = { website: 'token-publico-opaco', hostname: 'pagina.example.test', url: 'https://pagina.example.test/', name: 'form_start' };
  for (const data of [{ value: { email: 'pessoa@example.test' } }, { value: ['telefone', '5511999999999'] }, { value: 5511999999999 }]) {
    assert.throws(() => normalizeUmamiGatewayPayload({ type: 'event', payload: { ...base, data } }, { publicToken: base.website, remoteWebsiteId: '0d8a9f7e-2aa4-4d0f-aef7-bd850453ccb6' }), /data inválido/);
  }
});
