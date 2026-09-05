import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedPublicationOrigin } from '../server/publication-cors.mjs';

test('CORS aceita apenas domínio verificado ou deployment do próprio projeto', () => {
  const origins = ['https://lp.alva.test', 'https://preview-prj.vercel.app'];
  assert.equal(allowedPublicationOrigin('https://lp.alva.test', origins), true);
  assert.equal(allowedPublicationOrigin('https://preview-prj.vercel.app', origins), true);
  assert.equal(allowedPublicationOrigin('https://outro-tenant.vercel.app', origins), false);
  assert.equal(allowedPublicationOrigin('https://lp.alva.test/path', origins), false);
});
