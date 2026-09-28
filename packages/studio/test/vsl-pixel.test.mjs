import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeLoader } from '../server/publication-runtime.mjs';
import { navegador, rodarCarregador } from './navegador-falso.mjs';

const carregador = () => createRuntimeLoader({
  publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production',
  providers: [{ provider: 'meta', id: '123456' }, { provider: 'tiktok', id: 'PXTIKTOK' }],
});

function paginaComOuvintes(estadoDoConsentimento) {
  const ouvintes = new Map();
  const window = { addEventListener: (nome, ouvinte) => ouvintes.set(nome, ouvinte) };
  return { pagina: navegador({ estadoDoConsentimento, window }), avisar: (detail) => ouvintes.get('alva:vsl')?.({ detail }) };
}

test('com consentimento, os marcos da VSL vão ao pixel como eventos personalizados', async () => {
  const { pagina, avisar } = paginaComOuvintes('granted');
  await rodarCarregador(carregador(), pagina);
  avisar({ tipo: 'marco', publicId: 'vsl-abc', valor: 25 });
  avisar({ tipo: 'fim', publicId: 'vsl-abc' });
  const meta = pagina.window.fbq.queue.map((entrada) => [...entrada]).filter(([comando]) => comando === 'trackCustom');
  assert.deepEqual(meta, [
    ['trackCustom', 'vsl_progress', { value: 25, content_ids: ['vsl-abc'] }],
    ['trackCustom', 'vsl_complete', { content_ids: ['vsl-abc'] }],
  ]);
  const tiktok = [...pagina.window.ttq].filter(([comando]) => comando === 'track');
  assert.deepEqual(tiktok, [
    ['track', 'vsl_progress', { value: 25, content_id: 'vsl-abc' }],
    ['track', 'vsl_complete', { content_id: 'vsl-abc' }],
  ]);
});

test('sem consentimento, nada da VSL vai ao pixel', async () => {
  const { pagina, avisar } = paginaComOuvintes('denied');
  await rodarCarregador(carregador(), pagina);
  avisar({ tipo: 'marco', publicId: 'vsl-abc', valor: 25 });
  assert.equal(pagina.window.fbq, undefined);
});
