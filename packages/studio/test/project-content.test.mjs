import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { CompanyRepository } from '../server/repositories/company-repository.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
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
