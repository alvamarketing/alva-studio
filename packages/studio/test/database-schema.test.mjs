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
  'videos',
  'video_versions',
  'analytics_websites',
  'analytics_sessions',
  'analytics_events',
  'analytics_event_data',
  'analytics_daily_rollup',
  'project_tracking_policies',
  'analytics_consents',
  'tracking_proxy_secrets',
  'tracking_proxy_requests',
  'publication_build_reservations',
  'publication_tracking_artifacts',
];

const violates = (error) => ['23502', '23503', '23505', '23514'].includes(error?.code);

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

test('migração de VSL mantém versões vinculadas, imutáveis e isoladas', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const first = await seedProject(database, { email: 'vsl-a@alva.test', companyName: 'VSL A', slug: 'vsl-a' });
    const second = await seedProject(database, { email: 'vsl-b@alva.test', companyName: 'VSL B', slug: 'vsl-b' });
    const video = await row(database, `INSERT INTO videos
      (company_id, project_id, public_id, name, source_url, source_type, created_by)
      VALUES ($1, $2, 'public-vsl-a', 'VSL', 'https://cdn.example.test/a.mp4', 'mp4', $3) RETURNING id`,
    [first.company.id, first.project.id, first.user.id]);
    const version = await row(database, `INSERT INTO video_versions
      (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type, accent_color, aspect_ratio, autoplay_muted, resume_enabled, created_by)
      VALUES ($1, $2, $3, 1, 'public-vsl-a', 'VSL', 'https://cdn.example.test/a.mp4', 'mp4', '#286eea', '16:9', true, true, $4) RETURNING id`,
    [first.company.id, first.project.id, video.id, first.user.id]);
    await database.query('UPDATE videos SET published_version_id = $1 WHERE id = $2', [version.id, video.id]);
    await assert.rejects(
      () => database.query("UPDATE video_versions SET source_url = 'https://cdn.example.test/changed.mp4' WHERE id = $1", [version.id]),
      /imutáveis/i,
    );
    const otherVideo = await row(database, `INSERT INTO videos
      (company_id, project_id, public_id, name, source_url, source_type, created_by)
      VALUES ($1, $2, 'public-vsl-b', 'VSL', 'https://cdn.example.test/b.mp4', 'mp4', $3) RETURNING id`,
    [second.company.id, second.project.id, second.user.id]);
    await assert.rejects(
      () => database.query('UPDATE videos SET published_version_id = $1 WHERE id = $2', [version.id, otherVideo.id]),
      /violates foreign key/i,
    );
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

test('coletor de analytics isola por empresa e projeto e valida event_type', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedProject(database, { email: 'analytics-a@alva.test', companyName: 'Analytics A', slug: 'analytics-a' });
    const other = await seedProject(database, { email: 'analytics-b@alva.test', companyName: 'Analytics B', slug: 'analytics-b' });
    await database.query('DELETE FROM analytics_websites WHERE company_id = $1 AND project_id = $2', [seed.company.id, seed.project.id]);

    const website = await row(
      database,
      "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, 'tracker-analytics-a', 'production') RETURNING id",
      [seed.company.id, seed.project.id],
    );
    assert.ok(website.id);

    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, 'tracker-analytics-a-2', 'production')",
        [seed.company.id, seed.project.id],
      ),
      violates,
      'não deve permitir dois sites para o mesmo projeto e ambiente',
    );

    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, 'tracker-analytics-a', 'staging')",
        [seed.company.id, seed.project.id],
      ),
      violates,
      'tracker_public_id deve ser único globalmente',
    );

    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, 'tracker-analytics-cross', 'production')",
        [seed.company.id, other.project.id],
      ),
      violates,
      'FK composta deve recusar par (company_id, project_id) inconsistente',
    );

    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path) VALUES ($1, $2, $3, now(), 'invalido', '/')",
        [seed.company.id, seed.project.id, website.id],
      ),
      violates,
      'event_type deve recusar valor fora do CHECK',
    );

    const event = await row(
      database,
      "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path, tracking_event_id) VALUES ($1, $2, $3, now(), 'pageview', '/', gen_random_uuid()) RETURNING id",
      [seed.company.id, seed.project.id, website.id],
    );
    assert.ok(event.id);

    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_events (company_id, project_id, website_id, event_at, event_type, url_path) VALUES ($1, $2, $3, now(), 'pageview', '/')",
        [seed.company.id, other.project.id, website.id],
      ),
      violates,
      'evento não pode referenciar site de outro projeto',
    );
  } finally {
    await database.close();
  }
});

test('migração do coletor cria tracker público para projetos já existentes', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  try {
    const basePath = await mkdtemp(join(tmpdir(), 'alva-analytics-backfill-'));
    t.after(() => rm(basePath, { recursive: true, force: true }));
    const migrations = await (await import('node:fs/promises')).readdir(sourceMigrations);
    for (const name of migrations.filter((name) => name < '012_analytics_websites.sql')) {
      await writeFile(join(basePath, name), await readFile(join(sourceMigrations, name)));
    }
    await migrate(database, { migrationsPath: basePath });
    const seed = await seedProject(database, { email: 'backfill@alva.test', companyName: 'Backfill', slug: 'backfill' });
    await writeFile(join(basePath, '012_analytics_websites.sql'), await readFile(join(sourceMigrations, '012_analytics_websites.sql')));
    await migrate(database, { migrationsPath: basePath });
    const website = await database.query('SELECT tracker_public_id FROM analytics_websites WHERE company_id = $1 AND project_id = $2', [seed.company.id, seed.project.id]);
    assert.equal(website.rowCount, 1);
    assert.match(website.rows[0].tracker_public_id, /^[a-f0-9]{32}$/);

    const createdAfterMigration = await database.query(
      "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Novo', 'novo', $2) RETURNING id",
      [seed.company.id, seed.user.id],
    );
    const provisioned = await database.query('SELECT tracker_public_id FROM analytics_websites WHERE company_id = $1 AND project_id = $2', [seed.company.id, createdAfterMigration.rows[0].id]);
    assert.equal(provisioned.rowCount, 1, 'projeto criado após a migração recebe tracker automaticamente');
    assert.match(provisioned.rows[0].tracker_public_id, /^[a-f0-9]{32}$/);
  } finally {
    await database.close();
  }
});

test('migração de mídia aceita provedores e rejeita estados de armazenamento incoerentes', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const seed = await seedProject(database, { email: 'media-schema@alva.test', companyName: 'Mídia Schema', slug: 'midia-schema' });
    const video = await row(
      database,
      `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, provider_video_id, created_by)
       VALUES ($1, $2, 'youtube-schema-video', 'YouTube', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', $3)
       RETURNING id`,
      [seed.company.id, seed.project.id, seed.user.id],
    );
    assert.ok(video.id, 'VSL de provedor deve persistir quando tiver identidade canônica');
    const version = await row(
      database,
      `INSERT INTO video_versions (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type,
        provider_video_id, accent_color, aspect_ratio, autoplay_muted, resume_enabled, created_by)
       VALUES ($1, $2, $3, 1, 'youtube-schema-video', 'YouTube', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube',
        'dQw4w9WgXcQ', '#286eea', '16:9', true, true, $4) RETURNING id`,
      [seed.company.id, seed.project.id, video.id, seed.user.id],
    );
    assert.ok(version.id, 'snapshot de provedor deve guardar a identidade canônica');

    await assert.rejects(
      () => database.query(
        `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, created_by)
         VALUES ($1, $2, 'youtube-without-id', 'Inválido', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', $3)`,
        [seed.company.id, seed.project.id, seed.user.id],
      ),
      violates,
      'provedores não podem existir sem provider_video_id',
    );
    await database.query(
      `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, provider_video_id, created_by)
       VALUES ($1, $2, 'smartplayer-schema', 'SmartPlayer', 'https://example.test/embed', 'smartplayer', 'player-123', $3)`,
      [seed.company.id, seed.project.id, seed.user.id],
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, created_by)
         VALUES ($1, $2, 'bad-media-type', 'Inválido', 'https://example.test/video', 'arquivo', $3)`,
        [seed.company.id, seed.project.id, seed.user.id],
      ),
      violates,
      'domínio de source_type deve continuar fechado',
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, storage_key, storage_status, created_by)
         VALUES ($1, $2, 'bad-storage-status', 'Inválido', 'https://cdn.example.test/video.mp4', 'r2', 'company/project/video.mp4', 'queued', $3)`,
        [seed.company.id, seed.project.id, seed.user.id],
      ),
      violates,
      'storage_status só aceita estados conhecidos',
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, storage_status, created_by)
         VALUES ($1, $2, 'r2-without-key', 'Inválido', 'https://cdn.example.test/video.mp4', 'r2', 'ready', $3)`,
        [seed.company.id, seed.project.id, seed.user.id],
      ),
      violates,
      'R2 exige storage_key em videos',
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO video_versions (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type,
          accent_color, aspect_ratio, autoplay_muted, resume_enabled, storage_status, created_by)
         VALUES ($1, $2, $3, 2, 'youtube-schema-video', 'Inválido', 'https://cdn.example.test/video.m3u8', 'r2-hls',
          '#286eea', '16:9', true, true, 'ready', $4)`,
        [seed.company.id, seed.project.id, video.id, seed.user.id],
      ),
      violates,
      'R2 exige storage_key em video_versions',
    );
    await assert.rejects(
      () => database.query(
        `INSERT INTO video_versions (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type,
          accent_color, aspect_ratio, autoplay_muted, resume_enabled, storage_key, storage_status, created_by)
         VALUES ($1, $2, $3, 3, 'youtube-schema-video', 'Inválido', 'https://cdn.example.test/video.mp4', 'r2',
          '#286eea', '16:9', true, true, 'company/project/video.mp4', 'queued', $4)`,
        [seed.company.id, seed.project.id, video.id, seed.user.id],
      ),
      violates,
      'storage_status só aceita estados conhecidos em video_versions',
    );
  } finally {
    await database.close();
  }
});

test('migração de mídia preenche published_lock_version em VSLs publicadas antigas', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  const migrationsPath = await mkdtemp(join(tmpdir(), 'alva-media-backfill-'));
  t.after(() => rm(migrationsPath, { recursive: true, force: true }));
  try {
    const migrations = await (await import('node:fs/promises')).readdir(sourceMigrations);
    for (const name of migrations.filter((name) => name < '013_media_providers.sql'))
      await writeFile(join(migrationsPath, name), await readFile(join(sourceMigrations, name)));
    await migrate(database, { migrationsPath });
    const seed = await seedProject(database, { email: 'media-backfill@alva.test', companyName: 'Mídia Backfill', slug: 'midia-backfill' });
    const video = await row(
      database,
      `INSERT INTO videos (company_id, project_id, public_id, name, source_url, source_type, lock_version, created_by)
       VALUES ($1, $2, 'legacy-published-video', 'Legada', 'https://cdn.example.test/legacy.mp4', 'mp4', 7, $3) RETURNING id`,
      [seed.company.id, seed.project.id, seed.user.id],
    );
    const version = await row(
      database,
      `INSERT INTO video_versions (company_id, project_id, video_id, version_number, public_id, name, source_url, source_type,
        accent_color, aspect_ratio, autoplay_muted, resume_enabled, created_by)
       VALUES ($1, $2, $3, 1, 'legacy-published-video', 'Legada', 'https://cdn.example.test/legacy.mp4', 'mp4',
        '#286eea', '16:9', true, true, $4) RETURNING id`,
      [seed.company.id, seed.project.id, video.id, seed.user.id],
    );
    await database.query('UPDATE videos SET published_version_id = $1 WHERE id = $2', [version.id, video.id]);
    await writeFile(join(migrationsPath, '013_media_providers.sql'), await readFile(join(sourceMigrations, '013_media_providers.sql')));
    await migrate(database, { migrationsPath });
    const upgraded = await row(database, 'SELECT published_lock_version FROM videos WHERE id = $1', [video.id]);
    assert.equal(upgraded.published_lock_version, 7, 'o backfill deve usar a revisão que estava publicada');
  } finally {
    await database.close();
  }
});

test('migração de pixels fecha escopo, consentimento e vínculo de publicação', async (t) => {
  const database = await migratedDatabase(t);
  try {
    const first = await seedProject(database, { email: 'pixels-a@alva.test', companyName: 'Pixels A', slug: 'pixels-a' });
    const second = await seedProject(database, { email: 'pixels-b@alva.test', companyName: 'Pixels B', slug: 'pixels-b' });
    await database.query('DELETE FROM analytics_websites WHERE company_id = $1 AND project_id = $2', [first.company.id, first.project.id]);
    const website = await row(
      database,
      "INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment) VALUES ($1, $2, 'tracker-pixels-a', 'production') RETURNING id",
      [first.company.id, first.project.id],
    );
    await database.query(
      "INSERT INTO project_tracking_policies (company_id, project_id, environment, privacy_policy_url, policy_version) VALUES ($1, $2, 'production', 'https://pixels.example.test/privacy', '2026-09')",
      [first.company.id, first.project.id],
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO project_tracking_policies (company_id, project_id, environment, privacy_policy_url, policy_version) VALUES ($1, $2, 'production', 'https://pixels.example.test/privacy', '2026-09')",
        [first.company.id, second.project.id],
      ),
      violates,
      'a política precisa manter o par empresa/projeto',
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_consents (company_id, project_id, website_id, purpose, consent_token_hash, policy_version, expires_at, evidence) VALUES ($1, $2, $3, 'analytics', repeat('a', 64), '2026-09', now() + interval '1 year', '{\"source\":\"banner\",\"publicationId\":\"pub\"}'::jsonb)",
        [first.company.id, first.project.id, website.id],
      ),
      violates,
      'consentimento só pode ter finalidade publicitária',
    );
    for (const evidence of ['{}', '[]', '{"source":"form","publicationId":"pub"}', '{"source":"banner","publicationId":7}', '{"source":"banner","publicationId":"not valid"}']) {
      await assert.rejects(
        () => database.query(
          "INSERT INTO analytics_consents (company_id, project_id, website_id, purpose, consent_token_hash, policy_version, expires_at, evidence) VALUES ($1, $2, $3, 'advertising', repeat('c', 64), '2026-09', now() + interval '1 year', $4::jsonb)",
          [first.company.id, first.project.id, website.id, evidence],
        ),
        violates,
        'evidência exige banner e publicationId público válido',
      );
    }
    await database.query(
      "INSERT INTO analytics_consents (company_id, project_id, website_id, purpose, consent_token_hash, policy_version, expires_at, evidence) VALUES ($1, $2, $3, 'advertising', repeat('a', 64), '2026-09', now() + interval '1 year', '{\"source\":\"banner\",\"publicationId\":\"pub\"}'::jsonb)",
      [first.company.id, first.project.id, website.id],
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO analytics_consents (company_id, project_id, website_id, purpose, consent_token_hash, policy_version, expires_at, evidence) VALUES ($1, $2, $3, 'advertising', repeat('a', 64), '2026-09', now() + interval '1 year', '{\"source\":\"banner\",\"publicationId\":\"pub\"}'::jsonb)",
        [first.company.id, first.project.id, website.id],
      ),
      violates,
      'índice parcial impede dois consentimentos ativos para o mesmo token',
    );
    const reservation = await row(
      database,
      "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, state, expires_at) VALUES ('published-pixels-a', $1, $2, 'production', 'reserved', now() + interval '1 hour') RETURNING id, public_id",
      [first.company.id, first.project.id],
    );
    assert.notEqual(reservation.id, reservation.public_id, 'a reservation possui PK interna distinta do identificador público');
    await assert.rejects(
      () => database.query(
        "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, state, expires_at) VALUES ('published-pixels-a', $1, $2, 'production', 'invalid', now() - interval '1 hour')",
        [first.company.id, first.project.id],
      ),
      violates,
      'estado inválido ou expiração inválida devem ser recusados',
    );
    await database.query("UPDATE publication_build_reservations SET state = 'expired' WHERE id = $1", [reservation.id]);
    await database.query('DELETE FROM publication_build_reservations WHERE id = $1', [reservation.id]);
    const activeReservation = await row(
      database,
      "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, state, expires_at) VALUES ('published-pixels-active', $1, $2, 'production', 'claimed', now() + interval '1 hour') RETURNING id",
      [first.company.id, first.project.id],
    );
    const run = await row(
      database,
      "INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision) VALUES ($1, $2, 'production', repeat('a', 64), 'pixel-run', 0) RETURNING id",
      [first.company.id, first.project.id],
    );
    const previewRun = await row(
      database,
      "INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision) VALUES ($1, $2, 'preview', repeat('b', 64), 'pixel-preview-run', 0) RETURNING id",
      [first.company.id, first.project.id],
    );
    await assert.rejects(
      () => database.query('UPDATE publication_build_reservations SET deployment_run_id = $2 WHERE id = $1', [activeReservation.id, previewRun.id]),
      violates,
      'reservation só pode vincular run do mesmo ambiente',
    );
    await database.query(
      "INSERT INTO tracking_proxy_requests (publication_id, request_id, request_hash, response_status, response_body, expires_at) VALUES ($1, 'same-request', repeat('b', 64), 204, '{}'::jsonb, now() + interval '5 minutes')",
      [activeReservation.id],
    );
    await database.query(
      "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, state, expires_at) VALUES ('published-pixels-second', $1, $2, 'production', 'claimed', now() + interval '1 hour')",
      [first.company.id, first.project.id],
    );
    const secondReservation = await row(database, "SELECT id FROM publication_build_reservations WHERE public_id = 'published-pixels-second'");
    await database.query(
      "INSERT INTO tracking_proxy_requests (publication_id, request_id, request_hash, response_status, response_body, expires_at) VALUES ($1, 'same-request', repeat('b', 64), 204, '{}'::jsonb, now() + interval '5 minutes')",
      [secondReservation.id],
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO publication_tracking_artifacts (reservation_id, deployment_run_id, snapshot_hash, manifest, tracking_public, asset_versions, status) VALUES ($1, $2, repeat('a', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready')",
        [activeReservation.id, run.id],
      ),
      /foreign key|violates/i,
      'artifact só pode referenciar reservation e run coerentes',
    );
    await database.query('UPDATE publication_build_reservations SET deployment_run_id = $2 WHERE id = $1', [activeReservation.id, run.id]);
    const hashRun = await row(
      database,
      "INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision) VALUES ($1, $2, 'production', repeat('b', 64), 'pixel-hash-run', 0) RETURNING id",
      [first.company.id, first.project.id],
    );
    const hashReservation = await row(
      database,
      "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, deployment_run_id, state, expires_at) VALUES ('published-pixels-hash', $1, $2, 'production', $3, 'claimed', now() + interval '1 hour') RETURNING id",
      [first.company.id, first.project.id, hashRun.id],
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO publication_tracking_artifacts (reservation_id, deployment_run_id, snapshot_hash, manifest, tracking_public, asset_versions, status) VALUES ($1, $2, repeat('c', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready')",
        [hashReservation.id, hashRun.id],
      ),
      violates,
      'artifact precisa preservar o snapshot_hash do deployment_run vinculado',
    );
    await database.query(
      "INSERT INTO publication_tracking_artifacts (reservation_id, deployment_run_id, snapshot_hash, manifest, tracking_public, asset_versions, status) VALUES ($1, $2, repeat('a', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready')",
      [activeReservation.id, run.id],
    );
    await assert.rejects(
      () => database.query(
        "UPDATE publication_tracking_artifacts SET tracking_public = '{\"pixelsEnabled\":true}'::jsonb WHERE reservation_id = $1",
        [activeReservation.id],
      ),
      /imutável/i,
      'o artefato persistido não pode ser alterado depois de criado',
    );
    await database.query("UPDATE publication_tracking_artifacts SET status = 'safe', safe_at = now() WHERE reservation_id = $1", [activeReservation.id]);
    await assert.rejects(
      () => database.query("UPDATE publication_tracking_artifacts SET status = 'ready', safe_at = NULL WHERE reservation_id = $1", [activeReservation.id]),
      /imutável/i,
      'um artefato homologado não pode voltar a um estado mutável',
    );
    await assert.rejects(
      () => database.query(
        "INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision) VALUES ($1, $2, 'production', NULL, 'pixel-run-without-hash', 0)",
        [first.company.id, first.project.id],
      ),
      violates,
      'snapshot_hash de deployment_runs continua obrigatório',
    );
  } finally {
    await database.close();
  }
});
