// Os cookies que os pixels gravam (Meta e TikTok), lidos no envio.
//
// A Meta documenta: com o pixel na página, o `fbc` certo é o do cookie `_fbc`, que o
// próprio pixel grava; montar à mão (fb.<índice>.<ms>.<fbclid>) é para quando não há
// pixel. E o `_fbp` só existe depois que o pixel carrega — o que, com consentimento, é
// depois do primeiro carregamento da página. Por isso os dois são lidos no envio, do
// cookie que o gateway repassa.
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookiesDosPixels } from '../server/runtime-gateway-security.mjs';

test('lê _fbp e _fbc no formato da Meta', () => {
  assert.deepEqual(cookiesDosPixels('a=1; _fbp=fb.1.1727400000000.1234567890; _fbc=fb.1.1727400000123.IwAR2F4-dbP0l7Mn1IawQQ; b=2'), {
    fbp: 'fb.1.1727400000000.1234567890',
    fbc: 'fb.1.1727400000123.IwAR2F4-dbP0l7Mn1IawQQ',
  });
  // A biblioteca de parâmetros da Meta acrescenta um apêndice ao fbc; o formato continua.
  assert.equal(cookiesDosPixels('_fbc=fb.2.1727400000123.IwAR2F4.AbCd').fbc, 'fb.2.1727400000123.IwAR2F4.AbCd');
});

test('cookie fora do formato é ignorado', () => {
  assert.deepEqual(cookiesDosPixels('_fbp=qualquer; _fbc=fb.x.1.y'), {});
  assert.deepEqual(cookiesDosPixels(''), {});
  assert.deepEqual(cookiesDosPixels(undefined), {});
});

// O TikTok documenta o mesmo mecanismo: o pixel grava `_ttp`, e o valor vai em `user.ttp`.
// https://business-api.tiktok.com/portal/docs/parameters/v1.3
test('lê também o _ttp que o pixel do TikTok grava', () => {
  assert.equal(cookiesDosPixels('_ttp=2Kx8y3Zq9WmN7vB1cD4eF6gH0jL; outro=1').ttp, '2Kx8y3Zq9WmN7vB1cD4eF6gH0jL');
  assert.equal(cookiesDosPixels('_ttp=com espaço').ttp, undefined);
});
