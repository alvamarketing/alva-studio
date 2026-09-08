import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fonte = await readFile(new URL('../server/repositories/nvs-commercial-outbox-repository.mjs', import.meta.url), 'utf8');

test('o status das conversões expõe destino, conteúdo e consentimento', () => {
  const corpo = fonte.slice(fonte.indexOf('function statusRecord('), fonte.indexOf('export function commercialRetryDelay'));
  assert.match(corpo, /destination/);
  assert.match(corpo, /consentState/);
  assert.match(corpo, /contentId/);
  assert.match(corpo, /delete delivery\.trackingEventId/); // o id de rastreio continua fora da resposta
  assert.match(corpo, /eventRef/); // a jornada agrupa por referência derivada
});

test('o status nunca devolve os hashes de contato do payload', () => {
  const corpo = fonte.slice(fonte.indexOf('function statusRecord('), fonte.indexOf('export function commercialRetryDelay'));
  assert.doesNotMatch(corpo, /payload\.user|email_sha256|phone_sha256/);
  assert.doesNotMatch(corpo, /delivery\.payload = |\.\.\.row\.payload/);
});
