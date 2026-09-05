import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCollectPayload, createCollectLimiter } from '../server/analytics-collect.mjs';

function basePayload(overrides = {}) {
  return { trackerPublicId: 'trk_abc123', event_name: 'pageview', ...overrides };
}

test('aceita application/json e text/plain (formato do navigator.sendBeacon)', () => {
  const json = parseCollectPayload(JSON.stringify(basePayload()), 'application/json');
  assert.equal(json.trackerPublicId, 'trk_abc123');
  assert.equal(json.event.event_name, 'pageview');

  const plain = parseCollectPayload(JSON.stringify(basePayload()), 'text/plain;charset=UTF-8');
  assert.equal(plain.trackerPublicId, 'trk_abc123');
  assert.equal(plain.event.event_name, 'pageview');
});

test('recusa multipart/form-data com 415', () => {
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload()), 'multipart/form-data; boundary=x'),
    (error) => error.status === 415,
  );
});

test('recusa corpo acima de 64 KB com 413 e aceita exatamente o teto', () => {
  const empty = Buffer.byteLength(JSON.stringify(basePayload({ url_path: '' })), 'utf8');
  const raw = JSON.stringify(basePayload({ url_path: 'a'.repeat(64 * 1024 - empty) }));
  assert.equal(Buffer.byteLength(raw, 'utf8'), 64 * 1024, 'ajuste do teste deve cair exatamente no teto');
  assert.doesNotThrow(() => parseCollectPayload(raw, 'application/json'));

  const oversized = Buffer.concat([Buffer.from(raw, 'utf8'), Buffer.from('x', 'utf8')]);
  assert.throws(
    () => parseCollectPayload(oversized, 'application/json'),
    (error) => error.status === 413,
  );
});

test('recusa companyId, projectId e email no corpo com 400: escopo e PII nunca vêm do navegador', () => {
  for (const key of ['companyId', 'projectId', 'email']) {
    assert.throws(
      () => parseCollectPayload(JSON.stringify(basePayload({ [key]: 'valor-qualquer' })), 'application/json'),
      (error) => error.status === 400,
      `chave ${key} deveria ser recusada`,
    );
  }
});

test('recusa event_name fora da lista fechada', () => {
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload({ event_name: 'algo_inventado' })), 'application/json'),
    (error) => error.status === 400,
  );
});

test('aceita todo evento da lista fechada de event_name', () => {
  const names = ['pageview', 'form_start', 'form_step', 'form_submit_attempt', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click', 'vsl_error'];
  for (const event_name of names) {
    const result = parseCollectPayload(JSON.stringify(basePayload({ event_name })), 'application/json');
    assert.equal(result.event.event_name, event_name);
  }
});

test('url_query é filtrada às 5 UTMs e aos click ids permitidos, descartando qualquer outra chave', () => {
  const result = parseCollectPayload(
    JSON.stringify(basePayload({ url_query: 'utm_source=meta&utm_campaign=lancamento&fbclid=abc123&session=xyz&foo=bar' })),
    'application/json',
  );
  const params = new URLSearchParams(result.event.url_query);
  assert.equal(params.get('utm_source'), 'meta');
  assert.equal(params.get('utm_campaign'), 'lancamento');
  assert.equal(params.get('fbclid'), 'abc123');
  assert.equal(params.has('session'), false, 'chave fora da allowlist deve ser descartada, não rejeitada');
  assert.equal(params.has('foo'), false);
});

test('aceita todos os click ids e as 5 UTMs previstas na spec', () => {
  const query = 'utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&gclid=1&gbraid=2&wbraid=3&ttclid=4&li_fat_id=5';
  const result = parseCollectPayload(JSON.stringify(basePayload({ url_query: query })), 'application/json');
  const params = new URLSearchParams(result.event.url_query);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id']) {
    assert.ok(params.has(key), `${key} deveria sobreviver ao filtro`);
  }
});

test('rejeita e-mail e telefone em url_query, url_path e referrer com 400, mesmo dentro de chave permitida', () => {
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload({ url_query: 'utm_campaign=contato-pessoa@exemplo.com' })), 'application/json'),
    (error) => error.status === 400,
    'e-mail dentro de utm_campaign deveria ser recusado',
  );
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload({ url_path: '/lead/pessoa@exemplo.com' })), 'application/json'),
    (error) => error.status === 400,
  );
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload({ referrer: 'https://exemplo.com/?tel=11999998888contato' })), 'application/json'),
    (error) => error.status === 400,
  );
  assert.throws(
    () => parseCollectPayload(JSON.stringify(basePayload({ url_path: '/fale-conosco/+55 11 99999-8888' })), 'application/json'),
    (error) => error.status === 400,
    'telefone formatado também deve ser recusado',
  );
});

test('não rejeita números curtos comuns em rota (id de página, ano, etc.)', () => {
  const result = parseCollectPayload(JSON.stringify(basePayload({ url_path: '/produto/1234' })), 'application/json');
  assert.equal(result.event.url_path, '/produto/1234');
});

test('recusa JSON inválido com 400 e corpo sem trackerPublicId com 400', () => {
  assert.throws(() => parseCollectPayload('{invalido', 'application/json'), (error) => error.status === 400);
  assert.throws(
    () => parseCollectPayload(JSON.stringify({ event_name: 'pageview' }), 'application/json'),
    (error) => error.status === 400,
  );
});

test('limitador de coleta: libera até o teto por tracker, bloqueia acima e expira na janela seguinte', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinute: 3, maxTrackers: 10, maxPerMinutePerIp: 1000 });
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), false, 'quarta chamada no mesmo minuto deve ser bloqueada');

  now += 60_000;
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), true, 'janela seguinte deve liberar de novo');
});

test('limitador de coleta: um tracker bloqueado não afeta o teto de outro tracker', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinute: 1, maxTrackers: 10, maxPerMinutePerIp: 1000 });
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_a' }), false);
  assert.equal(limiter.allow({ ip: '203.0.113.1', trackerPublicId: 'trk_b' }), true, 'outro tracker tem seu próprio teto independente');
});

test('limitador de coleta: não cresce sem limite com muitos trackers distintos', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinute: 100, maxTrackers: 5, maxPerMinutePerIp: 100_000, maxTrackersPerIp: 100_000 });
  for (let index = 0; index < 1000; index += 1) {
    limiter.allow({ ip: `10.0.0.${index % 250}`, trackerPublicId: `trk_${index}` });
  }
  assert.ok(limiter.size() <= 5, 'o número de baldes de tracker nunca deve ultrapassar maxTrackers');

  assert.equal(limiter.allow({ ip: '10.0.0.1', trackerPublicId: 'trk_999' }), true, 'o tracker mais recente sobrevive ao descarte do mais antigo');
});

test('limitador de coleta: teto por IP bloqueia antes de olhar para o tracker, mesmo com trackers distintos', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinute: 1000, maxTrackers: 1000, maxPerMinutePerIp: 3, maxTrackersPerIp: 1000 });
  assert.equal(limiter.allow({ ip: '198.51.100.9', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.9', trackerPublicId: 'trk_b' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.9', trackerPublicId: 'trk_c' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.9', trackerPublicId: 'trk_d' }), false, 'quarto tracker diferente no mesmo IP ainda estoura o teto por IP');
  assert.equal(limiter.allow({ ip: '198.51.100.10', trackerPublicId: 'trk_e' }), true, 'outro IP tem seu próprio teto independente');
});

test('limitador de coleta: teto de trackers desconhecidos por IP contém varredura de tracker_public_id', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinute: 1000, maxTrackers: 1000, maxPerMinutePerIp: 1000, maxTrackersPerIp: 3 });
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_a' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_b' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_c' }), true);
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_d' }), false, 'quarto tracker distinto vindo do mesmo IP é bloqueado');
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_a' }), false, 'uma vez estourado o teto de trackers distintos, o IP fica bloqueado até a janela seguinte, mesmo repetindo tracker já visto');

  now += 60_000;
  assert.equal(limiter.allow({ ip: '198.51.100.20', trackerPublicId: 'trk_a' }), true, 'nova janela reabre o IP');
});

test('limitador de coleta: aceita checagem só por IP, antes de qualquer parse do corpo', () => {
  let now = 0;
  const limiter = createCollectLimiter({ now: () => now, maxPerMinutePerIp: 2 });
  assert.equal(limiter.allow({ ip: '203.0.113.50' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.50' }), true);
  assert.equal(limiter.allow({ ip: '203.0.113.50' }), false, 'terceira chamada só com IP já deve bloquear, sem depender de trackerPublicId');
});
