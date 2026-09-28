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
const assinar = (url, cookie) => signedRuntimeAttribution(url, 'cliente.test', chave, cookie);

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

// O `_fbp` é um cookie de primeira parte que o pixel da Meta escreve no navegador da
// pessoa — nunca vem na URL do anúncio. Sem ler o cabeçalho Cookie, esse identificador
// jamais chegava à atribuição, mesmo quando o navegador o carregava o tempo todo.
test('fbp válido do cookie chega ao cookie assinado', () => {
  const cookie = assinar('https://cliente.test/oferta?fbclid=IwAR-clique', '_fbp=fb.1.1695000000000.123456789');
  assert.notEqual(cookie, null);
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), {
    fbclid: 'IwAR-clique', fbp: 'fb.1.1695000000000.123456789',
  });
});

test('fbp com formato inválido não entra', () => {
  // O `_fbp` da Meta tem a forma fb.<dígito>.<milissegundos>.<número>. Qualquer coisa fora
  // disso é lixo de outro script ou tentativa de injeção, não um identificador real.
  const cookie = assinar('https://cliente.test/oferta?fbclid=IwAR-clique', '_fbp=lixo-nao-e-fbp');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), { fbclid: 'IwAR-clique' });
});

test('outros cookies da página não entram, mesmo com nome parecido', () => {
  // O cabeçalho Cookie de uma página publicada carrega o que qualquer script ali escreveu.
  // Só o nome exato `_fbp` pode virar atribuição; um nome parecido não é o mesmo cookie.
  const cookie = assinar('https://cliente.test/oferta?fbclid=IwAR-clique', '_fbpx=fb.1.111.222; old_fbp=fb.1.111.222; _fbp2=fb.1.111.222');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), { fbclid: 'IwAR-clique' });
});

test('fbp sozinho, sem parâmetro nenhum na URL, ainda gera atribuição', () => {
  // Quem chega sem fbclid mas com _fbp ainda é uma correspondência válida com a Meta:
  // não faz sentido descartar o único sinal que existe.
  const cookie = assinar('https://cliente.test/oferta', '_fbp=fb.1.1695000000000.123456789');
  assert.notEqual(cookie, null, 'o fbp sozinho já é um sinal de correspondência útil');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), { fbp: 'fb.1.1695000000000.123456789' });
});

// A mesma lista existe duas vezes: aqui, no gateway em Node, e dentro do módulo
// CommonJS que é gerado e publicado na Vercel. Foi assim que ela se desencontrou da
// realidade sem ninguém notar. Este teste faz as duas cópias andarem juntas.
test('a lista de parâmetros de clique é a mesma no gateway publicado', async () => {
  const { PARAMETROS_DE_CLIQUE, REGEX_COOKIE_FBP, FORMATO_FBP } = await import('../server/runtime-gateway-security.mjs');
  const { runtimeGatewayArtifacts } = await import('../server/vercel-runtime-gateway.mjs');
  const { files } = runtimeGatewayArtifacts([], {
    publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), environment: 'production',
    runtimeOrigin: 'https://studio.test', runtimeHmacSecret: 'b'.repeat(64),
  });
  const modulo = files.find((arquivo) => /keyName/.test(String(arquivo.data ?? '')));
  assert.notEqual(modulo, undefined, 'o módulo gerado precisa ser encontrável');
  // fbp não é parâmetro de URL: ele vem do cookie `_fbp`, então fica fora da lista que o
  // módulo busca na query string do referer, e passa a ter um caminho próprio.
  // A lista chega ao módulo gerada a partir da do Node (clique e UTM), em JSON.
  const lista = modulo.data.match(/for\(const keyName of (\[[^\]]+\])\)/)?.[1] ?? '[]';
  const { PARAMETROS_DA_URL } = await import('../server/runtime-gateway-security.mjs');
  assert.deepEqual(JSON.parse(lista), [...PARAMETROS_DA_URL]);
  assert.equal(JSON.parse(lista).includes('fbp'), false, 'fbp vem do cookie, não da URL');
  assert.equal(JSON.parse(lista).includes('fbc'), false, 'fbc vem do cookie do pixel, não da URL');
  assert.equal(JSON.parse(lista).includes('ttp'), false, 'ttp vem do cookie do pixel do TikTok, não da URL');
  assert.ok([...PARAMETROS_DE_CLIQUE].filter((nome) => !['fbp', 'fbc', 'ttp'].includes(nome)).every((nome) => JSON.parse(lista).includes(nome)));
  // O fbp continua coberto nas duas cópias, só que pela mesma regra de cookie — literalmente
  // o mesmo texto de regex — em vez de duas expressões escritas à mão que podem se desencontrar.
  assert.ok(modulo.data.includes(REGEX_COOKIE_FBP.source), 'o módulo publicado precisa usar a mesma regra de cookie que o Node');
  assert.ok(modulo.data.includes(FORMATO_FBP.source), 'o módulo publicado precisa validar o fbp com o mesmo formato que o Node');
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

// --- UTM ---
//
// A simulação de 27/09 mostrou UTM chegando à conversão em 0 de 25 cenários: o gateway
// só assinava o identificador do clique. Campanha, origem e mídia são o que permite ver,
// no painel do anúncio, qual criativo trouxe o lead.

test('a UTM da URL da página entra no cookie assinado, junto do clique', () => {
  const cookie = assinar('https://cliente.test/oferta?fbclid=IwAR-x&utm_source=facebook&utm_medium=cpc&utm_campaign=lancamento&utm_term=agencia&utm_content=criativo_a');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), {
    fbclid: 'IwAR-x', utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'lancamento', utm_term: 'agencia', utm_content: 'criativo_a',
  });
});

// Newsletter, parceria, post orgânico com link marcado: não há clique de anúncio, mas a
// origem existe e é o que diz de onde veio o lead.
test('UTM sozinha, sem clique de anúncio, também gera atribuição', () => {
  const cookie = assinar('https://cliente.test/oferta?utm_source=newsletter&utm_medium=email');
  assert.deepEqual(verifiedRuntimeAttribution(cookie, manifest, raiz), { utm_source: 'newsletter', utm_medium: 'email' });
});

// Os nomes são só em minúsculas, como no Google Analytics: os relatórios dos dois
// continuam batendo. Os valores mantêm a caixa original.
test('o nome do parâmetro só vale em minúsculas; o valor mantém a caixa', () => {
  assert.equal(assinar('https://cliente.test/?UTM_SOURCE=Facebook'), null);
  assert.deepEqual(verifiedRuntimeAttribution(assinar('https://cliente.test/?utm_source=Facebook'), manifest, raiz), { utm_source: 'Facebook' });
});

test('UTM fora do padrão, enorme ou no fragmento não entra', () => {
  assert.equal(assinar('https://cliente.test/?utm_id=1&utm_source_platform=meta'), null);
  assert.equal(assinar(`https://cliente.test/?utm_campaign=${'x'.repeat(600)}`), null);
  assert.equal(assinar('https://cliente.test/#utm_source=fragmento'), null);
});

test('o gateway publicado assina a UTM da página, com a mesma lista do Node', async () => {
  const { runtimeGatewayArtifacts, derivePublicationRuntimeKey: derivar } = await import('../server/vercel-runtime-gateway.mjs');
  const { PARAMETROS_DA_URL } = await import('../server/runtime-gateway-security.mjs');
  const { files } = runtimeGatewayArtifacts([], {
    publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), environment: 'production',
    runtimeOrigin: 'https://studio.test', runtimeHmacSecret: 'b'.repeat(64),
  });
  const fonte = files.find((arquivo) => /module\.exports=\{handler\}/.test(String(arquivo.data ?? ''))).data;
  const crypto = await import('node:crypto');
  const modulo = { exports: {} };
  const cookies = [];
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'process', 'fetch', 'Buffer', 'URL', fonte)(
    () => crypto, modulo, modulo.exports,
    { env: { PUBLICATION_RUNTIME_DERIVED_KEY: derivar('b'.repeat(64), { publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), environment: 'production' }), ALVA_RUNTIME_PUBLICATION_ID: 'pub-1', ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: 'https://studio.test' } },
    async () => new Response('', { status: 200 }), Buffer, URL,
  );
  await modulo.exports.handler(
    { url: '/api/_alva/runtime/runtime.js', method: 'GET', headers: { host: 'cliente.test', referer: 'https://cliente.test/oferta?utm_source=google&utm_campaign=marca&gclid=Cj0-x' }, async *[Symbol.asyncIterator]() {} },
    { statusCode: 200, setHeader(nome, valor) { if (nome === 'set-cookie') cookies.push(...[valor].flat()); }, end() {} },
  );
  const atribuicao = cookies.find((linha) => linha.startsWith('alva_runtime_attribution='));
  assert.ok(atribuicao, 'o gateway publicado não gravou a atribuição');
  const payload = JSON.parse(Buffer.from(atribuicao.split('=')[1].split('.')[0], 'base64url').toString());
  assert.deepEqual(payload, { gclid: 'Cj0-x', utm_source: 'google', utm_campaign: 'marca' });
  assert.ok(PARAMETROS_DA_URL.includes('utm_source'));
});
