import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapOwner } from '../server/bootstrap-owner.mjs';
import { createDatabase } from '../server/db/postgres.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const OWNER = {
  name: 'Proprietário Inicial',
  email: 'Owner@Alva.test',
  password: 'senha-inicial-segura',
  companyName: 'Alva Marketing',
};

async function counts(database) {
  const { rows } = await database.query(`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM companies)::int AS companies,
           (SELECT count(*) FROM company_memberships WHERE role = 'owner' AND status = 'active')::int AS owners,
           (SELECT count(*) FROM projects)::int AS projects
  `);
  return rows[0];
}

test('bootstrap migra o banco vazio, cria a primeira conta e não repete', async (t) => {
  const { connectionString } = await postgresFixture(t);

  const created = await bootstrapOwner({ connectionString, ...OWNER });
  assert.deepEqual(created, { created: true, email: 'owner@alva.test', companySlug: 'alva-marketing' });

  const database = createDatabase({ connectionString });
  try {
    assert.deepEqual(await counts(database), { users: 1, companies: 1, owners: 1, projects: 1 });

    const repeated = await bootstrapOwner({ connectionString, ...OWNER });
    assert.deepEqual(repeated, { created: false });
    assert.deepEqual(await counts(database), { users: 1, companies: 1, owners: 1, projects: 1 });
  } finally {
    await database.close();
  }
});
