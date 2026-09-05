import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedPublicationOrigin, customDomainOriginAllowed, publicSubmissionCors } from '../server/publication-cors.mjs';

test('CORS aceita apenas domínio verificado ou deployment do próprio projeto', () => {
  const origins = ['https://lp.alva.test', 'https://preview-prj.vercel.app'];
  assert.equal(allowedPublicationOrigin('https://lp.alva.test', origins), true);
  assert.equal(allowedPublicationOrigin('https://preview-prj.vercel.app', origins), true);
  assert.equal(allowedPublicationOrigin('https://outro-tenant.vercel.app', origins), false);
  assert.equal(allowedPublicationOrigin('https://lp.alva.test/path', origins), false);
});

test('submissão pública aceita same-origin e POST server-side sem Origin', () => {
  assert.deepEqual(publicSubmissionCors({ method: 'POST', origin: 'https://studio.alva.test', expectedOrigin: 'https://studio.alva.test', allowedOrigins: [] }), {
    allowed: true, corsOrigin: null,
  });
  assert.deepEqual(publicSubmissionCors({ method: 'POST', origin: '', expectedOrigin: 'https://studio.alva.test', allowedOrigins: [] }), {
    allowed: true, corsOrigin: null,
  });
});

test('OPTIONS cross-origin exige origem autorizada', () => {
  assert.equal(publicSubmissionCors({ method: 'OPTIONS', origin: '', expectedOrigin: 'https://studio.alva.test', allowedOrigins: ['https://preview.example.test'] }).allowed, false);
  assert.deepEqual(publicSubmissionCors({ method: 'OPTIONS', origin: 'https://preview.example.test', expectedOrigin: 'https://studio.alva.test', allowedOrigins: ['https://preview.example.test'] }), {
    allowed: true, corsOrigin: 'https://preview.example.test',
  });
});

test('domínio customizado aceita ausência ou a própria origem e rejeita origem externa', () => {
  assert.equal(customDomainOriginAllowed('', 'lp.example.test'), true);
  assert.equal(customDomainOriginAllowed('https://lp.example.test', 'lp.example.test'), true);
  assert.equal(customDomainOriginAllowed('https://outro.example.test', 'lp.example.test'), false);
});
