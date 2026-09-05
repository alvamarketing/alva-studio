import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTracker, bootTracker } from '../public/tracker.js';
import { parseCollectPayload } from '../server/analytics-collect.mjs';
import { mapVslEventToTrackerEvent } from '../public/vsl-player.js';

const trackerSourcePath = fileURLToPath(new URL('../public/tracker.js', import.meta.url));

function fakeLocation(pathname, search) {
  return { pathname, search };
}

test('filtra a query pela allowlist de UTMs e click IDs, descartando parâmetros como e-mail', () => {
  const calls = [];
  const navigator = { sendBeacon: (url, body) => { calls.push({ url, body }); return true; } };
  const tracker = createTracker({
    trackerPublicId: 'trk_123',
    location: fakeLocation('/oferta', '?email=x@y.com&utm_source=meta&nome=fulano'),
    navigator,
  });
  tracker.pageview();
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.trackerPublicId, 'trk_123');
  assert.equal(payload.url_query, 'utm_source=meta');
  assert.equal(payload.url_path, '/oferta');
  assert.equal(JSON.stringify(payload).includes('x@y.com'), false);
  assert.equal(JSON.stringify(payload).includes('fulano'), false);
});

test('a allowlist também deixa passar os click IDs conhecidos, sem inventar campos', () => {
  const calls = [];
  const navigator = { sendBeacon: (url, body) => { calls.push(body); return true; } };
  const tracker = createTracker({
    trackerPublicId: 'trk_123',
    location: fakeLocation('/', '?fbclid=abc123&gclid=def456&senha=123&token=xyz'),
    navigator,
  });
  tracker.pageview();
  const payload = JSON.parse(calls[0]);
  assert.equal(payload.url_query, 'fbclid=abc123&gclid=def456');
});

test('captura o domínio de referência quando document.referrer existe, sem o caminho ou a query da página de origem', () => {
  const calls = [];
  const navigator = { sendBeacon: (url, body) => { calls.push(body); return true; } };
  const tracker = createTracker({
    trackerPublicId: 'trk_1', location: fakeLocation('/', ''), navigator,
    document: { referrer: 'https://busca.example.com/resultados?q=segredo' },
  });
  tracker.pageview();
  const payload = JSON.parse(calls[0]);
  assert.equal(payload.referrer, 'https://busca.example.com');
});

test('nunca acessa DOM de formulário: o arquivo não referencia value, elements nem FormData', () => {
  const source = readFileSync(trackerSourcePath, 'utf8');
  for (const forbidden of ['.value', '.elements', 'FormData', 'querySelectorAll', 'localStorage']) {
    assert.equal(source.includes(forbidden), false, `tracker.js não deve conter "${forbidden}"`);
  }
});

test('usa navigator.sendBeacon quando disponível e não cai para fetch', () => {
  let beaconCalls = 0;
  let sendCalls = 0;
  const navigator = { sendBeacon: () => { beaconCalls += 1; return true; } };
  const send = () => { sendCalls += 1; return Promise.resolve({ ok: true }); };
  const tracker = createTracker({ trackerPublicId: 'trk_1', location: fakeLocation('/', ''), navigator, send });
  tracker.pageview();
  assert.equal(beaconCalls, 1);
  assert.equal(sendCalls, 0);
});

test('cai para fetch keepalive quando sendBeacon não existe ou falha', async () => {
  const calls = [];
  const send = (url, options) => { calls.push({ url, options }); return Promise.resolve({ ok: true }); };
  const semBeacon = createTracker({ trackerPublicId: 'trk_1', location: fakeLocation('/', ''), navigator: {}, send });
  semBeacon.pageview();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/public/collect');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.keepalive, true);
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain;charset=UTF-8');

  const beaconRecusa = createTracker({
    trackerPublicId: 'trk_1', location: fakeLocation('/', ''),
    navigator: { sendBeacon: () => false }, send,
  });
  beaconRecusa.pageview();
  await Promise.resolve();
  assert.equal(calls.length, 2, 'sendBeacon recusando (retorno false) também deve cair para fetch');
});

test('falha de rede nunca lança para a página, nem no beacon nem no fallback fetch', async () => {
  const navigatorQuebrado = { sendBeacon: () => { throw new Error('beacon indisponível'); } };
  const sendFalha = () => Promise.reject(new Error('rede fora do ar'));
  const trackerA = createTracker({ trackerPublicId: 'trk_1', location: fakeLocation('/', ''), navigator: navigatorQuebrado, send: sendFalha });
  assert.doesNotThrow(() => trackerA.pageview());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const trackerB = createTracker({ trackerPublicId: 'trk_1', location: fakeLocation('/', ''), navigator: {}, send: sendFalha });
  assert.doesNotThrow(() => trackerB.track('vsl_cta_click', { publicId: 'v1' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('track(name, data) envia event_name plano compatível com o coletor, sem aninhar o "data" do chamador', () => {
  const calls = [];
  const navigator = { sendBeacon: (url, body) => { calls.push(body); return true; } };
  const tracker = createTracker({ trackerPublicId: 'trk_1', location: fakeLocation('/f/orcamento', ''), navigator });
  tracker.track('form_step', { index: 2 });
  const payload = JSON.parse(calls[0]);
  assert.equal(payload.event_name, 'form_step');
  assert.deepEqual(Object.keys(payload).sort(), ['event_name', 'trackerPublicId', 'url_path']);
});

test('boot sem data-alva-tracker não dispara nenhuma requisição', () => {
  let sendCalls = 0;
  const send = () => { sendCalls += 1; return Promise.resolve({ ok: true }); };
  const result = bootTracker({ doc: { currentScript: { dataset: {} } }, location: fakeLocation('/', ''), navigator: {}, send });
  assert.equal(result, null);
  assert.equal(sendCalls, 0);
});

test('boot com data-alva-tracker cria o tracker e envia a pageview inicial', () => {
  let sendCalls = 0;
  const send = () => { sendCalls += 1; return Promise.resolve({ ok: true }); };
  const result = bootTracker({
    doc: { currentScript: { dataset: { alvaTracker: 'trk_boot' } } },
    location: fakeLocation('/', ''), navigator: {}, send,
  });
  assert.notEqual(result, null);
  assert.equal(sendCalls, 1);
});

test('integração: o payload gerado por createTracker passa em parseCollectPayload sem 400', () => {
  const calls = [];
  const navigator = { sendBeacon: (url, body) => { calls.push(body); return true; } };
  const tracker = createTracker({
    trackerPublicId: 'trk_integracao',
    location: fakeLocation('/oferta', '?utm_source=meta&email=nunca@deveria.ir'),
    navigator,
    document: { referrer: 'https://parceiro.example.com/pagina' },
  });
  tracker.pageview();

  const { trackerPublicId, event } = parseCollectPayload(calls[0], 'text/plain');
  assert.equal(trackerPublicId, 'trk_integracao');
  assert.equal(event.event_name, 'pageview');
  assert.equal(event.url_path, '/oferta');
  assert.equal(event.url_query, 'utm_source=meta');
  assert.equal(event.referrer, 'https://parceiro.example.com');
});

test('integração: eventos reais da VSL (mapVslEventToTrackerEvent + alva:track) chegam ao coletor em formato plano', () => {
  const calls = [];
  const listeners = {};
  const doc = {
    currentScript: { dataset: { alvaTracker: 'trk_vsl' } },
    addEventListener: (type, handler) => { listeners[type] = handler; },
  };
  const navigator = { sendBeacon: (url, body) => { calls.push(body); return true; } };
  bootTracker({ doc, location: fakeLocation('/v/pub123', ''), navigator });
  assert.equal(typeof listeners['alva:track'], 'function', 'bootTracker deveria registrar um escutador de alva:track');
  calls.length = 0; // descarta a pageview inicial do boot, que não é o que este teste verifica

  for (const [type, extra] of [['start', {}], ['milestone', { value: 50 }], ['cta_click', {}]]) {
    const mapped = mapVslEventToTrackerEvent({ type, publicId: 'pub123', versionNumber: 2, ...extra });
    listeners['alva:track'](new CustomEvent('alva:track', { detail: mapped }));
  }

  assert.equal(calls.length, 3, 'vsl_start, vsl_progress e vsl_cta_click deveriam chegar ao tracker');
  const [start, progress, cta] = calls.map((body) => parseCollectPayload(body, 'text/plain'));
  assert.equal(start.trackerPublicId, 'trk_vsl');
  assert.equal(start.event.event_name, 'vsl_start');
  assert.equal(progress.event.event_name, 'vsl_progress');
  assert.equal(cta.event.event_name, 'vsl_cta_click');
  assert.equal(JSON.stringify([start, progress, cta]).includes('http'), false, 'nenhuma URL de mídia deve vazar até o coletor');
});
