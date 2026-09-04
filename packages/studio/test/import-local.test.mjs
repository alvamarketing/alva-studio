import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scrypt as scryptCallback } from 'node:crypto';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { importLocalData, inspectLocalData } from '../server/import-local.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const scrypt = promisify(scryptCallback);
const OWNER_PASSWORD = 'senha-local-segura';
const PAGE_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const FORM_ID = '33333333-3333-4333-8333-333333333333';
const SUBMISSION_IDS = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];

async function localFixture(root, { ownerEmail = 'dono@local.test', firstPageName = '!!!' } = {}) {
  const dir = await mkdtemp(join(root, 'studio-local-'));
  const salt = '00112233445566778899aabbccddeeff';
  const hash = (await scrypt(OWNER_PASSWORD, salt, 64)).toString('hex');
  const legacyDeployment = {
    id: 'dpl_legacy123',
    projectId: 'prj_legacy456',
    url: 'legacy-page.vercel.app',
    state: 'READY',
    revision: 7,
    createdAt: '2026-08-05T12:00:00.000Z',
  };
  const data = {
    owner: { name: 'Dono Local', email: ownerEmail, password: { salt, hash } },
    pages: [
      {
        id: PAGE_IDS[0],
        name: firstPageName,
        template: 'services',
        project: null,
        html: '<main>Principal</main>',
        revision: 7,
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-05T11:00:00.000Z',
        domain: 'lp.example.com',
        webhook: 'https://hooks.example.com/page',
        deployment: legacyDeployment,
      },
      {
        id: PAGE_IDS[1],
        name: 'Admin',
        template: 'thanks',
        project: { pages: [{ frames: [{ component: { tagName: 'section' } }] }] },
        html: '<main>Obrigado</main>',
        revision: 2,
        createdAt: '2026-08-02T10:00:00.000Z',
        updatedAt: '2026-08-06T11:00:00.000Z',
        domain: '',
        webhook: '',
        deployment: null,
      },
    ],
    forms: [
      {
        id: FORM_ID,
        name: 'Diagnóstico comercial',
        slug: 'pagina-22222222',
        headerElements: [],
        steps: [
          {
            id: 'inicio',
            title: 'Boas-vindas',
            motion: 'fade-up',
            autoAdvance: false,
            timer: 0,
            elements: [
              {
                id: 'nome',
                type: 'short_text',
                title: 'Seu nome',
                description: '',
                required: true,
                placeholder: 'Como podemos chamar você?',
                icon: 'person',
              },
            ],
          },
        ],
        completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
        webhook: 'https://hooks.example.com/form',
        revision: 4,
        createdAt: '2026-08-03T10:00:00.000Z',
        updatedAt: '2026-08-07T11:00:00.000Z',
      },
    ],
    submissions: SUBMISSION_IDS.map((id, index) => ({
      id,
      formId: FORM_ID,
      answers: { nome: index ? 'Pessoa Dois' : 'Pessoa Um' },
      submittedAt: `2026-08-0${8 + index}T12:00:00.000Z`,
    })),
  };
  const contents = {
    'owner.json': JSON.stringify(data.owner),
    'pages.json': JSON.stringify(data.pages),
    'forms.json': JSON.stringify(data.forms),
    'form-submissions.json': JSON.stringify(data.submissions),
  };
  await Promise.all(Object.entries(contents).map(([name, content]) => writeFile(join(dir, name), content)));
  await writeFile(join(dir, 'ignore-me.json'), '{broken');
  return { dir, data, contents };
}

async function counts(database) {
  const names = [
    'users',
    'companies',
    'projects',
    'pages',
    'forms',
    'form_versions',
    'form_submissions',
    'project_domains',
    'project_integrations',
    'deployment_runs',
    'local_imports',
  ];
  const entries = await Promise.all(names.map(async (name) => {
    const result = await database.query(`SELECT count(*)::integer AS count FROM ${name}`);
    return [name, result.rows[0].count];
  }));
  return Object.fromEntries(entries);
}

test('inspeciona somente os quatro arquivos locais e informa tamanho e SHA-256', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alva-import-inspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await localFixture(root);

  const inspection = await inspectLocalData(fixture.dir);

  assert.equal(inspection.valid, true);
  assert.deepEqual(inspection.problems, []);
  assert.deepEqual(Object.keys(inspection.files), [
    'owner.json',
    'pages.json',
    'forms.json',
    'form-submissions.json',
  ]);
  const pageContent = fixture.contents['pages.json'];
  assert.equal(inspection.files['pages.json'].size, Buffer.byteLength(pageContent));
  assert.equal(inspection.files['pages.json'].sha256, createHash('sha256').update(pageContent).digest('hex'));
  assert.match(inspection.checksum, /^[a-f0-9]{64}$/);
});

test('rejeita dados inválidos antes de abrir transação', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alva-import-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await localFixture(root);
  await writeFile(join(fixture.dir, 'pages.json'), '{}');
  let transactions = 0;
  const database = { transaction: async () => { transactions += 1; } };

  const inspection = await inspectLocalData(fixture.dir);
  assert.equal(inspection.valid, false);
  assert.ok(inspection.problems.some((problem) => problem.includes('pages.json')));
  await assert.rejects(
    () => importLocalData({ dir: fixture.dir, database, ownerPassword: OWNER_PASSWORD }),
    /dados locais.*inválidos/i,
  );
  assert.equal(transactions, 0);

  const invalidSettings = [
    { domain: 'https://lp.example.com' },
    { webhook: 'http://hooks.example.com/page' },
    { deployment: { id: 123 } },
  ];
  for (const patch of invalidSettings) {
    const pages = structuredClone(fixture.data.pages);
    Object.assign(pages[0], patch);
    await writeFile(join(fixture.dir, 'pages.json'), JSON.stringify(pages));
    await assert.rejects(
      () => importLocalData({ dir: fixture.dir, database, ownerPassword: OWNER_PASSWORD }),
      /dados locais.*inválidos/i,
    );
  }
  assert.equal(transactions, 0);
});

test('listas locais ausentes equivalem a listas vazias, mas owner continua obrigatório', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alva-import-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await localFixture(root);
  await Promise.all([
    unlink(join(fixture.dir, 'pages.json')),
    unlink(join(fixture.dir, 'forms.json')),
    unlink(join(fixture.dir, 'form-submissions.json')),
  ]);

  const withoutLists = await inspectLocalData(fixture.dir);
  assert.equal(withoutLists.valid, true);
  assert.deepEqual(withoutLists.counts, { pages: 0, forms: 0, submissions: 0 });
  assert.deepEqual(withoutLists.files['pages.json'], { size: 0, sha256: null });

  await unlink(join(fixture.dir, 'owner.json'));
  const withoutOwner = await inspectLocalData(fixture.dir);
  assert.equal(withoutOwner.valid, false);
  assert.ok(withoutOwner.problems.some((problem) => problem.includes('owner.json')));
});

test('importa conteúdo uma vez, preserva metadados e retorna o relatório existente na repetição', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alva-import-success-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await localFixture(root);
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  try {
    await migrate(database);

    const first = await importLocalData({ dir: fixture.dir, database, ownerPassword: OWNER_PASSWORD });
    const firstCounts = await counts(database);
    const second = await importLocalData({ dir: fixture.dir, database, ownerPassword: OWNER_PASSWORD });

    assert.deepEqual(second, first);
    assert.deepEqual(first.counts, { pages: 2, forms: 1, submissions: 2 });
    assert.deepEqual(await counts(database), firstCounts);
    assert.deepEqual(firstCounts, {
      users: 1,
      companies: 1,
      projects: 1,
      pages: 2,
      forms: 1,
      form_versions: 1,
      form_submissions: 2,
      project_domains: 1,
      project_integrations: 1,
      deployment_runs: 1,
      local_imports: 1,
    });

    const pages = await database.query(
      'SELECT id, editor_state, lock_version, created_at, updated_at FROM pages ORDER BY created_at',
    );
    assert.deepEqual(pages.rows.map(({ id }) => id), PAGE_IDS);
    assert.equal(pages.rows[0].editor_state, null);
    assert.equal(pages.rows[0].lock_version, fixture.data.pages[0].revision);
    assert.equal(pages.rows[0].created_at.toISOString(), fixture.data.pages[0].createdAt);
    assert.equal(pages.rows[0].updated_at.toISOString(), fixture.data.pages[0].updatedAt);

    const form = (await database.query(
      'SELECT id, company_id, project_id, lock_version, created_at, updated_at, published_version_id FROM forms',
    )).rows[0];
    assert.equal(form.id, FORM_ID);
    assert.equal(form.lock_version, fixture.data.forms[0].revision);
    assert.equal(form.created_at.toISOString(), fixture.data.forms[0].createdAt);
    assert.equal(form.updated_at.toISOString(), fixture.data.forms[0].updatedAt);
    assert.ok(form.published_version_id);
    const submissions = await database.query(
      'SELECT id, company_id, project_id, form_id, form_version_id, submitted_at FROM form_submissions ORDER BY submitted_at',
    );
    assert.deepEqual(submissions.rows.map(({ id }) => id), SUBMISSION_IDS);
    assert.ok(submissions.rows.every((row) => row.company_id === form.company_id));
    assert.ok(submissions.rows.every((row) => row.project_id === form.project_id));
    assert.ok(submissions.rows.every((row) => row.form_id === FORM_ID));
    assert.ok(submissions.rows.every((row) => row.form_version_id === form.published_version_id));
    assert.equal(submissions.rows[0].submitted_at.toISOString(), fixture.data.submissions[0].submittedAt);

    const routes = await database.query('SELECT path, content_type FROM project_routes ORDER BY path');
    assert.deepEqual(routes.rows, [
      { path: '/formulario-33333333', content_type: 'form' },
      { path: '/pagina-11111111', content_type: 'page' },
      { path: '/pagina-22222222', content_type: 'page' },
    ]);
    const domain = (await database.query(
      'SELECT domain, environment, is_canonical, verification_status FROM project_domains',
    )).rows[0];
    assert.deepEqual(domain, {
      domain: fixture.data.pages[0].domain,
      environment: 'production',
      is_canonical: false,
      verification_status: 'pending',
    });
    const integration = (await database.query(
      'SELECT provider, environment, configuration FROM project_integrations',
    )).rows[0];
    assert.equal(integration.provider, 'local-studio');
    assert.equal(integration.environment, 'production');
    assert.equal(integration.configuration.requiresReconnect, true);
    assert.equal(integration.configuration.connectionStatus, 'pending');
    assert.deepEqual(integration.configuration.pages[0], {
      pageId: PAGE_IDS[0],
      domain: fixture.data.pages[0].domain,
      webhook: fixture.data.pages[0].webhook,
      deployment: fixture.data.pages[0].deployment,
    });
    assert.deepEqual(integration.configuration.forms[0], {
      formId: FORM_ID,
      webhook: fixture.data.forms[0].webhook,
    });
    const deployment = (await database.query(
      `SELECT status, external_deployment_id, external_project_id, expected_revision
       FROM deployment_runs`,
    )).rows[0];
    assert.deepEqual(deployment, {
      status: 'requires_reconnect',
      external_deployment_id: fixture.data.pages[0].deployment.id,
      external_project_id: fixture.data.pages[0].deployment.projectId,
      expected_revision: fixture.data.pages[0].revision,
    });
  } finally {
    await database.close();
  }
});

test('uma falha no conteúdo reverte usuário, empresa, projeto e registro da importação', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alva-import-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await localFixture(root, { ownerEmail: 'novo-dono@local.test', firstPageName: 'Página em colisão' });
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  try {
    await migrate(database);
    const seeded = await database.query(
      "INSERT INTO users (email, password_hash, display_name) VALUES ('existente@local.test', 'hash', 'Existente') RETURNING id",
    );
    const company = await database.query("INSERT INTO companies (name, slug) VALUES ('Existente', 'existente') RETURNING id");
    await database.query(
      "INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())",
      [company.rows[0].id, seeded.rows[0].id],
    );
    const project = await database.query(
      "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Existente', 'existente', $2) RETURNING id",
      [company.rows[0].id, seeded.rows[0].id],
    );
    const route = await database.query(
      "INSERT INTO project_routes (company_id, project_id, path, content_type) VALUES ($1, $2, '/existente', 'page') RETURNING id",
      [company.rows[0].id, project.rows[0].id],
    );
    await database.query(
      "INSERT INTO pages (id, company_id, project_id, route_id, name, editor_state, created_by) VALUES ($1, $2, $3, $4, 'Existente', '{}'::jsonb, $5)",
      [PAGE_IDS[0], company.rows[0].id, project.rows[0].id, route.rows[0].id, seeded.rows[0].id],
    );
    const before = await counts(database);

    await assert.rejects(
      () => importLocalData({ dir: fixture.dir, database, ownerPassword: OWNER_PASSWORD }),
      (error) => error?.code === '23505',
    );
    assert.deepEqual(await counts(database), before);
  } finally {
    await database.close();
  }
});
