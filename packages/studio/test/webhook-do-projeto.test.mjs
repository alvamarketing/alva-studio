import assert from 'node:assert/strict';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildRuntimeManifest, signRuntimeRequest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey } from '../server/vercel-runtime-gateway.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const scrypt = promisify(scryptCallback);
const SENHA = 'senha-do-teste-segura';
const SEGREDO_RAIZ = 'root-secret-only-at-studio';
const URL_DO_PROJETO = 'https://crm.example.test/projeto';
const URL_DA_PAGINA = 'https://crm.example.test/so-esta-pagina';

async function senhaLegada(password) {
  const salt = randomBytes(16).toString('hex');
  return JSON.stringify({ salt, hash: (await scrypt(password, salt, 64)).toString('hex') });
}

function http(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// O servidor sobe com publicOrigin (como em produção), então o painel só responde no host
// do Studio: o cliente fala com ele pelo Host e pela Origin certos.
function cliente(base) {
  let cookie = '';
  const request = async (path, method = 'GET', body) => {
    const resposta = await http(base, path, {
      method,
      headers: { Host: 'studio.example.test', Origin: 'https://studio.example.test', Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const novo = [resposta.headers['set-cookie']].flat().filter(Boolean)[0];
    if (novo) cookie = novo.split(';')[0];
    return resposta;
  };
  return { request };
}

async function cenario(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const usuario = async (email, nome) => (await database.query(
    'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id',
    [email, await senhaLegada(SENHA), nome],
  )).rows[0];
  const dono = await usuario('dono@alva.test', 'Dono');
  const editor = await usuario('editor@alva.test', 'Editor');
  const empresa = (await database.query("INSERT INTO companies (name, slug) VALUES ('Acme', 'acme') RETURNING id")).rows[0];
  const outraEmpresa = (await database.query("INSERT INTO companies (name, slug) VALUES ('Beta', 'beta') RETURNING id")).rows[0];
  await database.query(
    `INSERT INTO company_memberships (company_id, user_id, role, joined_at)
     VALUES ($1, $2, 'owner', now()), ($3, $2, 'owner', now()), ($1, $4, 'editor', now())`,
    [empresa.id, dono.id, outraEmpresa.id, editor.id],
  );
  const projeto = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Landing','landing',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  const outroProjeto = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'Outro','outro',$2) RETURNING id", [outraEmpresa.id, dono.id])).rows[0];
  const vinculo = (await database.query('SELECT id FROM company_memberships WHERE company_id = $1 AND user_id = $2', [empresa.id, editor.id])).rows[0];
  await database.query('INSERT INTO project_grants (company_id, membership_id, project_id) VALUES ($1,$2,$3)', [empresa.id, vinculo.id, projeto.id]);
  await database.query("INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status) VALUES ($1,$2,'production','lp.example.test',true,'verified')", [empresa.id, projeto.id]);
  return { database, dono, editor, empresa, projeto, outroProjeto };
}

async function subir(t, database) {
  // O worker de entrega fica desligado: o que se prova aqui é para ONDE o lead foi
  // enfileirado, e um worker ligado tentaria sair para a internet de verdade.
  const app = createApp({ database, publicOrigin: 'https://studio.example.test', runtimeFlags: { pixels: false, conversions: false }, runtimeHmacSecret: SEGREDO_RAIZ, webhookWorkerEnabled: false });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  return `http://127.0.0.1:${app.address().port}`;
}

async function entrar(base, email) {
  const sessao = cliente(base);
  const login = await sessao.request('/api/login', 'POST', { email, password: SENHA });
  assert.equal(login.status, 200, login.text);
  return sessao;
}

const estadoDoFormulario = { components: [{ tagName: 'form', components: [
  { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { type: 'alva-field', attributes: { name: 'email', type: 'email', required: '' } }] },
] }] };

async function paginaPublicada(content, { empresa, projeto, dono }, nome, rota) {
  const page = await content.createPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, name: nome, route: rota, editorState: estadoDoFormulario, renderedHtml: '<form></form>' });
  return page;
}

async function publicar(content, { empresa, projeto, dono }, page) {
  const atual = await content.getPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, pageId: page.id });
  const version = await content.publishPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, pageId: page.id, lockVersion: atual.lockVersion });
  return { version, captureId: version.editorState.components[0].attributes['data-alva-capture-id'] };
}

// Atravessa o caminho público real: requisição assinada do gateway -> rota pública ->
// submitPublishedPageCapture. É o mesmo caminho que o lead de um visitante percorre.
function enviador(base, manifest) {
  const chave = derivePublicationRuntimeKey(SEGREDO_RAIZ, { publicationId: manifest.publicationId, snapshotHash: manifest.snapshotHash, environment: manifest.environment });
  let contador = 0;
  return async (rota, captureId, email) => {
    const path = `/api/public/pages${rota}/captures/${captureId}/submissions`;
    const body = Buffer.from(`email=${encodeURIComponent(email)}`);
    const nonce = `nonce-webhook-projeto-${contador += 1}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      Host: 'studio.example.test', Origin: 'https://lp.example.test', 'Content-Type': 'application/x-www-form-urlencoded',
      'x-alva-runtime-gateway': '1', 'x-alva-public-host': 'lp.example.test', 'x-alva-publication-id': manifest.publicationId,
      'x-alva-runtime-environment': 'production', 'x-alva-runtime-timestamp': String(timestamp), 'x-alva-runtime-nonce': nonce,
      'x-alva-runtime-signature': signRuntimeRequest({ method: 'POST', path, publicationId: manifest.publicationId, environment: 'production', timestamp, nonce, body }, chave),
    };
    const resposta = await http(base, path, { method: 'POST', body, headers });
    assert.equal(resposta.status, 200, resposta.text);
  };
}

test('migração 031: uma linha por projeto, só https, amarrada à empresa do projeto', async (t) => {
  const { database, empresa, projeto, outroProjeto } = await cenario(t);
  t.after(() => database.close());
  await database.query('INSERT INTO project_lead_webhooks (company_id, project_id, url) VALUES ($1,$2,$3)', [empresa.id, projeto.id, URL_DO_PROJETO]);
  await assert.rejects(() => database.query('INSERT INTO project_lead_webhooks (company_id, project_id, url) VALUES ($1,$2,$3)', [empresa.id, projeto.id, URL_DA_PAGINA]), /duplicate key/);
  await assert.rejects(() => database.query('INSERT INTO project_lead_webhooks (company_id, project_id, url) VALUES ($1,$2,$3)', [empresa.id, outroProjeto.id, URL_DO_PROJETO]), /violates foreign key/);
});

test('rotas do webhook do projeto: salvar, ler, trocar, remover e recusar o que não é https', async (t) => {
  const { database, empresa, projeto } = await cenario(t);
  const base = await subir(t, database);
  const dono = await entrar(base, 'dono@alva.test');
  const rota = `/api/projects/${projeto.id}/lead-webhook`;

  const vazio = await (await dono.request(rota)).json();
  assert.deepEqual(vazio, { configured: false, url: '' });

  const salvo = await dono.request(rota, 'PUT', { url: URL_DO_PROJETO });
  assert.equal(salvo.status, 200, salvo.text);
  assert.deepEqual(await salvo.json(), { configured: true, url: URL_DO_PROJETO });
  assert.deepEqual(await (await dono.request(rota)).json(), { configured: true, url: URL_DO_PROJETO });

  // Salvar de novo troca o destino, não cria uma segunda linha.
  assert.equal((await dono.request(rota, 'PUT', { url: URL_DA_PAGINA })).status, 200);
  assert.deepEqual(await (await dono.request(rota)).json(), { configured: true, url: URL_DA_PAGINA });
  assert.equal((await database.query('SELECT count(*)::int AS n FROM project_lead_webhooks WHERE company_id = $1', [empresa.id])).rows[0].n, 1);

  // A mesma proteção do webhook de página: nada de http, de credencial na URL ou de lixo.
  for (const ruim of ['http://crm.example.test/x', 'https://usuario:senha@crm.example.test/x', 'não é url', 'ftp://crm.example.test/x']) {
    assert.equal((await dono.request(rota, 'PUT', { url: ruim })).status, 400, ruim);
  }
  assert.deepEqual(await (await dono.request(rota)).json(), { configured: true, url: URL_DA_PAGINA }, 'recusar não pode apagar o que já estava salvo');

  assert.equal((await dono.request(rota, 'PUT', { remove: true })).status, 200);
  assert.deepEqual(await (await dono.request(rota)).json(), { configured: false, url: '' });
  await dono.request(rota, 'PUT', { url: URL_DO_PROJETO });
  assert.equal((await dono.request(rota, 'PUT', { url: '   ' })).status, 200, 'URL vazia também remove');
  assert.deepEqual(await (await dono.request(rota)).json(), { configured: false, url: '' });
});

test('rotas do webhook do projeto exigem integration.manage e respeitam o isolamento entre empresas', async (t) => {
  const { database, projeto, outroProjeto } = await cenario(t);
  const base = await subir(t, database);
  const dono = await entrar(base, 'dono@alva.test');
  const editor = await entrar(base, 'editor@alva.test');
  const rota = `/api/projects/${projeto.id}/lead-webhook`;
  await dono.request(rota, 'PUT', { url: URL_DO_PROJETO });

  assert.equal((await editor.request(rota)).status, 403);
  assert.equal((await editor.request(rota, 'PUT', { url: URL_DA_PAGINA })).status, 403);
  assert.equal((await editor.request(rota, 'PUT', { remove: true })).status, 403);
  assert.equal((await database.query('SELECT url FROM project_lead_webhooks').then((r) => r.rows[0].url)), URL_DO_PROJETO);

  // O dono é membro das duas empresas, mas a sessão está na Acme: o projeto da Beta não
  // pode ser lido nem alterado por esta rota enquanto o contexto for outro.
  const alheia = `/api/projects/${outroProjeto.id}/lead-webhook`;
  assert.notEqual((await dono.request(alheia, 'PUT', { url: URL_DA_PAGINA })).status, 200);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM project_lead_webhooks WHERE project_id = $1', [outroProjeto.id])).rows[0].n, 0);
});

test('lead enviado pela rota pública: sem webhook de página entrega na URL do projeto; com webhook de página, só na dela', async (t) => {
  const contexto = await cenario(t);
  const { database, dono: donoDb, empresa, projeto } = contexto;
  const base = await subir(t, database);
  const dono = await entrar(base, 'dono@alva.test');
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const alvo = { empresa, projeto, dono: donoDb };

  const semDestino = await paginaPublicada(content, alvo, 'Sem destino', '/sem-destino');
  const comDestino = await paginaPublicada(content, alvo, 'Com destino', '/com-destino');
  // O destino da página é gravado pela mesma rota que o editor usa.
  const atual = await (await dono.request(`/api/pages/${comDestino.id}`)).json();
  assert.equal((await dono.request(`/api/pages/${comDestino.id}`, 'PUT', { revision: atual.revision, webhook: URL_DA_PAGINA })).status, 200);

  const a = await publicar(content, alvo, semDestino);
  const b = await publicar(content, alvo, comDestino);
  const manifest = buildRuntimeManifest({
    publicationId: 'webhook-do-projeto', snapshotHash: 'e'.repeat(64), origin: 'https://lp.example.test', domain: 'lp.example.test', environment: 'production',
    contents: [
      { path: '/sem-destino', type: 'page', contentId: semDestino.id, versionId: a.version.id, captureIds: [a.captureId] },
      { path: '/com-destino', type: 'page', contentId: comDestino.id, versionId: b.version.id, captureIds: [b.captureId] },
    ],
  });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest });
  const enviar = enviador(base, manifest);
  const entregas = async () => (await database.query(
    `SELECT delivery.page_id, delivery.url FROM webhook_deliveries delivery
     JOIN page_submissions submission ON submission.id = delivery.page_submission_id
     ORDER BY submission.submitted_at`,
  )).rows.map((row) => ({ pagina: row.page_id, url: row.url }));

  // 1. Projeto sem webhook e página sem webhook: o lead entra, mas não há para onde copiar.
  await enviar('/sem-destino', a.captureId, 'zero@example.test');
  assert.deepEqual(await entregas(), []);

  // 2. O dono configura o projeto DEPOIS de publicar: vale já, sem republicar.
  const rota = `/api/projects/${projeto.id}/lead-webhook`;
  assert.equal((await dono.request(rota, 'PUT', { url: URL_DO_PROJETO })).status, 200);
  await enviar('/sem-destino', a.captureId, 'um@example.test');
  assert.deepEqual(await entregas(), [{ pagina: semDestino.id, url: URL_DO_PROJETO }]);

  // 3. Página com destino próprio sobrescreve: o lead vai SÓ para a URL dela.
  await enviar('/com-destino', b.captureId, 'dois@example.test');
  const todas = await entregas();
  assert.equal(todas.length, 2, 'um lead, uma entrega: o do projeto não pode duplicar o da página');
  assert.deepEqual(todas[1], { pagina: comDestino.id, url: URL_DA_PAGINA });

  // 4. Removido o do projeto, a página sem destino volta a não entregar nada.
  await dono.request(rota, 'PUT', { remove: true });
  await enviar('/sem-destino', a.captureId, 'tres@example.test');
  assert.equal((await entregas()).length, 2);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 4);
});

test('a página informa que usa o webhook do projeto, só com o host e sem a URL', async (t) => {
  const { database, dono: donoDb, empresa, projeto } = await cenario(t);
  const base = await subir(t, database);
  const dono = await entrar(base, 'dono@alva.test');
  const editor = await entrar(base, 'editor@alva.test');
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const page = await paginaPublicada(content, { empresa, projeto, dono: donoDb }, 'Página', '/pagina');

  assert.equal((await (await dono.request(`/api/pages/${page.id}`)).json()).projectWebhookHost, '');
  await dono.request(`/api/projects/${projeto.id}/lead-webhook`, 'PUT', { url: 'https://crm.example.test/projeto/segredo-no-caminho?token=abc' });
  for (const quem of [dono, editor]) {
    const texto = await (await quem.request(`/api/pages/${page.id}`)).text;
    assert.equal(JSON.parse(texto).projectWebhookHost, 'crm.example.test');
    assert.ok(!texto.includes('segredo-no-caminho') && !texto.includes('token=abc'), 'a URL inteira não pode vazar para quem só edita a página');
  }
});
