import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { BillingPolicy } from '../server/billing-policy.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

test('duas criações concorrentes não ultrapassam a cota transacional de cinco projetos', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  t.after(() => database.close());
  await migrate(database);
  const company = (await database.query(`INSERT INTO companies (name, slug) VALUES ('Cota', 'cota') RETURNING id`)).rows[0];
  const user = (await database.query(`INSERT INTO users (email, password_hash, display_name) VALUES ('owner@cota.test', $1, 'Owner') RETURNING id`, [randomUUID()])).rows[0];
  await database.query(`INSERT INTO company_memberships (company_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [company.id, user.id]);
  for (let index = 1; index <= 4; index += 1) {
    await database.query(`INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4)`, [company.id, `Projeto ${index}`, `projeto-${index}`, user.id]);
  }
  const projects = new ProjectRepository(database, { billingPolicy: new BillingPolicy({ environment: 'sandbox' }) });
  const results = await Promise.allSettled([
    projects.create({ companyId: company.id, actorUserId: user.id, name: 'Projeto 5', slug: 'projeto-5' }),
    projects.create({ companyId: company.id, actorUserId: user.id, name: 'Projeto 6', slug: 'projeto-6' }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'billing_access_required');
  assert.equal((await database.query('SELECT count(*)::int AS count FROM projects WHERE company_id = $1', [company.id])).rows[0].count, 5);
});
