// O lead avisado pelo navegador e pelo servidor, com o mesmo nome e o mesmo id.
//
// Critério 9 do rastreamento: "No Gerenciador de Eventos da Meta, um lead enviado pelo
// navegador e pelo servidor aparece como recebido pelas duas fontes e contado uma única
// vez." A Meta só junta os dois quando o nome do evento e o id coincidem. A investigação
// de 27/09 achou as duas metades quebradas: o pixel do navegador nunca disparava o lead —
// só `PageView` —, e o servidor mandava o nome interno `lead`, que para a Meta é um evento
// personalizado, não o `Lead` padrão que a campanha otimiza.
//
// Este teste atravessa o caminho de produção: o gateway publicado, o consentimento dado
// pela pessoa, o envio do formulário, a página de obrigado que volta, e o carregador de
// pixels rodando nela. O que o navegador dispara é comparado com o que o servidor mandaria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest, createRuntimeLoader } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import { gatewayPublicado } from './gateway-publicado.mjs';
import { navegador, rodarCarregador } from './navegador-falso.mjs';

const STUDIO = 'https://studio.example.test';
const DOMINIO = 'lp.example.test';
const RAIZ = 'raiz-hmac-do-pixel-do-navegador';
const CHAVE_MESTRA = 'c'.repeat(64);
const CREDENCIAIS = {
  meta: { pixel_id: '123456', access_token: 'token-meta' },
  tiktok: { pixel_code: 'PXTIKTOK', access_token: 'token-tiktok' },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function chamar(porta, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: porta, method, path, headers: { host: 'studio.example.test', ...headers } }, (res) => {
      const partes = []; res.on('data', (parte) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(partes).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function fetchDoGateway(porta) {
  return async (url, opcoes = {}) => {
    const destino = new URL(url);
    const resposta = await chamar(porta, { method: opcoes.method || 'GET', path: destino.pathname + destino.search, headers: { ...opcoes.headers, 'x-forwarded-for': '76.76.21.21' }, body: opcoes.body });
    const cabecalhos = new Headers();
    for (const [nome, valor] of Object.entries(resposta.headers)) for (const item of [valor].flat()) cabecalhos.append(nome, String(item));
    return new Response(resposta.text, { status: resposta.status, headers: cabecalhos });
  };
}

const disparosDaMeta = (window) => (window.fbq?.queue ?? []).map((entrada) => [...entrada]).filter(([comando]) => comando === 'track' || comando === 'trackSingle');
const disparosDoTikTok = (window) => [...(window.ttq ?? [])].filter(([comando]) => comando === 'track');

test('o lead chega à Meta pelo navegador e pelo servidor com o mesmo nome e o mesmo id', { timeout: 60_000 }, async (t) => {
  const anterior = process.env.TRACKING_MASTER_KEY;
  process.env.TRACKING_MASTER_KEY = CHAVE_MESTRA;
  t.after(() => { if (anterior === undefined) delete process.env.TRACKING_MASTER_KEY; else process.env.TRACKING_MASTER_KEY = anterior; });

  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);

  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('pixel@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [empresa.id, projeto.id, DOMINIO]);

  const captureId = '33333333-3333-4333-8333-333333333333';
  const estado = { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': captureId }, components: [
    { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: '' } }] },
  ] }] };
  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const pagina = await content.createPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, name: 'Landing', route: '/oferta', editorState: estado, renderedHtml: `<main><form data-alva-capture-id="${captureId}" action="#"><input name="email" type="email"></form></main>` });
  await content.publishPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, pageId: pagina.id, lockVersion: pagina.lockVersion });

  const cofre = new SecretVault({ masterKey: CHAVE_MESTRA });
  const tracking = new TrackingRepository(database, { vault: cofre });
  for (const [provedor, configuracao] of Object.entries(CREDENCIAIS)) {
    await tracking.saveDestination({ companyId: empresa.id, projectId: projeto.id, environment: 'production', provider: provedor, configuration: configuracao });
  }
  await database.query(
    `UPDATE tracking_bindings SET status='ready', encrypted_remote_reference=$4 WHERE company_id=$1 AND project_id=$2 AND environment=$3 AND engine='conversions'`,
    [empresa.id, projeto.id, 'production', cofre.encrypt('alva_pixel', `tracking-binding:${empresa.id}:${projeto.id}:production:conversions`)],
  );

  // Publicado como a produção publica com os pixels ligados: o manifesto leva os pixels
  // públicos que a tela de Rastreamento gravou.
  const snapshot = await buildPublishableSnapshot({ database, companyId: empresa.id, projectId: projeto.id, publicOrigin: STUDIO, environment: 'production' });
  const publicationId = 'pixel-do-navegador';
  const providers = await tracking.publicProviders({ companyId: empresa.id, projectId: projeto.id, environment: 'production' });
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId, snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: RAIZ, providers, runtimeBootstrap: true });
  const acao = artefato.files.find((arquivo) => arquivo.file === 'oferta/index.html').data.match(/<form[^>]*action="([^"]+)"/)[1];
  const manifesto = buildRuntimeManifest({ publicationId, snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', providers, contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest: manifesto });

  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: true, conversions: true }, runtimeHmacSecret: RAIZ });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const porta = app.address().port;
  const chave = derivePublicationRuntimeKey(RAIZ, { publicationId, snapshotHash: manifesto.snapshotHash, environment: 'production' });
  const gateway = await gatewayPublicado({ artefato, env: { PUBLICATION_RUNTIME_DERIVED_KEY: chave, ALVA_RUNTIME_PUBLICATION_ID: publicationId, ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: STUDIO }, fetchImpl: fetchDoGateway(porta), dominio: DOMINIO });

  // A pessoa aceita a medição no banner.
  const consentimento = await gateway({ method: 'POST', path: `/_alva/consent?publicationId=${publicationId}`, headers: { 'content-type': 'application/json', origin: `https://${DOMINIO}`, referer: `https://${DOMINIO}/oferta` }, body: Buffer.from(JSON.stringify({ action: 'grant' })) });
  assert.equal(consentimento.status, 200, consentimento.text);
  const cookieDeConsentimento = [consentimento.headers['set-cookie']].flat().filter(Boolean).map((linha) => linha.split(';')[0]).find((par) => par.startsWith('alva_runtime_consent='));
  assert.ok(cookieDeConsentimento, 'o consentimento não gravou o cookie da pessoa');

  // Ela envia o formulário e recebe a página de obrigado.
  const envio = await gateway({
    method: 'POST', path: acao,
    // Com o pixel carregado, o navegador já traz os cookies que a Meta gravou.
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, cookie: `${cookieDeConsentimento}; _fbp=fb.1.1727400000000.1234567890; _fbc=fb.1.1727400000123.IwAR-do-pixel`, 'x-real-ip': '189.68.172.6', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: Buffer.from(`email=${encodeURIComponent('pessoa@exemplo.test')}`),
  });
  assert.equal(envio.status, 200, envio.text);

  const { tracking_event_id: idDoServidor } = (await database.query('SELECT tracking_event_id FROM page_submissions')).rows[0];
  const naFila = (await database.query("SELECT payload FROM conversions_outbox WHERE destination='meta'")).rows[0];
  assert.ok(naFila, 'o lead não foi para a fila da Meta');

  // A página de obrigado diz qual conversão aconteceu, e carrega os pixels.
  const aviso = /<meta name="alva-conversion" content="([^"]+)">/.exec(envio.text)?.[1];
  assert.equal(aviso, `lead:${idDoServidor}`, 'a página de obrigado não informa a conversão com o id do servidor');
  assert.match(envio.text, new RegExp(`<script src="/_alva/runtime\\.js\\?publicationId=${publicationId}"`), 'a página de obrigado não carrega os pixels');

  // O carregador roda na página de obrigado, com o consentimento dado.
  const carregador = await gateway({ method: 'GET', path: `/_alva/runtime.js?publicationId=${publicationId}`, headers: { referer: `https://${DOMINIO}/oferta`, cookie: cookieDeConsentimento } });
  assert.equal(carregador.status, 200);
  const { window } = await rodarCarregador(carregador.text, navegador({ metas: { 'alva-conversion': aviso }, estadoDoConsentimento: 'granted' }));

  // O servidor: o corpo que o adaptador real montaria para a Meta.
  const corpoDaMeta = destinoPara('meta').requisicao(naFila.payload, CREDENCIAIS.meta).corpo.data[0];
  assert.equal(corpoDaMeta.event_name, 'Lead', 'o servidor precisa mandar o evento padrão Lead, não o nome interno');
  assert.equal(corpoDaMeta.event_id, idDoServidor);
  assert.equal(corpoDaMeta.user_data.fbc, 'fb.1.1727400000123.IwAR-do-pixel', 'o _fbc do pixel precisa chegar à Meta');
  assert.equal(corpoDaMeta.user_data.fbp, 'fb.1.1727400000000.1234567890', 'o _fbp do pixel precisa chegar à Meta');

  // O navegador: o mesmo nome e o mesmo id.
  assert.deepEqual(disparosDaMeta(window), [['track', 'PageView'], ['track', 'Lead', {}, { eventID: idDoServidor }]]);
  assert.ok(UUID.test(idDoServidor));

  // Critério 10: recarregar a página de obrigado reenvia o formulário — o navegador manda
  // o mesmo corpo, com os mesmos cookies. É o mesmo lead: nem o servidor nem o pixel podem
  // contar outro. (Achado do revisor independente em 27/09.)
  const recarregada = await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, cookie: cookieDeConsentimento, 'x-real-ip': '189.68.172.6', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: Buffer.from(`email=${encodeURIComponent('pessoa@exemplo.test')}`),
  });
  assert.equal(recarregada.status, 200, recarregada.text);
  // O pixel já disparou na primeira página de obrigado; a recarga não o avisa de novo.
  assert.doesNotMatch(recarregada.text, /alva-conversion/, 'o reenvio não pode disparar o pixel outra vez');
  assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 1, 'o reenvio criou outra captura');
  assert.equal((await database.query("SELECT count(*)::int AS n FROM conversions_outbox WHERE destination='meta'")).rows[0].n, 1, 'o reenvio criou outra conversão');

  // Outra pessoa com as mesmas respostas é outro lead.
  const outraPessoa = await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, 'x-real-ip': '200.150.10.20', 'user-agent': 'Mozilla/5.0 (Android)' },
    body: Buffer.from(`email=${encodeURIComponent('pessoa@exemplo.test')}`),
  });
  assert.equal(outraPessoa.status, 200, outraPessoa.text);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 2);

  // A mesma pessoa mandando outra resposta também é outro envio.
  await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, cookie: cookieDeConsentimento, 'x-real-ip': '189.68.172.6', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: Buffer.from(`email=${encodeURIComponent('outro@exemplo.test')}`),
  });
  assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 3);
});

// --- O carregador, sozinho ---

const BASE = { publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production' };
const ID = '9b2f6a7e-4c1d-4e8a-9f3b-2d6c8e1a5b70';
const fonte = (providers) => createRuntimeLoader({ ...BASE, providers });

test('sem consentimento, o navegador não dispara o lead', async () => {
  for (const estado of ['pending', 'denied']) {
    const { window } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ metas: { 'alva-conversion': `lead:${ID}` }, estadoDoConsentimento: estado }));
    assert.deepEqual(disparosDaMeta(window), [], estado);
  }
});

test('página sem conversão não dispara lead, só a visita', async () => {
  const { window } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ estadoDoConsentimento: 'granted' }));
  assert.deepEqual(disparosDaMeta(window), [['track', 'PageView']]);
});

test('aviso de conversão malformado é ignorado', async () => {
  for (const aviso of ['lead:nao-e-uuid', `compra_inventada:${ID}`, `lead:${ID}');alert(1);('`, '']) {
    const { window } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ metas: { 'alva-conversion': aviso }, estadoDoConsentimento: 'granted' }));
    assert.deepEqual(disparosDaMeta(window), [['track', 'PageView']], aviso);
  }
});

// O formulário de várias etapas troca o documento com `document.write`, na mesma janela:
// o carregador roda de novo na página de obrigado. A visita já foi contada e o SDK já está
// carregado — rodar tudo de novo contaria duas visitas.
test('na mesma janela, o carregador que roda de novo só dispara o lead', async () => {
  const window = {};
  const primeira = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ window, estadoDoConsentimento: 'granted' }));
  const segunda = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ window, metas: { 'alva-conversion': `lead:${ID}` }, estadoDoConsentimento: 'granted' }));
  assert.equal(primeira.scripts.length, 1);
  assert.equal(segunda.scripts.length, 0, 'o SDK foi carregado de novo');
  assert.deepEqual(disparosDaMeta(window), [['track', 'PageView'], ['track', 'Lead', {}, { eventID: ID }]]);
});

// O quiz envia por `fetch` e continua na mesma página: ele mesmo avisa a conversão, com o
// id que mandou ao servidor.
test('o quiz avisa a conversão pela janela, e ela só dispara uma vez', async () => {
  const { window } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ estadoDoConsentimento: 'granted' }));
  assert.equal(typeof window.alvaRuntime?.conversao, 'function');
  window.alvaRuntime.conversao('lead', ID);
  window.alvaRuntime.conversao('lead', ID);
  assert.deepEqual(disparosDaMeta(window), [['track', 'PageView'], ['track', 'Lead', {}, { eventID: ID }]]);
});

test('conversão avisada antes do consentimento dispara quando a pessoa aceita', async () => {
  const pagina = navegador({ estadoDoConsentimento: 'pending' });
  await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), pagina);
  pagina.window.alvaRuntime.conversao('lead', ID);
  assert.deepEqual(disparosDaMeta(pagina.window), []);
  // Ela clica em aceitar; o servidor passa a responder que o consentimento foi dado.
  pagina.estadoDoConsentimento = 'granted';
  pagina.botoes.find((botao) => botao.textContent === 'Aceitar medição').clicar();
  for (let volta = 0; volta < 5; volta += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disparosDaMeta(pagina.window), [['track', 'PageView'], ['track', 'Lead', {}, { eventID: ID }]]);
});

test('o TikTok recebe o lead com o mesmo id', async () => {
  const { window } = await rodarCarregador(fonte([{ provider: 'tiktok', id: 'PXTIKTOK' }]), navegador({ metas: { 'alva-conversion': `lead:${ID}` }, estadoDoConsentimento: 'granted' }));
  const [disparo] = disparosDoTikTok(window);
  assert.ok(disparo, 'o TikTok não recebeu o lead');
  assert.equal(disparo[3]?.event_id, ID);
  const corpo = destinoPara('tiktok').requisicao({ event_name: 'lead', event_time: 1, tracking_event_id: ID, source_url: 'https://lp.example.test/oferta' }, CREDENCIAIS.tiktok).corpo.data[0];
  assert.equal(disparo[1], corpo.event, 'navegador e servidor mandam nomes diferentes ao TikTok');
});

// O código base oficial de cada pixel, e não um arremedo: o SDK real conta com o que ele
// define (callMethod, push, loaded, version na Meta; TiktokAnalyticsObject, methods,
// setAndDefer, instance no TikTok).
// - https://developers.facebook.com/docs/meta-pixel/get-started
// - https://business-api.tiktok.com/portal/docs/install-pixel-using-code/v1.3
test('o pixel da Meta nasce do código base oficial', async () => {
  const { window, scripts } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ estadoDoConsentimento: 'granted' }));
  assert.equal(window.fbq.version, '2.0');
  assert.equal(window.fbq.loaded, true);
  assert.equal(window.fbq.push, window.fbq);
  assert.equal(window._fbq, window.fbq);
  assert.deepEqual(scripts.map((script) => script.src), ['https://connect.facebook.net/en_US/fbevents.js']);
});

test('o pixel do TikTok nasce do código base oficial', async () => {
  const { window, scripts } = await rodarCarregador(fonte([{ provider: 'tiktok', id: 'PXTIKTOK' }]), navegador({ estadoDoConsentimento: 'granted' }));
  assert.equal(window.TiktokAnalyticsObject, 'ttq');
  assert.deepEqual(window.ttq.methods, ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']);
  assert.equal(typeof window.ttq.instance, 'function');
  assert.deepEqual(scripts.map((script) => script.src), ['https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=PXTIKTOK&lib=ttq']);
  assert.deepEqual([...window.ttq], [['page']]);
});

// O navegador só avisa lead. Compra e início de checkout saem pelo servidor, que é quem
// sabe que aconteceram — um script qualquer da página não pode inventá-los.
test('pela janela, só o lead dispara', async () => {
  const { window } = await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), navegador({ estadoDoConsentimento: 'granted' }));
  window.alvaRuntime.conversao('purchase', ID);
  window.alvaRuntime.conversao('initiate_checkout', ID);
  assert.deepEqual(disparosDaMeta(window), [['track', 'PageView']]);
});

// O formulário de várias etapas troca o documento com document.write. Quem ainda não
// decidiu sobre o consentimento precisa continuar vendo o banner na página de obrigado.
test('na mesma janela, sem consentimento, o banner volta na página nova', async () => {
  // document.open() mantém o mesmo objeto document; muda o conteúdo.
  const metas = {};
  const pagina = navegador({ metas, estadoDoConsentimento: 'pending' });
  await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), pagina);
  const banners = () => pagina.noCorpo.filter((no) => no.className === 'alva-runtime-consent').length;
  assert.equal(banners(), 1);
  metas['alva-conversion'] = `lead:${ID}`;
  await rodarCarregador(fonte([{ provider: 'meta', id: '123' }]), pagina);
  assert.equal(banners(), 2, 'o banner não foi refeito na página de obrigado');
  assert.deepEqual(disparosDaMeta(pagina.window), [], 'sem consentimento, nada dispara');
});

// Object.hasOwn só existe a partir do Safari 15.4; o carregador quebrava antes de
// mostrar o banner em iPhones sem atualização.
test('o carregador não usa o que o Safari antigo não tem', () => {
  assert.doesNotMatch(fonte([{ provider: 'meta', id: '123' }]), /Object\.hasOwn/);
});
