// O IP e o navegador de quem visita, atravessando o gateway dentro da assinatura.
//
// A auditoria de 27/09 e a sonda na Vercel real mostraram o defeito: o gateway só
// repassava quatro cabeçalhos, e o servidor enxergava o IP da própria Vercel e o
// navegador `node` para todo visitante — que era o que ia para a Meta. A Vercel entrega
// os dados certos ao gateway; era a regra de repasse que os descartava.
//
// O conserto tem uma exigência que estes testes existem para fixar: o IP e o navegador
// só valem se vierem dentro da assinatura. Um cabeçalho solto qualquer um forja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRuntimeRequest, verifyRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { verifyRuntimeGatewayEnvelope } from '../server/runtime-gateway-security.mjs';

const CHAVE = 'a'.repeat(64);
const BASE = {
  method: 'POST', path: '/api/public/pages/oferta/captures/c1/submissions', publicationId: 'pub-1',
  environment: 'production', timestamp: 1_700_000_000, nonce: 'nonce-123456789012', body: 'email=pessoa%40x.test',
};
const PESSOA = { ip: '189.68.172.6', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' };
const aceitaTudo = { claim: async () => true };

test('a assinatura cobre o IP e o navegador de quem visita', () => {
  const com = signRuntimeRequest({ ...BASE, client: PESSOA }, CHAVE);
  assert.notEqual(com, signRuntimeRequest(BASE, CHAVE), 'o visitante precisa entrar no que é assinado');
  assert.notEqual(com, signRuntimeRequest({ ...BASE, client: { ...PESSOA, ip: '189.68.172.7' } }, CHAVE));
  assert.notEqual(com, signRuntimeRequest({ ...BASE, client: { ...PESSOA, userAgent: 'outro' } }, CHAVE));
});

// Gateways já publicados não mandam o visitante. Eles continuam valendo: sem visitante, a
// assinatura é conferida no formato de sempre.
test('sem visitante, a assinatura é a mesma do formato antigo', () => {
  const antigo = signRuntimeRequest(BASE, CHAVE);
  assert.equal(signRuntimeRequest({ ...BASE, client: {} }, CHAVE), antigo);
  assert.equal(signRuntimeRequest({ ...BASE, client: { ip: null, userAgent: null } }, CHAVE), antigo);
});

test('adulterar o visitante em trânsito é recusado', async () => {
  const assinatura = signRuntimeRequest({ ...BASE, client: PESSOA }, CHAVE);
  const opcoes = { now: BASE.timestamp + 1, replay: aceitaTudo };
  assert.equal(await verifyRuntimeRequest({ ...BASE, client: PESSOA }, assinatura, CHAVE, opcoes), true);
  assert.equal(await verifyRuntimeRequest({ ...BASE, client: { ...PESSOA, ip: '1.2.3.4' } }, assinatura, CHAVE, opcoes), false, 'trocar o IP');
  assert.equal(await verifyRuntimeRequest(BASE, assinatura, CHAVE, opcoes), false, 'arrancar o visitante');
});

test('acrescentar visitante a uma requisição assinada sem ele é recusado', async () => {
  const assinatura = signRuntimeRequest(BASE, CHAVE);
  assert.equal(await verifyRuntimeRequest({ ...BASE, client: PESSOA }, assinatura, CHAVE, { now: BASE.timestamp + 1, replay: aceitaTudo }), false);
});

// --- O envelope que o Studio confere ---

const MANIFESTO = { company_id: 'c', project_id: 'p', publication_id: 'pub-1', snapshot_hash: 'b'.repeat(64), policy_version: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production', policy: {}, providers: [] };
const RAIZ = 'raiz-do-teste-de-visitante';
const CHAVE_DERIVADA = derivePublicationRuntimeKey(RAIZ, { publicationId: 'pub-1', snapshotHash: MANIFESTO.snapshot_hash, environment: 'production' });
const repositorio = () => ({
  async currentForOrigin({ publicationId, origin }) { return publicationId === 'pub-1' && origin === MANIFESTO.origin ? MANIFESTO : null; },
  async claimNonce() { return true; },
});

function envelope({ client, cabecalhosDoVisitante = client } = {}) {
  const body = Buffer.from(BASE.body);
  const assinatura = signRuntimeRequest({ ...BASE, body, ...(client ? { client } : {}) }, CHAVE_DERIVADA);
  return {
    body,
    headers: {
      'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': 'pub-1',
      'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(BASE.timestamp),
      'x-alva-runtime-nonce': BASE.nonce, 'x-alva-runtime-signature': assinatura,
      ...(cabecalhosDoVisitante?.ip ? { 'x-alva-client-ip': cabecalhosDoVisitante.ip } : {}),
      ...(cabecalhosDoVisitante?.userAgent ? { 'x-alva-client-ua': cabecalhosDoVisitante.userAgent } : {}),
    },
  };
}
const conferir = (pedido) => verifyRuntimeGatewayEnvelope({ repository: repositorio(), rootSecret: RAIZ, method: 'POST', path: BASE.path, now: BASE.timestamp + 1, ...pedido });

test('o Studio devolve o visitante só depois de conferir a assinatura', async () => {
  const conferido = await conferir(envelope({ client: PESSOA }));
  assert.deepEqual(conferido.client, PESSOA);
});

test('visitante forjado num cabeçalho solto é recusado', async () => {
  // Assinado sem visitante, e alguém acrescenta os cabeçalhos no caminho.
  await assert.rejects(() => conferir(envelope({ client: undefined, cabecalhosDoVisitante: PESSOA })), /assinatura/i);
});

test('gateway antigo, sem visitante, continua sendo aceito — e sem visitante', async () => {
  const conferido = await conferir(envelope({ client: undefined }));
  assert.deepEqual(conferido.client, {});
});

// --- O módulo que roda de verdade na Vercel ---
//
// Até aqui ele só tinha sido conferido comparando texto: o código que roda em produção
// nunca rodou num teste. Aqui ele é executado, recebendo uma visita como a Vercel entrega,
// e a assinatura que ele produz é conferida pelo verificador do Studio.

async function executarGatewayPublicado({ headers }) {
  const { files } = runtimeGatewayArtifacts([], {
    publicationId: 'pub-1', snapshotHash: MANIFESTO.snapshot_hash, environment: 'production',
    runtimeOrigin: 'https://studio.example.test', runtimeHmacSecret: RAIZ,
  });
  const fonte = files.find((arquivo) => /module\.exports=\{handler\}/.test(String(arquivo.data ?? ''))).data;
  const modulo = { exports: {} };
  const crypto = await import('node:crypto');
  const saidas = [];
  const fetchFalso = async (url, opcoes) => {
    saidas.push({ url: String(url), headers: opcoes.headers, body: opcoes.body });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const env = {
    PUBLICATION_RUNTIME_DERIVED_KEY: CHAVE_DERIVADA, ALVA_RUNTIME_PUBLICATION_ID: 'pub-1',
    ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: 'https://studio.example.test',
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'process', 'fetch', 'Buffer', 'URL', fonte)(
    (nome) => { if (nome === 'node:crypto') return crypto; throw new Error(`require inesperado: ${nome}`); },
    modulo, modulo.exports, { env }, fetchFalso, Buffer, URL,
  );
  const corpo = Buffer.from(BASE.body);
  const req = {
    url: '/api/_alva/pages/oferta/captures/c1/submissions', method: 'POST', headers,
    async *[Symbol.asyncIterator]() { yield corpo; },
  };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  await modulo.exports.handler(req, res);
  return { saida: saidas[0], status: res.statusCode };
}

test('o gateway publicado repassa o visitante, e o Studio aceita a assinatura dele', async () => {
  const { saida } = await executarGatewayPublicado({
    headers: { host: 'lp.example.test', 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': PESSOA.ip, 'x-forwarded-for': `${PESSOA.ip}, 10.0.0.1`, 'user-agent': PESSOA.userAgent },
  });
  assert.ok(saida, 'o gateway publicado não chamou o Studio');
  assert.equal(saida.headers['x-alva-client-ip'], PESSOA.ip);
  assert.equal(saida.headers['x-alva-client-ua'], PESSOA.userAgent);
  // A prova de que as duas cópias concordam: a assinatura produzida na Vercel é aceita
  // pelo verificador do Studio, com o visitante dentro.
  const conferido = await verifyRuntimeGatewayEnvelope({
    repository: repositorio(), rootSecret: RAIZ, method: 'POST', path: BASE.path,
    now: Number(saida.headers['x-alva-runtime-timestamp']) + 1, headers: saida.headers, body: Buffer.from(saida.body),
  });
  assert.deepEqual(conferido.client, PESSOA);
});

test('o gateway publicado não repassa IP que não é IP, nem navegador com quebra de linha', async () => {
  const { saida } = await executarGatewayPublicado({
    headers: { host: 'lp.example.test', 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': 'não-é-ip', 'user-agent': 'Mozilla\r\nX-Injetado: 1' },
  });
  assert.equal(saida.headers['x-alva-client-ip'], undefined);
  assert.doesNotMatch(String(saida.headers['x-alva-client-ua'] ?? ''), /[\r\n]/);
});
