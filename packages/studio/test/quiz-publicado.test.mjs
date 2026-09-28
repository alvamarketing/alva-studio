// O quiz do editor novo, publicado como vai à Vercel, recebendo lead pelo caminho ramificado.
//
// Mesmo trajeto da landing (test/landing-publicada.test.mjs): esquema → versão → snapshot
// → gateway. O que muda é o que o quiz precisa lá: a captura única com a action do gateway,
// o runtime com o nonce da CSP e as respostas em JSON, validadas etapa a etapa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { estadoDoQuiz, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { postgresFixture } from './postgres-fixture.mjs';
import { fetchAoStudio, gatewayPublicado } from './gateway-publicado.mjs';

const STUDIO = 'https://studio.example.test';
const DOMINIO = 'lp.exemplo.test';
const RAIZ = 'raiz-hmac-do-quiz-publicado';

test('quiz do editor novo: publicado com o runtime liberado pela CSP e recebendo o lead', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('qz@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [empresa.id, projeto.id, DOMINIO]);

  // A pergunta do quiz inicial ganha um atalho: "Ainda estou pesquisando" vai direto à tela final.
  const estado = normalizarEstadoAlva(estadoDoQuiz('Diagnóstico'));
  const final = estado.content.at(-1).id;
  estado.content[1].children[0].props.opcoes[3].destino = final;
  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };
  const quiz = await content.createPage({ ...escopo, name: 'Diagnóstico', route: '/diagnostico', kind: 'quiz', editorState: estado });
  await content.publishPage({ ...escopo, pageId: quiz.id, lockVersion: quiz.lockVersion });

  const snapshot = await buildPublishableSnapshot({ database, companyId: empresa.id, projectId: projeto.id, publicOrigin: STUDIO, environment: 'production' });
  const publicationId = 'quiz-do-puck';
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId, snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: RAIZ, runtimeBootstrap: true });
  const html = artefato.files.find((arquivo) => arquivo.file === 'diagnostico/index.html').data;
  assert.match(html, /<body data-alva-quiz="true"/);
  const acao = html.match(/<form class="alva-quiz"[^>]*action="([^"]+)"/)?.[1];
  assert.match(acao ?? '', /^\/api\/public\/pages\/diagnostico\/captures\/[0-9a-f-]{36}\/submissions$/);
  // O runtime do quiz é script em linha: só roda se levar o mesmo nonce que a CSP libera.
  const nonceDaCsp = html.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
  assert.ok(nonceDaCsp, 'a página publicada tem CSP com nonce');
  assert.doesNotMatch(html, /__ALVA_RUNTIME_NONCE__/);
  assert.match(html, new RegExp(`<script nonce="${nonceDaCsp}">\\(\\(\\)=>\\{`));
  assert.doesNotMatch(html, /react/i);

  const manifesto = buildRuntimeManifest({ publicationId, snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest: manifesto });
  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: true, conversions: false }, runtimeHmacSecret: RAIZ });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const chave = derivePublicationRuntimeKey(RAIZ, { publicationId, snapshotHash: manifesto.snapshotHash, environment: 'production' });
  const gateway = await gatewayPublicado({ artefato, dominio: DOMINIO, fetchImpl: fetchAoStudio(app.address().port), env: { PUBLICATION_RUNTIME_DERIVED_KEY: chave, ALVA_RUNTIME_PUBLICATION_ID: publicationId, ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: STUDIO } });

  const pergunta = (await database.query('SELECT capture_schema FROM page_versions')).rows[0].capture_schema.forms[0].fields[0].id;
  // O caminho que pulou o contato: só a pergunta, e o servidor aceita.
  const envio = await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/json', origin: `https://${DOMINIO}`, 'x-real-ip': '189.68.172.6', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: Buffer.from(JSON.stringify({ answers: { [pergunta]: 'Ainda estou pesquisando' } })),
  });
  assert.equal(envio.status, 200, envio.text);
  // O caminho normal sem o e-mail obrigatório do contato é recusado.
  const incompleto = await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/json', origin: `https://${DOMINIO}`, 'x-real-ip': '189.68.172.7', 'user-agent': 'Mozilla/5.0 (Android)' },
    body: Buffer.from(JSON.stringify({ answers: { [pergunta]: 'Vender mais', nome: 'Ana' } })),
  });
  assert.equal(incompleto.status, 400, incompleto.text);
  const leads = (await database.query('SELECT answers FROM page_submissions')).rows;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].answers[pergunta], 'Ainda estou pesquisando');
});
