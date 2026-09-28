// A landing do editor novo, publicada como vai à Vercel, recebendo lead.
//
// Salvar no esquema, publicar a versão, montar o snapshot que sobe para a Vercel e enviar
// o formulário pelo gateway que roda lá: o caminho inteiro de uma landing do Puck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { paginaInicial } from '../public/pagina-alva.js';
import { postgresFixture } from './postgres-fixture.mjs';
import { fetchAoStudio, gatewayPublicado } from './gateway-publicado.mjs';

const STUDIO = 'https://studio.example.test';
const DOMINIO = 'lp.exemplo.test';
const RAIZ = 'raiz-hmac-da-landing-publicada';

test('landing do editor novo: publicada, abre com o formulário ligado e recebe o lead', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('lp@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [empresa.id, projeto.id, DOMINIO]);

  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };
  const pagina = await content.createPage({ ...escopo, name: 'Oferta', route: '/oferta', editorState: paginaInicial('Oferta') });
  await content.publishPage({ ...escopo, pageId: pagina.id, lockVersion: pagina.lockVersion });

  const snapshot = await buildPublishableSnapshot({ database, companyId: empresa.id, projectId: projeto.id, publicOrigin: STUDIO, environment: 'production' });
  const publicationId = 'landing-do-puck';
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId, snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: RAIZ, runtimeBootstrap: true });
  const html = artefato.files.find((arquivo) => arquivo.file === 'oferta/index.html').data;
  // O que sobe para a Vercel: a página desenhada no servidor, o formulário apontando para a
  // captura pelo gateway, e nada de React.
  assert.match(html, /<h1 class="alva-titulo">Diga em uma frase o que a pessoa ganha<\/h1>/);
  const acao = html.match(/<form class="alva-form"[^>]*action="([^"]+)"/)?.[1];
  assert.match(acao ?? '', /^\/api\/public\/pages\/oferta\/captures\/[0-9a-f-]{36}\/submissions$/);
  assert.doesNotMatch(html, /react/i);

  const manifesto = buildRuntimeManifest({ publicationId, snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest: manifesto });
  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: true, conversions: false }, runtimeHmacSecret: RAIZ });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const chave = derivePublicationRuntimeKey(RAIZ, { publicationId, snapshotHash: manifesto.snapshotHash, environment: 'production' });
  const gateway = await gatewayPublicado({ artefato, dominio: DOMINIO, fetchImpl: fetchAoStudio(app.address().port), env: { PUBLICATION_RUNTIME_DERIVED_KEY: chave, ALVA_RUNTIME_PUBLICATION_ID: publicationId, ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: STUDIO } });

  const envio = await gateway({
    method: 'POST', path: acao,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, 'x-real-ip': '189.68.172.6', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: Buffer.from('nome=Ana&email=ana%40exemplo.test&whatsapp=11987654321'),
  });
  assert.equal(envio.status, 200, envio.text);
  const lead = (await database.query('SELECT answers FROM page_submissions')).rows[0];
  assert.deepEqual(lead.answers, { nome: 'Ana', email: 'ana@exemplo.test', whatsapp: '11987654321' });
});

// O mesmo defeito, no caminho antigo (GrapesJS): campo de texto virava o tipo do parágrafo,
// e a resposta era apagada.
test('landing antiga: a resposta de um campo de texto chega ao lead', async () => {
  const { extractPageCaptureSchema } = await import('../server/page-capture-schema.mjs');
  const { validatePageCaptureAnswers } = await import('../server/page-capture-schema.mjs');
  const estado = { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': '11111111-1111-4111-8111-111111111111' }, components: [
    { tagName: 'label', components: [{ type: 'textnode', content: 'Nome' }, { tagName: 'input', attributes: { name: 'nome', type: 'text' } }] },
  ] }] };
  const [captura] = extractPageCaptureSchema(estado).forms;
  assert.deepEqual(validatePageCaptureAnswers(captura, { answers: { nome: 'Ana' } }), { nome: 'Ana' });
});
