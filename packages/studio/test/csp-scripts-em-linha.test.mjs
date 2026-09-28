// A página publicada com o runtime ganha uma CSP que só roda script com o nonce dela. O
// quiz antigo (GrapesJS) e o carrossel levam o comportamento num <script> em linha, sem
// nonce: com o rastreamento ligado por padrão, a Vercel serviria o quiz sem avançar de
// etapa. O gateway dá o nonce aos scripts em linha que a própria publicação montou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';

const publicar = (html) => runtimeGatewayArtifacts([{ file: 'q/index.html', data: html }], {
  publicationId: 'p', snapshotHash: 'a'.repeat(64), environment: 'production', runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: 'segredo-do-teste-de-csp-com-tamanho-suficiente', runtimeBootstrap: true,
}).files.find((arquivo) => arquivo.file === 'q/index.html').data;

test('script em linha sem nonce ganha o nonce da CSP da página', () => {
  const html = publicar('<!doctype html><html><head><title>x</title></head><body data-alva-quiz="true"><section>a</section><script>window.rodou=1</script></body></html>');
  const nonce = html.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(html, new RegExp(`<script nonce="${nonce}">window.rodou=1</script>`));
});

test('script com src, com tipo de dados ou já com nonce fica como está', () => {
  const html = publicar('<!doctype html><html><head><title>x</title></head><body><script src="https://exemplo.test/a.js"></script><script type="application/ld+json">{}</script><script nonce="__ALVA_RUNTIME_NONCE__">1</script></body></html>');
  const nonce = html.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
  assert.match(html, /<script src="https:\/\/exemplo.test\/a.js"><\/script>/);
  assert.match(html, /<script type="application\/ld\+json">\{\}<\/script>/);
  assert.match(html, new RegExp(`<script nonce="${nonce}">1</script>`));
});
