// Etapa 7, passo 3: os sinais chegam pelo coletor, ficam em tabelas próprias e saem por projeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { AnalyticsRepository } from '../server/repositories/analytics-repository.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { blocosDaPagina, montarRelatorioDeSinais } from '../server/sinais-de-bloco.mjs';
import { paginaInicial } from '../public/pagina-alva.js';
import { postgresFixture } from './postgres-fixture.mjs';
import { chamarStudio } from './gateway-publicado.mjs';

const scrypt = promisify(scryptCallback);
const row = async (database, query, values = []) => (await database.query(query, values)).rows[0];

async function senhaLegada(senha) {
  const salt = randomBytes(16).toString('hex');
  return JSON.stringify({ salt, hash: (await scrypt(senha, salt, 64)).toString('hex') });
}

async function semear(database, { email, slug, senha = 'senha-de-teste-sinais-1' }) {
  const user = await row(database, 'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [email, await senhaLegada(senha), 'Pessoa']);
  const company = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [slug, slug]);
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [company.id, user.id]);
  const project = await row(database, 'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [company.id, 'Projeto', `p-${slug}`, user.id]);
  const website = await row(database, `INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, $3, 'production')
     ON CONFLICT (company_id, project_id, environment) DO UPDATE SET tracker_public_id = EXCLUDED.tracker_public_id RETURNING id`, [company.id, project.id, `trk-${slug}`]);
  return { user, company, project, website, email, senha, tracker: `trk-${slug}` };
}

async function iniciar(t, database, opcoes = {}) {
  const server = createApp({ database, sessionOptions: { sessionTTL: 60_000 }, ...opcoes });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function cliente(base) {
  let cookie = '';
  return async (path, method = 'GET', body) => {
    const resposta = await fetch(base + path, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (resposta.headers.has('set-cookie')) cookie = resposta.headers.get('set-cookie').split(';')[0];
    return resposta;
  };
}

async function entrar(base, conta) {
  const chamar = cliente(base);
  const login = await chamar('/api/login', 'POST', { email: conta.email, password: conta.senha });
  assert.equal(login.status, 200, await login.text());
  return chamar;
}

const coletar = (base, corpo) => fetch(`${base}/api/public/collect`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(corpo) });
const janela = () => `from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`;

async function bancoMigrado(t) {
  // O fechamento é registrado antes do contêiner do fixture: os ganchos rodam na ordem em que
  // foram registrados, e o pool não pode ver o Postgres sumir antes de se despedir.
  let database;
  t.after(() => database?.close());
  const { connectionString } = await postgresFixture(t);
  database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}

test('a migração 030 cria as tabelas de sinais e as constraints recusam o que o coletor nunca enviaria', async (t) => {
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'mig@alva.test', slug: 'mig' });
  const base = [conta.company.id, conta.project.id, conta.website.id];
  const inserir = (bloco, entered, segundos, cliques) => database.query(
    'INSERT INTO analytics_block_signals (company_id, project_id, website_id, url_path, block_id, entered, seconds_visible, clicks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [...base, '/oferta', bloco, entered, segundos, cliques],
  );
  await inserir('secao-1', 1, 10, 2);
  await assert.rejects(() => inserir('com espaço', 1, 1, 0), { code: '23514' });
  await assert.rejects(() => inserir('a', 2, 1, 0), { code: '23514' });
  await assert.rejects(() => inserir('a', 1, 99999, 0), { code: '23514' });
  await assert.rejects(() => inserir('a', 1, 1, 101), { code: '23514' });
  await assert.rejects(() => database.query('INSERT INTO analytics_scroll_marks (company_id, project_id, website_id, url_path, mark) VALUES ($1,$2,$3,$4,$5)', [...base, '/oferta', 30]), { code: '23514' });
  // O escopo é por empresa e projeto: um website de outra empresa não casa.
  const outra = await semear(database, { email: 'mig2@alva.test', slug: 'mig2' });
  await assert.rejects(() => database.query(
    'INSERT INTO analytics_block_signals (company_id, project_id, website_id, url_path, block_id, entered, seconds_visible, clicks) VALUES ($1,$2,$3,$4,$5,1,1,0)',
    [conta.company.id, conta.project.id, outra.website.id, '/x', 'a'],
  ), { code: '23503' });
});

test('o lote chega pelo coletor, vira linhas próprias e não entra nos eventos da jornada', async (t) => {
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'coleta@alva.test', slug: 'coleta' });
  const base = await iniciar(t, database);

  assert.equal((await coletar(base, { trackerPublicId: conta.tracker, event_name: 'pageview', url_path: '/oferta' })).status, 204);
  const resposta = await coletar(base, {
    trackerPublicId: conta.tracker, event_name: 'bloco_sinais', url_path: '/oferta',
    event_data: { rolagem: [25, 50], blocos: [{ id: 'secao-topo', entrou: 1, segundos: 12, cliques: 1 }, { id: 'botao-1', entrou: 1, segundos: 3, cliques: 1 }] },
  });
  assert.equal(resposta.status, 204, await resposta.text());

  const blocos = (await database.query('SELECT url_path, block_id, entered, seconds_visible, clicks FROM analytics_block_signals ORDER BY block_id')).rows;
  assert.deepEqual(blocos, [
    { url_path: '/oferta', block_id: 'botao-1', entered: 1, seconds_visible: 3, clicks: 1 },
    { url_path: '/oferta', block_id: 'secao-topo', entered: 1, seconds_visible: 12, clicks: 1 },
  ]);
  assert.deepEqual((await database.query('SELECT mark FROM analytics_scroll_marks ORDER BY mark')).rows.map((linha) => linha.mark), [25, 50]);

  // Não é acontecimento da jornada: nenhuma linha em analytics_events, nem "ação" no resumo.
  const eventos = (await database.query('SELECT event_name, event_type FROM analytics_events')).rows;
  assert.deepEqual(eventos, [{ event_name: 'pageview', event_type: 'pageview' }]);
  const analytics = new AnalyticsRepository(database);
  const resumo = await analytics.summary({ companyId: conta.company.id, projectId: conta.project.id, actorId: conta.user.id, from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 3_600_000) });
  assert.equal(resumo.custom, 0);
  assert.equal(resumo.pageviews, 1);
  // Nem cria sessão nova: quem mede não vira visita.
  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_sessions')).rows[0].n, 1);
});

test('o coletor recusa lote com texto, campo extra ou tracker desconhecido, e nada é gravado', async (t) => {
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'recusa@alva.test', slug: 'recusa' });
  const base = await iniciar(t, database);
  const ruim = { trackerPublicId: conta.tracker, event_name: 'bloco_sinais', url_path: '/oferta' };
  for (const event_data of [
    { blocos: [{ id: 'a', entrou: 1, segundos: 1, cliques: 0, texto: 'Meu e-mail é a@b.com' }] },
    { blocos: [{ id: 'oi@exemplo.com', entrou: 1, segundos: 1, cliques: 0 }] },
    { rolagem: [33] }, { blocos: [{ id: 'a', entrou: 1, segundos: 9999, cliques: 0 }] },
  ]) assert.equal((await coletar(base, { ...ruim, event_data })).status, 400, JSON.stringify(event_data));
  const desconhecido = await coletar(base, { ...ruim, trackerPublicId: 'trk-nao-existe', event_data: { rolagem: [25] } });
  assert.equal(desconhecido.status, 403);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_block_signals')).rows[0].n, 0);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_scroll_marks')).rows[0].n, 0);
});

test('a rota de leitura agrega por página e por bloco, com o nome do que o dono escreveu', async (t) => {
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'leitura@alva.test', slug: 'leitura' });
  const base = await iniciar(t, database);
  const content = new ContentRepository(database, {});
  const escopo = { companyId: conta.company.id, projectId: conta.project.id, actorId: conta.user.id };
  const pagina = await content.createPage({ ...escopo, name: 'Oferta', route: '/oferta', editorState: paginaInicial('Oferta') });
  const blocos = blocosDaPagina(pagina.editorState);
  const titulo = blocos.find((bloco) => bloco.tipo === 'Título');
  const botao = blocos.find((bloco) => bloco.tipo === 'Botão');
  assert.ok(titulo && botao);

  // Dez visitas; oito veem o título (10 s cada), três clicam no botão.
  for (let visita = 0; visita < 10; visita += 1) {
    await coletar(base, { trackerPublicId: conta.tracker, event_name: 'pageview', url_path: '/oferta' });
    const lote = { rolagem: visita < 6 ? [25, 50] : [25], blocos: [] };
    if (visita < 8) lote.blocos.push({ id: titulo.id, entrou: 1, segundos: 10, cliques: 0 });
    if (visita < 3) lote.blocos.push({ id: botao.id, entrou: 1, segundos: 2, cliques: 1 });
    await coletar(base, { trackerPublicId: conta.tracker, event_name: 'bloco_sinais', url_path: '/oferta', event_data: lote });
  }
  // Um segundo lote da mesma visita (a aba voltou): só soma tempo, não conta nova entrada.
  await coletar(base, { trackerPublicId: conta.tracker, event_name: 'bloco_sinais', url_path: '/oferta', event_data: { blocos: [{ id: titulo.id, entrou: 0, segundos: 20, cliques: 0 }] } });

  const chamar = await entrar(base, conta);
  const resposta = await chamar(`/api/projects/${conta.project.id}/analytics/blocks?${janela()}`);
  assert.equal(resposta.status, 200);
  const { paginas } = await resposta.json();
  assert.equal(paginas.length, 1);
  const [oferta] = paginas;
  assert.equal(oferta.urlPath, '/oferta');
  assert.equal(oferta.nome, 'Oferta');
  assert.equal(oferta.visitas, 10);
  assert.deepEqual(oferta.rolagem.map((m) => [m.marco, m.visitas, m.percentual]), [[25, 10, 100], [50, 6, 60], [75, 0, 0], [100, 0, 0]]);
  const doTitulo = oferta.blocos.find((bloco) => bloco.id === titulo.id);
  assert.deepEqual(doTitulo, { id: titulo.id, tipo: 'Título', rotulo: titulo.rotulo, naPagina: true, entradas: 8, alcance: 80, segundosMedios: 12.5, cliques: 0 });
  const doBotao = oferta.blocos.find((bloco) => bloco.id === botao.id);
  assert.deepEqual({ entradas: doBotao.entradas, alcance: doBotao.alcance, cliques: doBotao.cliques, segundosMedios: doBotao.segundosMedios }, { entradas: 3, alcance: 30, cliques: 3, segundosMedios: 2 });
});

test('a leitura exige sessão e analytics.read, e uma empresa nunca vê os sinais da outra', async (t) => {
  const database = await bancoMigrado(t);
  const a = await semear(database, { email: 'a@alva.test', slug: 'empresa-a' });
  const b = await semear(database, { email: 'b@alva.test', slug: 'empresa-b' });
  const base = await iniciar(t, database);
  await coletar(base, { trackerPublicId: a.tracker, event_name: 'bloco_sinais', url_path: '/a', event_data: { rolagem: [25], blocos: [{ id: 'bloco-a', entrou: 1, segundos: 5, cliques: 0 }] } });
  await coletar(base, { trackerPublicId: b.tracker, event_name: 'bloco_sinais', url_path: '/b', event_data: { blocos: [{ id: 'bloco-b', entrou: 1, segundos: 7, cliques: 0 }] } });

  const anonimo = await fetch(`${base}/api/projects/${a.project.id}/analytics/blocks?${janela()}`, { headers: { Origin: base } });
  assert.equal(anonimo.status, 401);

  const daB = await entrar(base, b);
  const cruzada = await daB(`/api/projects/${a.project.id}/analytics/blocks?${janela()}`);
  assert.ok([403, 404].includes(cruzada.status), `esperava 403/404, veio ${cruzada.status}`);
  const propria = await (await daB(`/api/projects/${b.project.id}/analytics/blocks?${janela()}`)).json();
  assert.deepEqual(propria.paginas.map((pagina) => pagina.urlPath), ['/b']);
  assert.equal(JSON.stringify(propria).includes('bloco-a'), false);

  const semJanela = await daB(`/api/projects/${b.project.id}/analytics/blocks`);
  assert.equal(semJanela.status, 400);
});

test('a retenção também apaga os sinais antigos, e só eles', async (t) => {
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'ret@alva.test', slug: 'ret' });
  const dados = [conta.company.id, conta.project.id, conta.website.id];
  for (const dias of [200, 1]) {
    await database.query("INSERT INTO analytics_block_signals (company_id, project_id, website_id, url_path, block_id, entered, seconds_visible, clicks, created_at) VALUES ($1,$2,$3,'/x','b',1,1,0, now() - ($4 || ' days')::interval)", [...dados, dias]);
    await database.query("INSERT INTO analytics_scroll_marks (company_id, project_id, website_id, url_path, mark, created_at) VALUES ($1,$2,$3,'/x',25, now() - ($4 || ' days')::interval)", [...dados, dias]);
  }
  await new AnalyticsRepository(database).purgeExpired();
  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_block_signals')).rows[0].n, 1);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_scroll_marks')).rows[0].n, 1);
});

// O caminho inteiro, como em produção: a página salva, publicada e desenhada no snapshot que
// sobe para a Vercel; o tracker servido pelo próprio Studio rodando nela; o lote indo ao
// coletor pelo domínio do cliente; e a leitura devolvendo o bloco pelo nome que o dono deu.
test('página publicada de ponta a ponta: o bloco marcado no HTML é o bloco que o relatório nomeia', { timeout: 90_000 }, async (t) => {
  const STUDIO = 'https://studio.example.test';
  const DOMINIO = 'lp.sinais.test';
  const database = await bancoMigrado(t);
  const conta = await semear(database, { email: 'e2e@alva.test', slug: 'e2e' });
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [conta.company.id, conta.project.id, DOMINIO]);
  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const escopo = { companyId: conta.company.id, projectId: conta.project.id, actorId: conta.user.id };
  const pagina = await content.createPage({ ...escopo, name: 'Oferta', route: '/oferta', editorState: paginaInicial('Oferta') });
  await content.publishPage({ ...escopo, pageId: pagina.id, lockVersion: pagina.lockVersion });

  const snapshot = await buildPublishableSnapshot({ database, companyId: conta.company.id, projectId: conta.project.id, publicOrigin: STUDIO, environment: 'production' });
  const manifesto = buildRuntimeManifest({ publicationId: 'sinais-e2e', snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: conta.company.id, projectId: conta.project.id, manifest: manifesto });
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId: 'sinais-e2e', snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: 'raiz-hmac-dos-sinais-de-bloco', runtimeBootstrap: true });
  const html = artefato.files.find((arquivo) => arquivo.file === 'oferta/index.html').data;

  // 1. A página publicada marca os blocos com o id que está salvo, e leva o tracker do projeto.
  const salvos = blocosDaPagina((await content.getPage({ ...escopo, pageId: pagina.id })).editorState);
  const marcados = [...html.matchAll(/data-alva-bloco="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...marcados].sort(), salvos.map((bloco) => bloco.id).filter((id) => !id.startsWith('campo')).sort());
  const tag = html.match(/<script src="([^"]+\/tracker\.js)" data-alva-tracker="([^"]+)" data-host-url="([^"]+)"/);
  assert.ok(tag, 'a página publicada carrega o tracker');

  // 2. O tracker que o Studio serve — não uma cópia — roda nessa página.
  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: true, conversions: false }, runtimeHmacSecret: 'raiz-hmac-dos-sinais-de-bloco' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const porta = app.address().port;
  const servido = await chamarStudio(porta, { method: 'GET', path: '/tracker.js' });
  assert.equal(servido.status, 200);
  assert.match(servido.text, /criarSinaisDeBloco/);

  const dom = new JSDOM(html.replace(/<script[^>]*tracker\.js[^>]*><\/script>/, ''), { url: `https://${DOMINIO}/oferta`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const enviados = [];
  Object.defineProperty(window.navigator, 'sendBeacon', { configurable: true, value: (url, corpo) => { enviados.push({ url, corpo }); return true; } });
  let observador;
  window.IntersectionObserver = class { constructor(f) { this.f = f; observador = this; } observe() {} };
  Object.defineProperty(window.document, 'currentScript', { configurable: true, value: { dataset: { alvaTracker: tag[2], hostUrl: tag[3] } } });
  window.eval(servido.text);
  if (window.document.readyState === 'loading') await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve));

  const titulo = window.document.querySelector('h1').closest('[data-alva-bloco]');
  observador.f([{ target: titulo, isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 100 }, rootBounds: { height: 800 } }]);
  window.document.querySelector('a.cta').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  window.dispatchEvent(new window.Event('pagehide'));
  assert.deepEqual(enviados.map((e) => JSON.parse(e.corpo).event_name), ['pageview', 'bloco_sinais']);
  assert.equal(enviados[0].url, `${STUDIO}/api/public/collect`);

  // 3. O lote entra pelo coletor, vindo do domínio do cliente.
  for (const { corpo } of enviados) {
    const resposta = await chamarStudio(porta, { method: 'POST', path: '/api/public/collect', headers: { origin: `https://${DOMINIO}`, 'content-type': 'text/plain', 'x-forwarded-for': '189.68.172.6' }, body: corpo });
    assert.equal(resposta.status, 204, resposta.text);
  }

  // 4. E o relatório nomeia o bloco pelo que está na página, em ordem.
  const analytics = new AnalyticsRepository(database);
  const intervalo = { companyId: conta.company.id, projectId: conta.project.id, from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) };
  const { paginas } = montarRelatorioDeSinais({ ...(await analytics.blockSignals(intervalo)), paginas: await content.listPages(escopo) });
  assert.equal(paginas.length, 1);
  const doTitulo = paginas[0].blocos.find((bloco) => bloco.id === titulo.getAttribute('data-alva-bloco'));
  assert.equal(doTitulo.tipo, 'Título');
  assert.equal(doTitulo.entradas, 1);
  assert.equal(doTitulo.naPagina, true);
  assert.equal(paginas[0].blocos.find((bloco) => bloco.tipo === 'Botão').cliques, 1);
});
