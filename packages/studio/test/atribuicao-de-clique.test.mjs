import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedRuntimeAttribution, verifiedRuntimeAttribution } from '../server/runtime-gateway-security.mjs';
import { derivePublicationRuntimeKey } from '../server/vercel-runtime-gateway.mjs';

// A página publicada é o único ponto onde o identificador do clique existe: ele vem na URL
// do anúncio e some na primeira navegação. Se não for capturado aqui, nenhuma conversão
// daquela pessoa poderá ser atribuída ao anúncio que a trouxe.
const manifest = { publicationId: 'pub-1', environment: 'production', origin: 'https://cliente.test', snapshotHash: 'a'.repeat(64) };
const raiz = 'a'.repeat(64);
const chave = derivePublicationRuntimeKey(raiz, manifest);
const assinar = (url) => signedRuntimeAttribution(url, 'cliente.test', chave);

test('captura os parâmetros com os nomes que as plataformas realmente usam', () => {
  // A Meta manda `fbclid`; nunca `fbc`, que é um valor derivado dele. Pedir pelo nome
  // errado fazia toda campanha do Facebook chegar sem atribuição nenhuma.
  const cookie = assinar('https://cliente.test/oferta?fbclid=IwAR-clique&gclid=g-1&ttclid=tt-1&li_fat_id=li-1&tblci=tb-1');
  assert.notEqual(cookie, null, 'a URL de um anúncio precisa gerar atribuição');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), {
    fbclid: 'IwAR-clique', gclid: 'g-1', ttclid: 'tt-1', li_fat_id: 'li-1', tblci: 'tb-1',
  });
});

test('parâmetro fora da lista não entra, nem valor absurdamente longo', () => {
  const cookie = assinar(`https://cliente.test/?fbclid=ok&xpto=nao&gclid=${'g'.repeat(600)}`);
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), { fbclid: 'ok' });
});

test('visita sem anúncio não gera cookie de atribuição', () => {
  assert.equal(assinar('https://cliente.test/oferta'), null);
});

test('URL de outro domínio não assina: atribuição de fora não entra', () => {
  assert.equal(assinar('https://outro.test/oferta?fbclid=x'), null);
});

test('cookie adulterado é descartado inteiro, em vez de aceitar a parte legível', () => {
  const cookie = assinar('https://cliente.test/?fbclid=original');
  const [payload, assinatura] = cookie.split('.');
  const outro = Buffer.from(JSON.stringify({ fbclid: 'injetado' })).toString('base64url');
  assert.deepEqual(verifiedRuntimeAttribution(`${outro}.${assinatura}`, manifest, raiz), {});
  assert.deepEqual(verifiedRuntimeAttribution(`${payload}.${'0'.repeat(assinatura.length)}`, manifest, raiz), {});
});

// A mesma lista existe duas vezes: aqui, no gateway em Node, e dentro do módulo
// CommonJS que é gerado e publicado na Vercel. Foi assim que ela se desencontrou da
// realidade sem ninguém notar. Este teste faz as duas cópias andarem juntas.
test('a lista de parâmetros de clique é a mesma no gateway publicado', async () => {
  const { PARAMETROS_DE_CLIQUE } = await import('../server/runtime-gateway-security.mjs');
  const { runtimeGatewayArtifacts } = await import('../server/vercel-runtime-gateway.mjs');
  const { files } = runtimeGatewayArtifacts([], {
    publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), environment: 'production',
    runtimeOrigin: 'https://studio.test', runtimeHmacSecret: 'b'.repeat(64),
  });
  const modulo = files.find((arquivo) => /keyName/.test(String(arquivo.data ?? '')));
  assert.notEqual(modulo, undefined, 'o módulo gerado precisa ser encontrável');
  const lista = modulo.data.match(/for\(const keyName of \[([^\]]+)\]\)/)?.[1] ?? '';
  const nomes = lista.split(',').map((parte) => parte.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(nomes.sort(), [...PARAMETROS_DE_CLIQUE].sort());
});

// Quatro listas do mesmo conceito era o que fazia a atribuição se perder entre a coleta e
// a entrega. Agora a política de consentimento é a fonte, e este teste impede que o
// gateway volte a coletar um nome que a fila não aceita.
test('o que o gateway coleta é exatamente o que a fila aceita', async () => {
  const { PARAMETROS_DE_CLIQUE } = await import('../server/runtime-gateway-security.mjs');
  const { IDENTIFICADORES_DE_CLIQUE, NOME_NA_PLATAFORMA } = await import('../server/conversion-consent-policy.mjs');
  assert.deepEqual([...PARAMETROS_DE_CLIQUE].sort(), [...IDENTIFICADORES_DE_CLIQUE].sort());
  // E todo nome coletado tem para onde ir numa plataforma: coletar o que ninguém recebe
  // seria guardar dado de navegação sem uso.
  for (const nome of PARAMETROS_DE_CLIQUE) {
    assert.ok(NOME_NA_PLATAFORMA[nome], `${nome} não tem destino em nenhuma plataforma`);
  }
});
