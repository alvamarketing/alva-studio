import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { CompanyRepository } from '../server/repositories/company-repository.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { NvsCommercialOutboxRepository } from '../server/repositories/nvs-commercial-outbox-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function createUser(database, { email, name }) {
  const { rows } = await database.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email`,
    [email, `hash-${randomUUID()}`, name],
  );
  return rows[0];
}

async function createHarness(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  return {
    database,
    companies: new CompanyRepository(database),
    projects: new ProjectRepository(database),
    content: new ContentRepository(database),
  };
}

async function withHarness(t, run) {
  const harness = await createHarness(t);
  try {
    return await run(harness);
  } finally {
    await harness.database.close();
  }
}

async function projectFor(companies, projects, owner, suffix) {
  const company = await companies.create({
    ownerUserId: owner.id,
    name: `Empresa ${suffix}`,
    slug: `empresa-${suffix}`,
  });
  const project = await projects.create({
    companyId: company.id,
    actorUserId: owner.id,
    name: `Projeto ${suffix}`,
    slug: `projeto-${suffix}`,
  });
  return { company, project };
}

function assertStatus(statusCode) {
  return (error) => error?.statusCode === statusCode;
}

function trackingBindingScope({ companyId, projectId, environment }) {
  return `tracking-binding:${companyId}:${projectId}:${environment}:nvs`;
}

function formSchema(id, title) {
  return {
    headerElements: [],
    steps: [{ id, type: 'short_text', title, required: true }],
    completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
    webhook: '',
  };
}

test('rotas de páginas e formulários são únicas sem distinguir caixa e aceitam a raiz uma única vez', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'owner@rotas.test', name: 'Owner' });
    const { company, project } = await projectFor(companies, projects, owner, 'rotas');

    const root = await content.createPage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Início',
      route: '/',
      editorState: { heading: 'Olá' },
      renderedHtml: '<h1>Olá</h1>',
    });
    assert.equal(root.route, '/');

    await assert.rejects(
      () => content.createForm({
        companyId: company.id,
        projectId: project.id,
        actorId: owner.id,
        name: 'Raiz',
        route: '/',
        draftSchema: formSchema('raiz', 'Raiz'),
      }),
      assertStatus(409),
    );

    await content.createForm({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Contato',
      route: '/Contato',
      draftSchema: formSchema('email', 'E-mail'),
    });
    await assert.rejects(
      () => content.createPage({
        companyId: company.id,
        projectId: project.id,
        actorId: owner.id,
        name: 'Outra página',
        route: '/contato',
        editorState: {},
        renderedHtml: '',
      }),
      assertStatus(409),
    );
  });
});

test('conteúdo de outra empresa responde como não encontrado', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const ownerA = await createUser(database, { email: 'owner-a@isolamento.test', name: 'Owner A' });
    const ownerB = await createUser(database, { email: 'owner-b@isolamento.test', name: 'Owner B' });
    const first = await projectFor(companies, projects, ownerA, 'primeira');
    const second = await projectFor(companies, projects, ownerB, 'segunda');
    const page = await content.createPage({
      companyId: first.company.id,
      projectId: first.project.id,
      actorId: ownerA.id,
      name: 'Privada',
      route: '/privada',
      editorState: {},
      renderedHtml: '',
    });

    await assert.rejects(
      () => content.getPage({
        companyId: second.company.id,
        projectId: second.project.id,
        actorId: ownerB.id,
        pageId: page.id,
      }),
      assertStatus(404),
    );
  });
});

test('duas alterações com a mesma revisão deixam uma salva e outra em conflito', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'owner@concorrencia.test', name: 'Owner' });
    const { company, project } = await projectFor(companies, projects, owner, 'concorrencia');
    const page = await content.createPage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Página',
      route: '/pagina',
      editorState: { heading: 'Antes' },
      renderedHtml: '<h1>Antes</h1>',
    });

    const first = content.updatePage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      pageId: page.id,
      lockVersion: 0,
      editorState: { heading: 'Primeira alteração' },
      renderedHtml: '<h1>Primeira alteração</h1>',
    });
    const second = content.updatePage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      pageId: page.id,
      lockVersion: 0,
      editorState: { heading: 'Segunda alteração' },
      renderedHtml: '<h1>Segunda alteração</h1>',
    });
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);
    const fulfilled = [firstResult, secondResult].filter((result) => result.status === 'fulfilled');
    const rejected = [firstResult, secondResult].filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(fulfilled[0].value.lockVersion, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 409);
  });
});

test('rascunho de formulário não altera a versão pública publicada', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'owner@versao.test', name: 'Owner' });
    const { company, project } = await projectFor(companies, projects, owner, 'versao');
    const form = await content.createForm({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Diagnóstico',
      route: '/diagnostico',
      draftSchema: formSchema('nome', 'Nome'),
    });
    const firstVersion = await content.publishForm({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      formId: form.id,
    });
    assert.equal(firstVersion.versionNumber, 1);

    const updated = await content.updateForm({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      formId: form.id,
      lockVersion: form.lockVersion,
      route: '/novo-diagnostico',
      draftSchema: formSchema('empresa', 'Empresa'),
    });
    assert.equal(updated.lockVersion, 1);

    const publicForm = await content.getPublicContent({
      companyId: company.id,
      projectId: project.id,
      route: '/diagnostico',
    });
    assert.equal(publicForm.type, 'form');
    assert.equal(publicForm.schema.steps[0].id, 'nome');
    assert.equal(publicForm.schema.steps[0].title, 'Nome');
    await assert.rejects(
      () => content.getPublicContent({ companyId: company.id, projectId: project.id, route: '/novo-diagnostico' }),
      assertStatus(404),
    );

    await content.publishForm({ companyId: company.id, projectId: project.id, actorId: owner.id, formId: form.id });
    const republished = await content.getPublicContent({
      companyId: company.id,
      projectId: project.id,
      route: '/novo-diagnostico',
    });
    assert.equal(republished.schema.steps[0].id, 'empresa');
    assert.equal(republished.schema.steps[0].title, 'Empresa');
    await assert.rejects(
      () => content.getPublicContent({ companyId: company.id, projectId: project.id, route: '/diagnostico' }),
      assertStatus(404),
    );
  });
});

test('a rota pública só muda quando a página é republicada', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'owner@pagina-publica.test', name: 'Owner' });
    const { company, project } = await projectFor(companies, projects, owner, 'pagina-publica');
    const page = await content.createPage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Oferta',
      route: '/oferta',
      editorState: { title: 'Publicado' },
      renderedHtml: '<h1>Publicado</h1>',
    });
    await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    await content.updatePage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      pageId: page.id,
      lockVersion: 0,
      route: '/novo',
      editorState: { title: 'Rascunho' },
      renderedHtml: '<h1>Rascunho</h1>',
    });

    const published = await content.getPublicContent({
      companyId: company.id,
      projectId: project.id,
      route: '/OFERTA',
    });
    assert.equal(published.type, 'page');
    assert.equal(published.renderedHtml, '<h1>Publicado</h1>');
    assert.deepEqual(published.editorState, { title: 'Publicado' });
    await assert.rejects(
      () => content.getPublicContent({ companyId: company.id, projectId: project.id, route: '/novo' }),
      assertStatus(404),
    );

    await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    const republished = await content.getPublicContent({
      companyId: company.id,
      projectId: project.id,
      route: '/novo',
    });
    assert.equal(republished.renderedHtml, '<h1>Rascunho</h1>');
    await assert.rejects(
      () => content.getPublicContent({ companyId: company.id, projectId: project.id, route: '/oferta' }),
      assertStatus(404),
    );
  });
});

test('estado da página preserva a referência pública da VSL sem configuração de player', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'owner@pagina-vsl.test', name: 'Owner' });
    const { company, project } = await projectFor(companies, projects, owner, 'pagina-vsl');
    const editorState = { components: [{ type: 'vsl', publicId: 'public-vsl-123456' }] };
    const page = await content.createPage({
      companyId: company.id,
      projectId: project.id,
      actorId: owner.id,
      name: 'Página com VSL',
      route: '/vsl',
      editorState,
      renderedHtml: '<div data-alva-vsl="public-vsl-123456"></div>',
    });
    const loaded = await content.getPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    assert.deepEqual(loaded.editorState, editorState);
    assert.doesNotMatch(JSON.stringify(loaded.editorState), /sourceUrl|cta|version/i);
  });
});

test('captura Landing congela schema por versão e mantém isolamento', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'capture@alva.test', name: 'Capture' });
    const { company, project } = await projectFor(companies, projects, owner, 'capture');
    const state = { components: [{ tagName: 'form', components: [{ tagName: 'h3', components: [{ type: 'textnode', content: 'Contato' }] }, { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { type: 'alva-field', attributes: { name: 'email', type: 'email', required: '' } }] }] }] };
    const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: owner.id, name: 'Landing', route: '/landing', editorState: state, renderedHtml: '<form></form>' });
    const a = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: page.lockVersion });
    const captureId = a.editorState.components[0].attributes['data-alva-capture-id'];
    const changed = await content.updatePage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: page.lockVersion, editorState: { ...a.editorState, components: [{ ...a.editorState.components[0], components: [...a.editorState.components[0].components, { tagName: 'label', components: [{ type: 'textnode', content: 'Nome' }, { type: 'alva-field', attributes: { name: 'nome', type: 'text', required: '' } }] }] }] } });
    const b = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: changed.lockVersion });
    const domain = 'landing.alva.test';
    await database.query("INSERT INTO project_domains (company_id, project_id, domain, environment, verification_status, is_canonical) VALUES ($1,$2,$3,'production','verified',true)", [company.id, project.id, domain]);
    const lead = await content.submitPublishedPageCapture({ companyId: company.id, projectId: project.id, pageId: page.id, pageVersionId: a.id, captureId, input: { answers: { email: 'lead@alva.test' } }, origin: `https://${domain}` });
    assert.ok(lead.id);
    await assert.rejects(() => content.submitPublishedPageCapture({ companyId: company.id, projectId: project.id, pageId: page.id, pageVersionId: a.id, captureId, input: { answers: { email: 'lead@alva.test', nome: 'não cabe em A' } }, origin: `https://${domain}` }), /Campo de resposta inválido/);
    assert.notEqual(a.id, b.id);
  });
});

test('capture Landing faz rollback de outbox/webhook e preserva eventId na entrega', async (t) => {
  await withHarness(t, async ({ database, companies, projects, content }) => {
    const owner = await createUser(database, { email: 'atomic@alva.test', name: 'Atomic' });
    const { company, project } = await projectFor(companies, projects, owner, 'atomic');
    const state = { components: [{ tagName: 'form', components: [{ tagName: 'h3', components: [{ type: 'textnode', content: 'Contato' }] }, { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { type: 'alva-field', attributes: { name: 'email', type: 'email', required: '' } }] }] }] };
    let page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: owner.id, name: 'Landing', route: '/atomic', editorState: state, renderedHtml: '<form></form>' });
    await content.updatePageSettings({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, webhook: 'https://hooks.example.test/lead' });
    page = await content.getPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    const version = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: page.lockVersion });
    const captureId = version.editorState.components[0].attributes['data-alva-capture-id'];
    const domain = 'atomic.alva.test';
    await database.query("INSERT INTO project_domains (company_id, project_id, domain, environment, verification_status, is_canonical) VALUES ($1,$2,$3,'production','verified',true)", [company.id, project.id, domain]);
    const args = { companyId: company.id, projectId: project.id, pageId: page.id, pageVersionId: version.id, captureId, input: { answers: { email: 'lead@alva.test' } }, origin: `https://${domain}` };
    content.commercialOutbox = { enqueue: async () => { throw new Error('outbox'); } };
    await assert.rejects(() => content.submitPublishedPageCapture(args), /outbox/);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 0);
    const vault = new SecretVault({ masterKey: 'page-capture-rollback-test-key' });
    await database.query(
      `UPDATE tracking_bindings SET status = 'ready', encrypted_remote_reference = $4
       WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'nvs'`,
      [company.id, project.id, 'production', vault.encrypt('page_capture_property', trackingBindingScope({ companyId: company.id, projectId: project.id, environment: 'production' }))],
    );
    content.commercialOutbox = new NvsCommercialOutboxRepository(database, { vault });
    const original = content.webhookDeliveries.enqueue.bind(content.webhookDeliveries);
    content.webhookDeliveries.enqueue = async () => { throw new Error('webhook'); };
    await assert.rejects(() => content.submitPublishedPageCapture(args), /webhook/);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM page_submissions')).rows[0].n, 0);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2', [company.id, project.id])).rows[0].n, 0);
    content.webhookDeliveries.enqueue = original;
    const submitted = await content.submitPublishedPageCapture(args);
    const delivery = (await database.query("SELECT source_kind, page_id, page_submission_id, event FROM webhook_deliveries WHERE source_kind = 'page'")).rows[0];
    assert.equal(delivery.source_kind, 'page'); assert.equal(delivery.page_id, page.id);
    assert.equal(delivery.event.eventId, submitted.eventId);
    assert.equal((await database.query('SELECT tracking_event_id FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2', [company.id, project.id])).rows[0].tracking_event_id, submitted.eventId);
    assert.equal((await content.webhookDeliveries.claimNextDue()).delivery.sourceKind, 'page');
  });
});
