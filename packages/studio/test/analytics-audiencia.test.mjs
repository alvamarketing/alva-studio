import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivarAudiencia } from '../server/analytics-audiencia.mjs';

// A audiência — país, dispositivo, navegador — sai dos cabeçalhos da requisição, nunca do
// IP nem do user-agent cru guardados. O Umami preenchia isso server-side; ao absorvê-lo, é
// esta função que passa a preencher, com o mesmo cuidado: só a classe do aparelho e a
// família do navegador, mais o país de duas letras que a Cloudflare já entrega.

test('classifica celular, tablet e computador pelo user-agent', () => {
  const iphone = derivarAudiencia({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604' });
  assert.equal(iphone.device, 'mobile');
  assert.equal(iphone.browser, 'Safari');

  const ipad = derivarAudiencia({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604' });
  assert.equal(ipad.device, 'tablet');

  const desktop = derivarAudiencia({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537 Chrome/120 Safari/537' });
  assert.equal(desktop.device, 'desktop');
  assert.equal(desktop.browser, 'Chrome');
});

test('o país vem do cabeçalho da Cloudflare, em maiúsculas de duas letras', () => {
  assert.equal(derivarAudiencia({ 'cf-ipcountry': 'br' }).country, 'BR');
  assert.equal(derivarAudiencia({ 'cf-ipcountry': 'US' }).country, 'US');
});

test('sem Cloudflare na frente, o país fica nulo em vez de inventado', () => {
  assert.equal(derivarAudiencia({ 'user-agent': 'Mozilla/5.0' }).country, null);
});

test('o valor de reserva T1 da Cloudflare (país desconhecido) não vira país', () => {
  // A Cloudflare manda "XX" e "T1" quando não sabe o país; guardá-los polui a tela.
  assert.equal(derivarAudiencia({ 'cf-ipcountry': 'XX' }).country, null);
  assert.equal(derivarAudiencia({ 'cf-ipcountry': 'T1' }).country, null);
});

test('sem cabeçalho nenhum, nada quebra e tudo vem vazio', () => {
  const vazio = derivarAudiencia({});
  assert.deepEqual(vazio, { country: null, city: null, device: null, browser: null });
  assert.deepEqual(derivarAudiencia(), { country: null, city: null, device: null, browser: null });
});

test('nenhum IP nem user-agent cru sai desta função', () => {
  const r = derivarAudiencia({ 'user-agent': 'Mozilla/5.0 (iPhone) Safari', 'cf-connecting-ip': '203.0.113.7' });
  const valores = Object.values(r).join(' ');
  assert.ok(!valores.includes('203.0.113.7'), 'não pode conter IP');
  assert.ok(!valores.includes('Mozilla'), 'não pode conter user-agent cru');
});
