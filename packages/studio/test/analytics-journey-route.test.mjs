import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../server/project-api.mjs', import.meta.url), 'utf8');

test('a rota de jornada monta o grafo com os dados do próprio banco, sem depender do Umami', () => {
  const trecho = api.slice(api.indexOf('const analyticsCollection'), api.indexOf('const analyticsCollection') + 1400);
  assert.match(trecho, /buildJourneyGraph/);
  assert.match(trecho, /journeyEvents/);
  // o retorno vazio de antes escondia que havia dados locais para montar a jornada
  assert.doesNotMatch(trecho, /=== 'journey' \? \[\] : \[\]/);
});

test('a jornada continua exigindo permissão de leitura de analytics', () => {
  const trecho = api.slice(api.indexOf('const analyticsCollection'), api.indexOf('const analyticsCollection') + 1400);
  assert.match(trecho, /authorize\(context, 'analytics\.read', projectId\)/);
});
