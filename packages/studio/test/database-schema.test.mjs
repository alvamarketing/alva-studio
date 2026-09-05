import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresFixture } from './postgres-fixture.mjs';

const sourceMigrations = join(fileURLToPath(new URL('../server/db/migrations/', import.meta.url)));

const expectedTables = [
  'users',
  'companies',
  'company_memberships',
  'invitations',
  'project_grants',
  'sessions',
  'projects',
  'pages',
  'page_versions',
  'forms',
  'form_versions',
  'form_submissions',
  'project_domains',
  'project_integrations',
  'company_secrets',
  'deployment_runs',
  'audit_events',
  'project_routes',
];

const violates = (error) => error?.code === '23503' || error?.code === '23505' || error?.code === '23514';

async function migratedDatabase(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}

async function row(database, query, values = []) {
  return (await database.query(query, values)).rows[0];
}

async function seedProject(database, { email, companyName, slug }) {
  const user = await row(
    database,
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id",
    [email],
  );
  const company = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [companyName, slug]);
  const membership = await row(
    database,
    "INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now()) RETURNING id",
    [company.id, user.id],
  );
  const project = await row(
    database,
    'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [company.id, companyName, slug, user.id],
  );
  return { user, company, membership, project };
}

async function route(database, seed, path, contentType) {
  return row(
    database,
    'INSERT INTO project_routes (company_id, project_id, path, content_type) VALUES ($1, $2, $3, $4) RETURNING id',
    [seed.company.id, seed.project.id, path, contentType],
  );
}

async function page(database, seed, path = '/') {
  const pageRoute = await route(database, seed, path, 'page');
  return row(
    database,
    "INSERT INTO pages (company_id, project_id, route_id, name, editor_state, created_by) VALUES ($1, $2, $3, 'Página', $4::jsonb, $5) RETURNING id, editor_state",
    [seed.company.id, seed.project.id, pageRoute.id, '{"heading":"Olá"}', seed.user.id],
  );
}

async function form(database, seed, path = '/form') {
  const formRoute = await route(database, seed, path, 'form');
  return row(
    database,
    "INSERT INTO forms (company_id, project_id, route_id, name, draft_schema, created_by) VALUES ($1, $2, $3, 'Formulário', $4::jsonb, $5) RETURNING id, draft_schema",
    [seed.company.id, seed.project.id, formRoute.id, '{"fields":["email"]}', seed.user.id],
  );
}

test('migrador cria as tabelas SaaS e pode ser executado duas vezes', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  try {
    await migrate(database);
    await migrate(database);

    const { rows } = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = new Set(rows.map(({ table_name: tableName }) => tableName));
    for (const tableName of expectedTables) assert.ok(tableNames.has(tableName), `faltou a tabela ${tableName}`);
  } finally {
    await database.close();
  }
});

test('migrador interrompe uma versão já aplicada quando o arquivo muda', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const migrationsPath = await mkdtemp(join(tmpdir(), 'alva-migrations-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(migrationsPath, { recursive: true, force: true })));
  const migrationPath = join(migrationsPath, '001_example.sql');

  try {
    await writeFile(migrationPath, 'CREATE TABLE example_rows (id integer PRIMARY KEY);');
    await migrate(database, { migrationsPath });
    await writeFile(migrationPath, 'CREATE TABLE example_rows (id bigint PRIMARY KEY);');

    await assert.rejects(() => migrate(database, { migrationsPath }), /checksum/i);
  } finally {
    await database.close();
  }
});

test('migração de convites atualiza um banco que já aplicou somente a fundação 001', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const temporaryMigrations = await mkdtemp(join(tmpdir(), 'alva-migrations-legacy-'));
  t.after(() => rm(temporaryMigrations, { recursive: true, force: true }));

  try {
    await writeFile(join(temporaryMigrations, '001_saas_foundation.sql'), await readFile(join(sourceMigrations, '001_saas_foundation.sql')));
    await migrate(database, { migrationsPath: temporaryMigrations });
    const before = await database.query("SELECT to_regclass('public.invitations') AS invitations");
    assert.equal(before.rows[0].invitations, null);

    await writeFile(join(temporaryMigrations, '002_invitations.sql'), await readFile(join(sourceMigrations, '002_invitations.sql')));
    await migrate(database, { migrationsPath: temporaryMigrations });
    const after = await database.query("SELECT to_regclass('public.invitations') AS invitations");
    assert.equal(after.rows[0].invitations, 'invitations');
  } finally {
    await database.close();
  }
});

test('upgrade de 001 populada preserva rotas publicadas e imutabilidade dos snapshots', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const temporaryMigrations = await mkdtemp(join(tmpdir(), 'alva-migrations-upgrade-'));
  t.after(() => rm(temporaryMigrations, { recursive: true, force: true }));

  try {
    await writeFile(join(temporaryMigrations, '001_saas_foundation.sql'), await readFile(join(sourceMigrations, '001_saas_foundation.sql')));
    await migrate(database, { migrationsPath: temporaryMigrations });

    const seed = await seedProject(database, { email: 'upgrade@alva.test', companyName: 'Upgrade', slug: 'upgrade' });
    const savedPage = await page(database, seed, '/pagina-publicada');
    const savedForm = await form(database, seed, '/formulario-publicado');
    const pageVersion = await row(
      database,
      "INSERT INTO page_versions (company_id, project_id, page_id, version_number, editor_state, rendered_html) VALUES ($1, $2, $3, 1, '{}'::jsonb, '<h1>Página</h1>') RETURNING id",
      [seed.company.id, seed.project.id, savedPage.id],
    );
    const formVersion = await row(
      database,
      "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{\"fields\":[\"email\"]}'::jsonb) RETURNING id",
      [seed.company.id, seed.project.id, savedForm.id],
    );

    for (const migrationName of [
      '002_invitations.sql',
      '003_published_content_routes.sql',
      '004_local_imports.sql',
      '005_session_project_context.sql',
    ]) {
      await writeFile(join(temporaryMigrations, migrationName), await readFile(join(sourceMigrations, migrationName)));
    }
    await migrate(database, { migrationsPath: temporaryMigrations });

    const upgradedPageVersion = await row(database, 'SELECT published_path FROM page_versions WHERE id = $1', [pageVersion.id]);
    const upgradedFormVersion = await row(database, 'SELECT published_path FROM form_versions WHERE id = $1', [formVersion.id]);
    assert.equal(upgradedPageVersion.published_path, '/pagina-publicada');
    assert.equal(upgradedFormVersion.published_path, '/formulario-publicado');
    await assert.rejects(
      () => database.query("UPDATE page_versions SET rendered_html = '<h1>Alterada</h1>' WHERE id = $1", [pageVersion.id]),
      /imutáveis/i,
    );
    await assert.rejects(() => database.query('DELETE FROM form_versions WHERE id = $1', [formVersion.id]), /imutáveis/i);
  } finally {
    await database.close();
  }
});

test('JSONB preserva estado do editor e schema do formulário', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedProject(database, { email: 'json@alva.test', companyName: 'JSON', slug: 'json' });
    const savedPage = await page(database, seed);
    const savedForm = await form(database, seed);
    assert.equal(savedPage.editor_state.heading, 'Olá');
    assert.deepEqual(savedForm.draft_schema.fields, ['email']);
  } finally {
    await database.close();
  }
});

test('versões e respostas não cruzam empresa, projeto ou conteúdo', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const first = await seedProject(database, { email: 'primeiro@alva.test', companyName: 'Primeiro', slug: 'primeiro' });
    const second = await seedProject(database, { email: 'segundo@alva.test', companyName: 'Segundo', slug: 'segundo' });
    const firstPage = await page(database, first);
    const firstForm = await form(database, first);
    const secondForm = await form(database, second);
    const firstVersion = await row(
      database,
      "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id",
      [first.company.id, first.project.id, firstForm.id],
    );
    const secondVersion = await row(
      database,
      "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id",
      [second.company.id, second.project.id, secondForm.id],
    );

    await assert.rejects(
      () => database.query(
        "INSERT INTO page_versions (company_id, project_id, page_id, version_number, editor_state, rendered_html) VALUES ($1, $2, $3, 1, '{}'::jsonb, '')",
        [first.company.id, second.project.id, firstPage.id],
      ),
      violates,
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 2, '{}'::jsonb)",
        [first.company.id, second.project.id, firstForm.id],
      ),
      violates,
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO form_submissions (company_id, project_id, form_id, form_version_id, answers) VALUES ($1, $2, $3, $4, '{}'::jsonb)",
        [first.company.id, first.project.id, firstForm.id, secondVersion.id],
      ),
      violates,
    );
    assert.ok(firstVersion.id);
  } finally {
    await database.close();
  }
});

test('versão publicada pertence ao próprio conteúdo e snapshots são imutáveis', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedProject(database, { email: 'versoes@alva.test', companyName: 'Versões', slug: 'versoes' });
    const firstPage = await page(database, seed, '/primeira');
    const secondPage = await page(database, seed, '/segunda');
    const firstForm = await form(database, seed, '/form-primeiro');
    const secondForm = await form(database, seed, '/form-segundo');
    const firstPageVersion = await row(
      database,
      "INSERT INTO page_versions (company_id, project_id, page_id, version_number, editor_state, rendered_html) VALUES ($1, $2, $3, 1, '{}'::jsonb, '') RETURNING id",
      [seed.company.id, seed.project.id, firstPage.id],
    );
    const secondPageVersion = await row(
      database,
      "INSERT INTO page_versions (company_id, project_id, page_id, version_number, editor_state, rendered_html) VALUES ($1, $2, $3, 1, '{}'::jsonb, '') RETURNING id",
      [seed.company.id, seed.project.id, secondPage.id],
    );
    const firstFormVersion = await row(
      database,
      "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id",
      [seed.company.id, seed.project.id, firstForm.id],
    );
    const secondFormVersion = await row(
      database,
      "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id",
      [seed.company.id, seed.project.id, secondForm.id],
    );

    await database.query('UPDATE pages SET published_version_id = $1 WHERE id = $2', [firstPageVersion.id, firstPage.id]);
    await database.query('UPDATE forms SET published_version_id = $1 WHERE id = $2', [firstFormVersion.id, firstForm.id]);
    await assert.rejects(
      () => database.query('UPDATE pages SET published_version_id = $1 WHERE id = $2', [secondPageVersion.id, firstPage.id]),
      violates,
    );
    await assert.rejects(
      () => database.query('UPDATE forms SET published_version_id = $1 WHERE id = $2', [secondFormVersion.id, firstForm.id]),
      violates,
    );
    await assert.rejects(() => database.query("UPDATE page_versions SET rendered_html = '<h1>novo</h1>' WHERE id = $1", [firstPageVersion.id]), /imutáveis/i);
    await assert.rejects(() => database.query('DELETE FROM form_versions WHERE id = $1', [firstFormVersion.id]), /imutáveis/i);
  } finally {
    await database.close();
  }
});

test('sessão exige membership ativa e rotas são compartilhadas entre páginas e formulários', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedProject(database, { email: 'sessao@alva.test', companyName: 'Sessão', slug: 'sessao' });
    await database.query(
      "INSERT INTO sessions (company_id, user_id, membership_id, token_hash, expires_at) VALUES ($1, $2, $3, repeat('a', 64), now() + interval '1 day')",
      [seed.company.id, seed.user.id, seed.membership.id],
    );
    await database.query("UPDATE company_memberships SET status = 'invited' WHERE id = $1", [seed.membership.id]);
    const revoked = await row(database, 'SELECT revoked_at FROM sessions WHERE membership_id = $1', [seed.membership.id]);
    assert.ok(revoked.revoked_at);
    await assert.rejects(
      () => database.query('UPDATE sessions SET revoked_at = NULL WHERE membership_id = $1', [seed.membership.id]),
      /revogação.*permanente/i,
    );
    const inactive = await row(
      database,
      "INSERT INTO users (email, password_hash, display_name) VALUES ('inativo@alva.test', 'hash', 'Inativo') RETURNING id",
    );
    const inactiveMembership = await row(
      database,
      "INSERT INTO company_memberships (company_id, user_id, role, status) VALUES ($1, $2, 'editor', 'invited') RETURNING id",
      [seed.company.id, inactive.id],
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO sessions (company_id, user_id, membership_id, token_hash, expires_at) VALUES ($1, $2, $3, repeat('b', 64), now() + interval '1 day')",
        [seed.company.id, inactive.id, inactiveMembership.id],
      ),
      /membership ativa/i,
    );
    const savedPage = await page(database, seed, '/oferta');
    await assert.rejects(() => route(database, seed, '/oferta', 'form'), violates);
    const savedRoute = await row(database, 'SELECT route_id FROM pages WHERE id = $1', [savedPage.id]);
    await assert.rejects(
      () => database.query("UPDATE project_routes SET content_type = 'form' WHERE id = $1", [savedRoute.route_id]),
      /tipo.*rota.*vinculada/i,
    );
  } finally {
    await database.close();
  }
});

test('falha de migração reverte schema e registro da versão', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const migrationsPath = await mkdtemp(join(tmpdir(), 'alva-rollback-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(migrationsPath, { recursive: true, force: true })));
  try {
    await writeFile(migrationsPath + '/001_rollback.sql', "CREATE TABLE rollback_probe (id integer); SELECT 1 / 0;");
    await assert.rejects(() => migrate(database, { migrationsPath }), /division by zero/i);
    const table = await database.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'rollback_probe'");
    const migration = await database.query("SELECT 1 FROM schema_migrations WHERE version = '001'");
    assert.equal(table.rowCount, 0);
    assert.equal(migration.rowCount, 0);
  } finally {
    await database.close();
  }
});
