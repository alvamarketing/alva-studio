import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { CompanyRepository } from '../server/repositories/company-repository.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function createUser(database, { email, name }) {
  const { rows } = await database.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name`,
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

function assertNotFound(operation) {
  return assert.rejects(operation, (error) => error?.statusCode === 404);
}

test('membro editor vê somente projetos concedidos e outra empresa recebe não encontrado', async (t) => {
  await withHarness(t, async ({ database, companies, projects }) => {
    const ownerA = await createUser(database, { email: 'owner-a@example.com', name: 'Owner A' });
    const editorA = await createUser(database, { email: 'editor-a@example.com', name: 'Editor A' });
    const ownerB = await createUser(database, { email: 'owner-b@example.com', name: 'Owner B' });

    const companyA = await companies.create({ ownerUserId: ownerA.id, name: 'Empresa A', slug: 'empresa-a' });
    const companyB = await companies.create({ ownerUserId: ownerB.id, name: 'Empresa B', slug: 'empresa-b' });
    const invitation = await companies.invite({
      companyId: companyA.id,
      actorUserId: ownerA.id,
      email: editorA.email,
      role: 'editor',
    });
    await companies.acceptInvitation({ secret: invitation.secret, userId: editorA.id });

    const granted = await projects.create({
      companyId: companyA.id,
      actorUserId: ownerA.id,
      name: 'Imobiliárias',
      slug: 'imobiliarias',
    });
    await projects.create({
      companyId: companyA.id,
      actorUserId: ownerA.id,
      name: 'Diagnóstico',
      slug: 'diagnostico',
    });
    await projects.grantAccess({
      companyId: companyA.id,
      projectId: granted.id,
      actorUserId: ownerA.id,
      userId: editorA.id,
    });

    const visible = await projects.listForUser({ companyId: companyA.id, userId: editorA.id });
    assert.deepEqual(visible.map((project) => project.slug), ['imobiliarias']);
    await assertNotFound(() =>
      projects.getAuthorized({ companyId: companyA.id, projectId: granted.id, userId: ownerB.id }),
    );
    assert.equal(companyB.slug, 'empresa-b');
  });
});

test('administrador não pode enviar convite de proprietário', async (t) => {
  await withHarness(t, async ({ database, companies }) => {
    const owner = await createUser(database, { email: 'owner@example.com', name: 'Owner' });
    const admin = await createUser(database, { email: 'admin@example.com', name: 'Admin' });

    const company = await companies.create({ ownerUserId: owner.id, name: 'Empresa', slug: 'empresa' });
    const adminInvitation = await companies.invite({
      companyId: company.id,
      actorUserId: owner.id,
      email: admin.email,
      role: 'admin',
    });
    await companies.acceptInvitation({ secret: adminInvitation.secret, userId: admin.id });

    await assert.rejects(
      () =>
        companies.invite({
          companyId: company.id,
          actorUserId: admin.id,
          email: 'new-owner@example.com',
          role: 'owner',
        }),
      (error) => error?.statusCode === 403,
    );
  });
});

test('convite devolve segredo uma única vez e persiste somente seu hash por sete dias', async (t) => {
  await withHarness(t, async ({ database, companies }) => {
    const owner = await createUser(database, { email: 'owner@example.com', name: 'Owner' });
    const invited = await createUser(database, { email: 'invited@example.com', name: 'Invited' });
    const company = await companies.create({ ownerUserId: owner.id, name: 'Empresa', slug: 'empresa' });

    const invitation = await companies.invite({
      companyId: company.id,
      actorUserId: owner.id,
      email: invited.email,
      role: 'analyst',
    });
    assert.match(invitation.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal('secret' in invitation.invitation, false);

    const { rows } = await database.query(
      'SELECT token_hash, expires_at FROM invitations WHERE id = $1',
      [invitation.invitation.id],
    );
    assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(rows[0].token_hash, invitation.secret);
    assert.ok(new Date(rows[0].expires_at).getTime() - Date.now() > 6 * 24 * 60 * 60 * 1000);

    await companies.acceptInvitation({ secret: invitation.secret, userId: invited.id });
    const members = await companies.members({ companyId: company.id, actorUserId: owner.id });
    assert.deepEqual(
      members.map(({ email, role, status }) => ({ email, role, status })),
      [
        { email: 'invited@example.com', role: 'analyst', status: 'active' },
        { email: 'owner@example.com', role: 'owner', status: 'active' },
      ],
    );
  });
});
