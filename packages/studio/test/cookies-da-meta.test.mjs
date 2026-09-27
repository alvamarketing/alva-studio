// Os cookies que o pixel da Meta grava, lidos no envio.
//
// A Meta documenta: com o pixel na página, o `fbc` certo é o do cookie `_fbc`, que o
// próprio pixel grava; montar à mão (fb.<índice>.<ms>.<fbclid>) é para quando não há
// pixel. E o `_fbp` só existe depois que o pixel carrega — o que, com consentimento, é
// depois do primeiro carregamento da página. Por isso os dois são lidos no envio, do
// cookie que o gateway repassa.
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesDaMeta } from '../server/runtime-gateway-security.mjs';

test('lê _fbp e _fbc no formato da Meta', () => {
  assert.deepEqual(cookiesDaMeta('a=1; _fbp=fb.1.1727400000000.1234567890; _fbc=fb.1.1727400000123.IwAR2F4-dbP0l7Mn1IawQQ; b=2'), {
    fbp: 'fb.1.1727400000000.1234567890',
    fbc: 'fb.1.1727400000123.IwAR2F4-dbP0l7Mn1IawQQ',
  });
  // A biblioteca de parâmetros da Meta acrescenta um apêndice ao fbc; o formato continua.
  assert.equal(cookiesDaMeta('_fbc=fb.2.1727400000123.IwAR2F4.AbCd').fbc, 'fb.2.1727400000123.IwAR2F4.AbCd');
});

test('cookie fora do formato é ignorado', () => {
  assert.deepEqual(cookiesDaMeta('_fbp=qualquer; _fbc=fb.x.1.y'), {});
  assert.deepEqual(cookiesDaMeta(''), {});
  assert.deepEqual(cookiesDaMeta(undefined), {});
});
