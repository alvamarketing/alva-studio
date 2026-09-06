import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import { LOCAL_CERTIFICATION_STAGES, runLocalCommercialCertification } from '../../../runtime/commercial-local-certification.mjs';
import { BillingService } from '../server/billing-service.mjs';
import { processDueBillingEvents } from '../server/billing-worker.mjs';
import { CommercialConversionService } from '../server/commercial-conversion-service.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { createMcpServer } from '../server/mcp-server.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { processDueTrackingProvisionJobs } from '../server/tracking-provision-worker.mjs';
import { readRuntimeFlags } from '../server/runtime-flags.mjs';
import { BillingRepository } from '../server/repositories/billing-repository.mjs';
import { CompanyRepository } from '../server/repositories/company-repository.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { McpKeyRepository } from '../server/repositories/mcp-repository.mjs';
import { NvsCommercialOutboxRepository } from '../server/repositories/nvs-commercial-outbox-repository.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { AuditRepository, DeploymentRepository, ProjectIntegrationRepository, SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../..', import.meta.url));

function assertSanitizedOutboxPayload(payload, { trackingEventId, fbc, personalValues }) {
  assert.equal(payload.tracking_event_id, trackingEventId);
  assert.equal(payload.attribution?.fbc, fbc);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('sha256'), false);
  for (const value of personalValues) assert.equal(serialized.includes(value), false, `payload não pode conter ${value}`);
  const forbiddenKeys = new Set(['name', 'nome', 'email', 'phone', 'telefone', 'whatsapp', 'address', 'endereco', 'answers', 'respostas', 'email_sha256', 'phone_sha256']);
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `payload não pode conter a chave ${key}`);
      visit(nested);
    }
  };
  visit(payload);
}

async function mcpCall(server, token, { id, name, args }) {
  return server.handle({
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' },
    raw: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })),
  });
}

test('runner local executa a matriz comercial em ordem e exige flags seguras', async () => {
  const calls = [];
  const result = await runLocalCommercialCertification({
    environment: {},
    steps: Object.fromEntries(LOCAL_CERTIFICATION_STAGES.map((stage) => [stage, async () => {
      calls.push(stage);
      return { stage, status: 'passed' };
    }])),
  });

  assert.deepEqual(calls, LOCAL_CERTIFICATION_STAGES);
  assert.deepEqual(result.map((item) => item.stage), LOCAL_CERTIFICATION_STAGES);
  assert.throws(() => runLocalCommercialCertification({ environment: { MEDIA_PIPELINE_ENABLED: 'true' }, steps: {} }), /MEDIA_PIPELINE_ENABLED/);
});

test('matriz comercial local percorre dois tenants sem egress e preserva a última publicação pronta', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());

  const vault = new SecretVault({ masterKey: 'local-certification-master-key' });
  const companies = new CompanyRepository(database);
  const projects = new ProjectRepository(database);
  const tracking = new TrackingRepository(database, { vault });
  const commercialOutbox = new NvsCommercialOutboxRepository(database, { vault });
  const content = new ContentRepository(database, {
    publicOrigin: 'https://studio.local-cert.test',
    commercialOutbox,
    commercialConsentResolver: async ({ companyId }) => companyId === records.companyB?.id ? 'denied' : 'pending',
  });
  const records = {};
  const fakePublicationCalls = [];
  const conversionCalls = [];

  const results = await runLocalCommercialCertification({
    environment: {},
    steps: {
      creation: async () => {
        records.ownerA = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('owner-a@local-cert.test', 'hash', 'Owner A') RETURNING id")).rows[0];
        records.ownerB = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('owner-b@local-cert.test', 'hash', 'Owner B') RETURNING id")).rows[0];
        records.companyA = await companies.create({ ownerUserId: records.ownerA.id, name: 'Certificação A', slug: 'certificacao-a' });
        records.companyB = await companies.create({ ownerUserId: records.ownerB.id, name: 'Certificação B', slug: 'certificacao-b' });
        records.projectA = await projects.create({ companyId: records.companyA.id, actorUserId: records.ownerA.id, name: 'Projeto A', slug: 'projeto-a' });
        records.projectB = await projects.create({ companyId: records.companyB.id, actorUserId: records.ownerB.id, name: 'Projeto B', slug: 'projeto-b' });
        records.page = await content.createPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerA.id, name: 'Landing local', route: '/landing', editorState: {}, renderedHtml: '<main>local</main>' });
        records.pageB = await content.createPage({ companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerB.id, name: 'Landing local B', route: '/landing', editorState: {}, renderedHtml: '<main>local b</main>' });
        records.form = await content.createForm({
          companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerA.id, name: 'Quiz local', route: '/quiz',
          draftSchema: { headerElements: [], steps: [{ id: 'nome', type: 'text', title: 'Nome', required: true }, { id: 'email', type: 'email', title: 'E-mail', required: true }, { id: 'telefone', type: 'text', title: 'Telefone', required: true }], completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' }, webhook: '' },
        });
        records.formB = await content.createForm({
          companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerB.id, name: 'Quiz local B', route: '/quiz',
          draftSchema: { headerElements: [], steps: [{ id: 'nome', type: 'text', title: 'Nome', required: true }, { id: 'email', type: 'email', title: 'E-mail', required: true }, { id: 'telefone', type: 'text', title: 'Telefone', required: true }], completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' }, webhook: '' },
        });
        await content.publishPage({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerA.id, pageId: records.page.id });
        await content.publishForm({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerA.id, formId: records.form.id });
        await content.publishPage({ companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerB.id, pageId: records.pageB.id });
        await content.publishForm({ companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerB.id, formId: records.formB.id });
        return { status: 'passed' };
      },
      provisioning_fake: async () => {
        await tracking.ensureJobs({ companyId: records.companyA.id, projectId: records.projectA.id });
        await tracking.ensureJobs({ companyId: records.companyB.id, projectId: records.projectB.id });
        const processed = await processDueTrackingProvisionJobs({
          repository: tracking,
          clients: {
            umami: { provision: async ({ bindingId }) => ({ remoteId: bindingId }) },
            nvs: { provision: async ({ propertyId }) => ({ remoteId: propertyId }) },
          },
          maxPerRun: 8,
        });
        assert.equal(processed.processed, 8);
        const statuses = await Promise.all([
          tracking.status({ companyId: records.companyA.id, projectId: records.projectA.id }),
          tracking.status({ companyId: records.companyB.id, projectId: records.projectB.id }),
        ]);
        assert.ok(statuses.every((status) => status.bindings.every((binding) => binding.status === 'ready')));
        return { status: 'passed' };
      },
      publication_fake: async () => {
        const integrations = new ProjectIntegrationRepository(database, { vault });
        await integrations.save({ companyId: records.companyA.id, projectId: records.projectA.id, teamId: 'team_local', vercelProjectId: 'project_local', token: 'fake-local-publication-token' });
        await integrations.save({ companyId: records.companyB.id, projectId: records.projectB.id, teamId: 'team_localb', vercelProjectId: 'project_local_b', token: 'fake-local-publication-token-b' });
        const deployments = new DeploymentRepository(database);
        const service = new PublicationService({
          snapshotBuilder: { build: async ({ expectedRevision }) => ({ hash: String(expectedRevision === 1 ? 'a' : 'b').repeat(64), manifest: [], files: [{ file: 'index.html', data: '<main>local</main>' }] }) },
          integrations,
          deployments,
          audit: new AuditRepository(database),
          publisherFactory: () => ({ publish: async (input) => {
            fakePublicationCalls.push(input);
            if (input.snapshotHash === 'b'.repeat(64)) throw new Error('falha simulada de publicação');
            const suffix = input.projectId === 'project_local' ? 'a' : 'b';
            return { id: `deployment-local-${suffix}`, projectId: input.projectId, url: `https://local-cert-${suffix}.example.test`, state: 'READY' };
          } }),
        });
        records.preview = await service.preview({ companyId: records.companyA.id, projectId: records.projectA.id, requestedBy: records.ownerA.id, expectedRevision: 1, idempotencyKey: 'cert-preview-a' });
        records.previewB = await service.preview({ companyId: records.companyB.id, projectId: records.projectB.id, requestedBy: records.ownerB.id, expectedRevision: 1, idempotencyKey: 'cert-preview-b' });
        records.originA = 'https://local-cert-a.example.test';
        records.originB = 'https://local-cert-b.example.test';
        await assert.rejects(() => service.preview({ companyId: records.companyA.id, projectId: records.projectA.id, requestedBy: records.ownerA.id, expectedRevision: 2, idempotencyKey: 'cert-preview-b' }), /falha simulada/);
        const preserved = await deployments.latestReady({ companyId: records.companyA.id, projectId: records.projectA.id, environment: 'preview' });
        assert.equal(preserved.id, records.preview.id);
        assert.equal(await deployments.latestReady({ companyId: records.companyA.id, projectId: records.projectB.id, environment: 'preview' }), null);
        assert.equal(await deployments.latestReady({ companyId: records.companyB.id, projectId: records.projectA.id, environment: 'preview' }), null);
        await assert.rejects(() => service.publisher({ companyId: records.companyA.id, projectId: records.projectB.id }), /Conecte a Vercel/);
        await assert.rejects(() => service.publisher({ companyId: records.companyB.id, projectId: records.projectA.id }), /Conecte a Vercel/);
        assert.equal(fakePublicationCalls.length, 3);
        return { status: 'passed' };
      },
      visit_and_lead: async () => {
        const publicForm = await content.publicFormForProject({ companySlug: 'certificacao-a', projectSlug: 'projeto-a', route: '/quiz' });
        assert.equal(publicForm.id, records.form.id);
        const publicFormB = await content.publicFormForProject({ companySlug: 'certificacao-b', projectSlug: 'projeto-b', route: '/quiz' });
        assert.equal(publicFormB.id, records.formB.id);
        await assert.rejects(() => content.publicFormForProject({ companySlug: 'certificacao-a', projectSlug: 'projeto-b', route: '/quiz' }), /não encontrado/);
        await assert.rejects(() => content.publicFormForProject({ companySlug: 'certificacao-b', projectSlug: 'projeto-a', route: '/quiz' }), /não encontrado/);
        await assert.rejects(() => content.submitPublicFormForProject({ companySlug: 'certificacao-a', projectSlug: 'projeto-b', route: '/quiz', origin: records.originA, input: { answers: {} } }), /não encontrado/);
        await assert.rejects(() => content.submitPublicFormForProject({ companySlug: 'certificacao-b', projectSlug: 'projeto-a', route: '/quiz', origin: records.originB, input: { answers: {} } }), /não encontrado/);
        records.submission = await content.submitPublicFormForProject({
          companySlug: 'certificacao-a', projectSlug: 'projeto-a', route: '/quiz', origin: records.originA, publicationId: records.preview.id,
          subjectId: 'local-certification-subject-0001', attribution: { fbc: 'fb.local.cert.a' }, input: { answers: { nome: 'Nome local A', email: 'lead-a@local-cert.test', telefone: '+55 11 99999-0001' } },
        });
        records.submissionB = await content.submitPublicFormForProject({
          companySlug: 'certificacao-b', projectSlug: 'projeto-b', route: '/quiz', origin: records.originB, publicationId: records.previewB.id,
          subjectId: 'local-certification-subject-0002', attribution: { fbc: 'fb.local.cert.b' }, input: { answers: { nome: 'Nome local B', email: 'lead-b@local-cert.test', telefone: '+55 11 99999-0002' } },
        });
        assert.equal(records.submission.form.projectId, records.projectA.id);
        assert.equal(records.submissionB.form.projectId, records.projectB.id);
        assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions WHERE company_id = $1', [records.companyA.id])).rows[0].count, 1);
        assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions WHERE company_id = $1', [records.companyB.id])).rows[0].count, 1);
        const outboxA = (await database.query('SELECT payload FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2', [records.companyA.id, records.projectA.id])).rows[0].payload;
        const outboxB = (await database.query('SELECT payload FROM nvs_commercial_outbox WHERE company_id = $1 AND project_id = $2', [records.companyB.id, records.projectB.id])).rows[0].payload;
        assertSanitizedOutboxPayload(outboxA, { trackingEventId: records.submission.eventId, fbc: 'fb.local.cert.a', personalValues: ['Nome local A', 'lead-a@local-cert.test', '+55 11 99999-0001'] });
        assertSanitizedOutboxPayload(outboxB, { trackingEventId: records.submissionB.eventId, fbc: 'fb.local.cert.b', personalValues: ['Nome local B', 'lead-b@local-cert.test', '+55 11 99999-0002'] });
        assert.deepEqual(await commercialOutbox.status({ companyId: records.companyA.id, projectId: records.projectB.id }), []);
        assert.deepEqual(await commercialOutbox.status({ companyId: records.companyB.id, projectId: records.projectA.id }), []);
        return { status: 'passed' };
      },
      conversion_fake: async () => {
        const service = new CommercialConversionService({
          persist: async (payload) => conversionCalls.push(['persist', payload]),
          enqueueNvs: async (payload) => conversionCalls.push(['nvs', payload]),
          adapters: { meta: async (payload) => conversionCalls.push(['meta', payload]) },
          technicalEnabled: (provider) => provider === 'meta',
        });
        const manifest = { companyId: records.companyA.id, projectId: records.projectA.id, publicationId: records.preview.id, snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://local-cert-a.example.test', domain: 'local-cert-a.example.test', environment: 'preview' };
        const outcome = await service.deliver({
          manifest, storedConsent: { scope: manifest, state: 'pending' }, serverAnswers: records.submission.answers,
          browserEvent: { trackingEventId: records.submission.eventId, eventName: 'lead', eventTime: 1_700_000_000, contentId: records.form.id, attribution: { fbc: 'fb.local.cert.a' } }, enabledProviders: ['meta'],
        });
        assert.equal(outcome.trackingEventId, records.submission.eventId);
        assert.equal(JSON.stringify(conversionCalls).includes('lead-a@local-cert.test'), false);
        assert.equal(JSON.stringify(conversionCalls).includes('email_sha256'), false);
        assert.equal((await database.query('SELECT count(*)::int AS count FROM nvs_commercial_outbox WHERE company_id = $1', [records.companyA.id])).rows[0].count, 1);
        return { status: 'passed' };
      },
      billing_fake: async () => {
        const billing = new BillingRepository(database);
        let checkoutNumber = 0;
        await billing.seedInitialPlan({ environment: 'sandbox' });
        const service = new BillingService({
          repository: billing, environment: 'sandbox', site: 'https://studio.local-cert.test', today: () => '2026-09-06',
          clientFactory: () => ({ createCheckout: async () => ({ id: `checkout_local_cert_${++checkoutNumber}` }) }),
        });
        const order = await service.checkout({ companyId: records.companyA.id, idempotencyKey: 'local-cert-checkout' });
        const orderB = await service.checkout({ companyId: records.companyB.id, idempotencyKey: 'local-cert-checkout-b' });
        assert.equal(order.status, 'pending');
        assert.equal(orderB.status, 'pending');
        assert.equal(await billing.order({ companyId: records.companyA.id, environment: 'sandbox', orderId: orderB.id }), null);
        assert.equal(await billing.order({ companyId: records.companyB.id, environment: 'sandbox', orderId: order.id }), null);
        await billing.inboxWebhook({ environment: 'sandbox', raw: '{"local":true}', providerEventId: 'event_local_cert', eventType: 'PAYMENT_CONFIRMED', paymentId: 'payment_local_cert' });
        const worker = await processDueBillingEvents({
          repository: billing,
          clientFactory: () => ({
            getPayment: async () => ({ id: 'payment_local_cert', status: 'CONFIRMED', value: 49, currency: 'BRL', customer: 'customer_local_cert', subscription: 'subscription_local_cert', externalReference: order.id, dueDate: '2026-09-06' }),
            getSubscription: async () => ({ id: 'subscription_local_cert', customer: 'customer_local_cert', externalReference: order.id }),
          }),
          maxPerRun: 1,
        });
        assert.equal(worker.processed, 1);
        assert.equal((await billing.summary({ companyId: records.companyA.id, environment: 'sandbox' })).entitlement.status, 'active');
        assert.equal((await billing.summary({ companyId: records.companyB.id, environment: 'sandbox' })).entitlement.status, 'pending');
        return { status: 'passed' };
      },
      mcp: async () => {
        const keys = new McpKeyRepository(database);
        const key = await keys.create({ companyId: records.companyA.id, projectId: records.projectA.id, actorUserId: records.ownerA.id, name: 'Certificação local', scopes: ['read', 'drafts'], expiresInDays: 7 });
        const keyB = await keys.create({ companyId: records.companyB.id, projectId: records.projectB.id, actorUserId: records.ownerB.id, name: 'Certificação local B', scopes: ['read', 'drafts'], expiresInDays: 7 });
        const server = createMcpServer({ database, keys, projects, content, rateLimit: 10 });
        const response = await mcpCall(server, key.token, { id: 1, name: 'alva_create_page_draft', args: { name: 'Rascunho MCP', route: '/rascunho-mcp', idempotency_key: 'local-mcp-draft-001' } });
        assert.equal(response.status, 200);
        const draft = JSON.parse(response.body.result.content[0].text);
        assert.equal(draft.projectId, records.projectA.id);
        const cross = await mcpCall(server, keyB.token, { id: 2, name: 'alva_get_content', args: { kind: 'page', id: records.page.id } });
        assert.equal(cross.status, 200);
        assert.equal(cross.body.result.isError, true);
        assert.match(cross.body.result.content[0].text, /Página não encontrada/);
        const bPages = await mcpCall(server, keyB.token, { id: 3, name: 'alva_list_pages', args: {} });
        const listed = JSON.parse(bPages.body.result.content[0].text);
        assert.deepEqual(listed.map((page) => page.projectId), [records.projectB.id]);
        return { status: 'passed' };
      },
      tenant_isolation: async () => {
        assert.deepEqual((await content.listPages({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerA.id })).map((page) => page.projectId), [records.projectA.id, records.projectA.id]);
        assert.deepEqual((await content.listPages({ companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerB.id })).map((page) => page.projectId), [records.projectB.id]);
        await assert.rejects(() => content.listPages({ companyId: records.companyA.id, projectId: records.projectA.id, actorId: records.ownerB.id }), /Projeto não encontrado/);
        await assert.rejects(() => content.listPages({ companyId: records.companyB.id, projectId: records.projectB.id, actorId: records.ownerA.id }), /Projeto não encontrado/);
        await assert.rejects(() => projects.getAuthorized({ companyId: records.companyA.id, projectId: records.projectB.id, userId: records.ownerA.id }), /Projeto não encontrado/);
        assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions WHERE company_id = $1', [records.companyA.id])).rows[0].count, 1);
        assert.equal((await database.query('SELECT count(*)::int AS count FROM form_submissions WHERE company_id = $1', [records.companyB.id])).rows[0].count, 1);
        return { status: 'passed' };
      },
      publication_rollback: async () => {
        assert.deepEqual(readRuntimeFlags({}), { umamiRuntime: false, nvsRuntime: false, pixels: false, mediaPipeline: false, billingEnforcement: false });
        assert.equal(fakePublicationCalls.some((call) => call.snapshotHash === 'a'.repeat(64)), true);
        return { status: 'passed' };
      },
    },
  });

  assert.ok(results.every((item) => item.status === 'passed'));
});

function dockerInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || `docker exited ${code}`)));
    child.stdin.end(input);
  });
}

test('backup PostgreSQL local restaura a linha original após mutação', async (t) => {
  const { connectionString, containerId } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());

  await database.query("CREATE TABLE certification_backup_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO certification_backup_probe VALUES (1, 'before');");
  const dump = (await exec('docker', ['exec', containerId, 'pg_dump', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--table=certification_backup_probe', '-U', 'studio', '-d', 'studio_test'])).stdout;
  await database.query("UPDATE certification_backup_probe SET value = 'after' WHERE id = 1");
  await dockerInput(['exec', '-i', containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'studio', '-d', 'studio_test'], dump);
  const restored = await database.query('SELECT value FROM certification_backup_probe WHERE id = 1');
  assert.equal(restored.rows[0].value, 'before');
});

test('evidência local documenta o escopo e as lacunas da certificação comercial', async () => {
  const [runbook, state, graph] = await Promise.all([
    readFile(`${root}/runtime/RUNBOOK.md`, 'utf8'),
    readFile(`${root}/.estado/certificacao_comercial_v1.md`, 'utf8'),
    readFile(`${root}/produto/grafo.yaml`, 'utf8'),
  ]);
  assert.match(runbook, /Certificação local da V1/);
  assert.match(runbook, /Vercel de staging, Asaas Sandbox e revisão visual/);
  assert.match(state, /status: pendente/);
  assert.match(state, /VSL própria pertence à V2/);
  assert.match(state, /STUDIO_DATABASE_URL/);
  assert.match(graph, /id: certificacao_comercial_v1/);
});
