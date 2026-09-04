import { createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { withTransaction } from './db/postgres.mjs';
import { normalizeProjectSlug, normalizeRoute } from './domain/access.mjs';
import { normalizeHeaderElements, normalizeSteps } from './form-store.mjs';

const scrypt = promisify(scryptCallback);
const LOCAL_FILES = Object.freeze([
  'owner.json',
  'pages.json',
  'forms.json',
  'form-submissions.json',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{32}$/i;
const HEX_128 = /^[0-9a-f]{128}$/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validName(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 100;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function addProblem(problems, location, message) {
  problems.push(`${location}: ${message}`);
}

function validateOwner(owner, problems) {
  if (!isObject(owner)) {
    addProblem(problems, 'owner.json', 'deve conter um objeto');
    return;
  }
  if (!validName(owner.name)) addProblem(problems, 'owner.json', 'nome inválido');
  if (
    typeof owner.email !== 'string' ||
    owner.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email.trim())
  ) addProblem(problems, 'owner.json', 'e-mail inválido');
  if (
    !isObject(owner.password) ||
    !HEX_32.test(owner.password.salt ?? '') ||
    !HEX_128.test(owner.password.hash ?? '')
  ) addProblem(problems, 'owner.json', 'senha armazenada inválida');
}

function validatePage(page, index, problems, ids) {
  const location = `pages.json[${index}]`;
  if (!isObject(page)) return addProblem(problems, location, 'deve conter um objeto');
  if (!UUID.test(page.id ?? '') || ids.has(page.id)) addProblem(problems, location, 'UUID inválido ou repetido');
  else ids.add(page.id);
  if (!validName(page.name)) addProblem(problems, location, 'nome inválido');
  if (page.template !== undefined && page.template !== null && (typeof page.template !== 'string' || page.template.length > 80))
    addProblem(problems, location, 'template inválido');
  if (page.project !== null && page.project !== undefined && !isObject(page.project))
    addProblem(problems, location, 'estado do editor inválido');
  if (typeof page.html !== 'string') addProblem(problems, location, 'HTML inválido');
  if (!Number.isInteger(page.revision) || page.revision < 0) addProblem(problems, location, 'revisão inválida');
  if (!validDate(page.createdAt)) addProblem(problems, location, 'data de criação inválida');
  if (!validDate(page.updatedAt)) addProblem(problems, location, 'data de atualização inválida');
}

function completion(value) {
  if (!isObject(value)) throw new Error('conclusão inválida');
  const title = String(value.title ?? '').trim();
  const message = String(value.message ?? '').trim();
  if (!title || title.length > 120 || !message || message.length > 500) throw new Error('conclusão inválida');
  return { title, message };
}

function webhook(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 2000) throw new Error('webhook inválido');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('webhook inválido');
  return value;
}

function validateForm(form, index, problems, ids, normalizedForms) {
  const location = `forms.json[${index}]`;
  if (!isObject(form)) return addProblem(problems, location, 'deve conter um objeto');
  if (!UUID.test(form.id ?? '') || ids.has(form.id)) addProblem(problems, location, 'UUID inválido ou repetido');
  else ids.add(form.id);
  if (!validName(form.name)) addProblem(problems, location, 'nome inválido');
  if (typeof form.slug !== 'string' || !/^[a-z0-9-]{3,90}$/.test(form.slug)) addProblem(problems, location, 'slug inválido');
  if (!Number.isInteger(form.revision) || form.revision < 0) addProblem(problems, location, 'revisão inválida');
  if (!validDate(form.createdAt)) addProblem(problems, location, 'data de criação inválida');
  if (!validDate(form.updatedAt)) addProblem(problems, location, 'data de atualização inválida');
  try {
    normalizedForms.set(form.id, {
      headerElements: normalizeHeaderElements(form.headerElements),
      steps: normalizeSteps(form.steps),
      completion: completion(form.completion),
      webhook: webhook(form.webhook),
    });
  } catch (error) {
    addProblem(problems, location, error.message);
  }
}

function validateSubmission(submission, index, problems, ids, formIds) {
  const location = `form-submissions.json[${index}]`;
  if (!isObject(submission)) return addProblem(problems, location, 'deve conter um objeto');
  if (!UUID.test(submission.id ?? '') || ids.has(submission.id)) addProblem(problems, location, 'UUID inválido ou repetido');
  else ids.add(submission.id);
  if (!UUID.test(submission.formId ?? '') || !formIds.has(submission.formId))
    addProblem(problems, location, 'formulário não encontrado');
  if (!isObject(submission.answers)) addProblem(problems, location, 'respostas inválidas');
  if (!validDate(submission.submittedAt)) addProblem(problems, location, 'data de envio inválida');
}

function allocateRoute(value, used, suffix) {
  let path = normalizeRoute(`/${normalizeProjectSlug(value)}`);
  if (used.has(path.toLowerCase())) {
    const ending = `-${suffix}`;
    path = normalizeRoute(`${path.slice(0, 120 - ending.length)}${ending}`);
  }
  if (used.has(path.toLowerCase())) throw new Error(`rota repetida: ${path}`);
  used.add(path.toLowerCase());
  return path;
}

async function readAndInspect(dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('Informe o diretório dos dados locais.');
  const files = {};
  const parsed = {};
  const problems = [];
  for (const name of LOCAL_FILES) {
    try {
      const content = await readFile(join(dir, name));
      files[name] = { size: content.byteLength, sha256: digest(content) };
      try {
        parsed[name] = JSON.parse(content.toString('utf8'));
      } catch {
        addProblem(problems, name, 'JSON inválido');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files[name] = { size: 0, sha256: null };
      addProblem(problems, name, 'arquivo ausente');
    }
  }
  const checksumSource = LOCAL_FILES.map((name) => {
    const file = files[name];
    return `${name}\0${file.sha256 ?? ''}\0${file.size}\n`;
  }).join('');
  const checksum = digest(checksumSource);
  const owner = parsed['owner.json'];
  const pages = parsed['pages.json'];
  const forms = parsed['forms.json'];
  const submissions = parsed['form-submissions.json'];
  validateOwner(owner, problems);
  if (!Array.isArray(pages)) addProblem(problems, 'pages.json', 'deve conter uma lista');
  if (!Array.isArray(forms)) addProblem(problems, 'forms.json', 'deve conter uma lista');
  if (!Array.isArray(submissions)) addProblem(problems, 'form-submissions.json', 'deve conter uma lista');

  const normalizedForms = new Map();
  if (Array.isArray(pages)) {
    const ids = new Set();
    pages.forEach((page, index) => validatePage(page, index, problems, ids));
  }
  const formIds = new Set();
  if (Array.isArray(forms)) forms.forEach((form, index) => validateForm(form, index, problems, formIds, normalizedForms));
  if (Array.isArray(submissions)) {
    const ids = new Set();
    submissions.forEach((submission, index) => validateSubmission(submission, index, problems, ids, formIds));
  }
  const routes = { pages: new Map(), forms: new Map() };
  if (Array.isArray(pages) && Array.isArray(forms)) {
    const used = new Set();
    pages.forEach((page, index) => {
      if (!isObject(page) || !validName(page.name) || !UUID.test(page.id ?? '')) return;
      try {
        routes.pages.set(page.id, allocateRoute(page.name, used, page.id.slice(0, 8)));
      } catch (error) {
        addProblem(problems, `pages.json[${index}]`, error.message);
      }
    });
    forms.forEach((form, index) => {
      if (!isObject(form) || typeof form.slug !== 'string' || !UUID.test(form.id ?? '')) return;
      try {
        routes.forms.set(form.id, allocateRoute(form.slug, used, form.id.slice(0, 8)));
      } catch (error) {
        addProblem(problems, `forms.json[${index}]`, error.message);
      }
    });
  }
  return {
    valid: problems.length === 0,
    problems,
    files,
    checksum,
    counts: {
      pages: Array.isArray(pages) ? pages.length : 0,
      forms: Array.isArray(forms) ? forms.length : 0,
      submissions: Array.isArray(submissions) ? submissions.length : 0,
    },
    data: { owner, pages, forms, submissions, normalizedForms, routes },
  };
}

export async function inspectLocalData(dir) {
  const { data: _data, ...inspection } = await readAndInspect(dir);
  return inspection;
}

async function verifyOwnerPassword(owner, ownerPassword) {
  if (typeof ownerPassword !== 'string' || ownerPassword.length < 12 || ownerPassword.length > 256) return false;
  const actual = await scrypt(ownerPassword, owner.password.salt, 64);
  const expected = Buffer.from(owner.password.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function createRoute(client, { companyId, projectId, path, type }) {
  const result = await client.query(
    `INSERT INTO project_routes (company_id, project_id, path, content_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [companyId, projectId, path, type],
  );
  return result.rows[0].id;
}

export async function importLocalData({ dir, database, ownerPassword } = {}) {
  const inspection = await readAndInspect(dir);
  if (!inspection.valid) throw new Error(`Dados locais inválidos: ${inspection.problems.join('; ')}`);
  if (!(await verifyOwnerPassword(inspection.data.owner, ownerPassword))) throw new Error('Senha do dono inválida.');

  return withTransaction(database, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
      inspection.checksum.slice(0, 32),
      inspection.checksum.slice(32),
    ]);
    const previous = await client.query('SELECT report FROM local_imports WHERE checksum = $1', [inspection.checksum]);
    if (previous.rowCount) return previous.rows[0].report;

    const { owner, pages, forms, submissions, normalizedForms, routes } = inspection.data;
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [owner.email.trim().toLowerCase(), JSON.stringify(owner.password), owner.name.trim()],
    );
    const userId = userResult.rows[0].id;
    const companyResult = await client.query(
      `INSERT INTO companies (name, slug)
       VALUES ('Alva Marketing', 'alva-marketing')
       RETURNING id`,
    );
    const companyId = companyResult.rows[0].id;
    await client.query(
      `INSERT INTO company_memberships (company_id, user_id, role, status, joined_at)
       VALUES ($1, $2, 'owner', 'active', now())`,
      [companyId, userId],
    );
    const projectResult = await client.query(
      `INSERT INTO projects (company_id, name, slug, created_by)
       VALUES ($1, 'Projeto principal', 'principal', $2)
       RETURNING id`,
      [companyId, userId],
    );
    const projectId = projectResult.rows[0].id;
    for (const page of pages) {
      const path = routes.pages.get(page.id);
      const routeId = await createRoute(client, { companyId, projectId, path, type: 'page' });
      await client.query(
        `INSERT INTO pages
           (id, company_id, project_id, name, route_id, template, editor_state, rendered_html,
            lock_version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
        [
          page.id,
          companyId,
          projectId,
          page.name.trim(),
          routeId,
          page.template || null,
          JSON.stringify(page.project ?? {}),
          page.html,
          page.revision,
          userId,
          page.createdAt,
          page.updatedAt,
        ],
      );
    }

    const formVersions = new Map();
    for (const form of forms) {
      const path = routes.forms.get(form.id);
      const routeId = await createRoute(client, { companyId, projectId, path, type: 'form' });
      const schema = normalizedForms.get(form.id);
      await client.query(
        `INSERT INTO forms
           (id, company_id, project_id, name, route_id, draft_schema, lock_version,
            created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          form.id,
          companyId,
          projectId,
          form.name.trim(),
          routeId,
          JSON.stringify(schema),
          form.revision,
          userId,
          form.createdAt,
          form.updatedAt,
        ],
      );
      const versionResult = await client.query(
        `INSERT INTO form_versions
           (company_id, project_id, form_id, version_number, published_path, schema, created_by, created_at)
         VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6, $7)
         RETURNING id`,
        [companyId, projectId, form.id, path, JSON.stringify(schema), userId, form.updatedAt],
      );
      const versionId = versionResult.rows[0].id;
      formVersions.set(form.id, versionId);
      await client.query(
        'UPDATE forms SET published_version_id = $1 WHERE company_id = $2 AND project_id = $3 AND id = $4',
        [versionId, companyId, projectId, form.id],
      );
    }

    for (const submission of submissions) {
      await client.query(
        `INSERT INTO form_submissions
           (id, company_id, project_id, form_id, form_version_id, answers, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          submission.id,
          companyId,
          projectId,
          submission.formId,
          formVersions.get(submission.formId),
          JSON.stringify(submission.answers),
          submission.submittedAt,
        ],
      );
    }

    const importedAt = new Date().toISOString();
    const report = {
      checksum: inspection.checksum,
      files: inspection.files,
      counts: inspection.counts,
      userId,
      companyId,
      projectId,
      importedAt,
    };
    await client.query(
      `INSERT INTO local_imports (checksum, company_id, project_id, imported_at, report)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [inspection.checksum, companyId, projectId, importedAt, JSON.stringify(report)],
    );
    return report;
  });
}
