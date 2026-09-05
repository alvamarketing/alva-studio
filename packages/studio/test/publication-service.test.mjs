import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicationService } from '../server/publication-service.mjs';

test('preview publica o snapshot inteiro e repetição não cria deploy externo', async () => {
  const calls = [];
  const deployments = {
    async createOrGet(input) { calls.push(['create', input]); return { id: 'run-1', ...input, status: 'queued', externalDeploymentId: null }; },
    async updateExternal(input) { calls.push(['external', input]); return { id: 'run-1', ...input, status: 'QUEUED', externalDeploymentId: 'dpl-1' }; },
  };
  const service = new PublicationService({
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [{ path: '/' }, { path: '/captura' }], files: [{ file: 'index.html', data: 'home' }, { file: 'captura/index.html', data: 'form' }] }) },
    integrations: { credentials: async () => ({ token: 'private-token', teamId: 'team_1', vercelProjectId: 'prj_1' }) },
    deployments,
    publisherFactory: (credentials) => ({ publish: async (input) => { calls.push(['publish', credentials, input]); return { id: 'dpl-1', projectId: 'prj_1', state: 'QUEUED', url: 'preview.example' }; } }),
    audit: { record: async () => {} },
  });
  const result = await service.preview({ companyId: 'company-a', projectId: 'project-a', requestedBy: 'user-a', expectedRevision: 3 });
  assert.equal(result.externalDeploymentId, 'dpl-1');
  assert.equal(calls.find((call) => call[0] === 'publish')[2].files.length, 2);
  assert.equal(calls.find((call) => call[0] === 'publish')[2].environment, 'preview');
});

test('produção exige confirmação e preview READY do mesmo snapshot', async () => {
  const service = new PublicationService({
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [{ file: 'index.html', data: 'home' }] }) },
    integrations: { credentials: async () => ({ token: 'token', vercelProjectId: 'prj_1' }) },
    deployments: {
      async find() { return { id: 'preview-1', environment: 'preview', status: 'READY', snapshotHash: 'a'.repeat(64), externalProjectId: 'prj_1' }; },
      async createOrGet(input) { return { id: 'production-1', ...input, externalDeploymentId: null, status: 'queued' }; },
      async updateExternal(input) { return { id: 'production-1', ...input, status: 'READY', externalDeploymentId: 'dpl-2' }; },
    },
    publisherFactory: () => ({ publish: async () => ({ id: 'dpl-2', state: 'READY', projectId: 'prj_1' }) }),
    audit: { record: async () => {} },
  });
  await assert.rejects(() => service.production({ companyId: 'company-a', projectId: 'project-a', requestedBy: 'user-a', previewRunId: 'preview-1' }), /confirmação/i);
  const result = await service.production({ companyId: 'company-a', projectId: 'project-a', requestedBy: 'user-a', previewRunId: 'preview-1', confirmed: true, expectedRevision: 3 });
  assert.equal(result.externalDeploymentId, 'dpl-2');
});

test('claim atômico impede segundo POST e execução ERROR sem ID não recomeça', async () => {
  let posts = 0;
  const base = {
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [{ file: 'index.html', data: 'x' }] }) },
    integrations: { credentials: async () => ({ token: 'token', vercelProjectId: 'prj_1' }) },
    deployments: {
      async createOrGet(input) { return { id: 'run-1', ...input, status: 'queued', externalDeploymentId: null }; },
      async claim() { return { claimed: false, run: { id: 'run-1', status: 'INITIALIZING', externalDeploymentId: null } }; },
    },
    publisherFactory: () => ({ publish: async () => { posts += 1; return { id: 'dpl' }; } }),
    audit: { record: async () => {} },
  };
  const service = new PublicationService(base);
  const result = await service.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 0 });
  assert.equal(result.status, 'INITIALIZING');
  assert.equal(posts, 0);
  const errorService = new PublicationService({ ...base, deployments: { ...base.deployments, async createOrGet(input) { return { id: 'run-error', ...input, status: 'ERROR', externalDeploymentId: null, error: 'falhou' }; } } });
  const errorResult = await errorService.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 0 });
  assert.equal(errorResult.status, 'ERROR');
  assert.equal(posts, 0);
});

test('resposta externa sem ID vira ERROR persistido e não pode ser republicada', async () => {
  let posts = 0;
  let run = { id: 'run-missing-id', status: 'queued', externalDeploymentId: null };
  const deployments = {
    async createOrGet(input) { return { ...run, ...input }; },
    async claim() { return { claimed: true, run }; },
    async updateStatus(input) { run = { ...run, status: input.status, error: input.error }; return run; },
  };
  const service = new PublicationService({
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [{ file: 'index.html', data: 'x' }] }) },
    integrations: { credentials: async () => ({ token: 'token', vercelProjectId: 'prj_1' }) },
    deployments,
    publisherFactory: () => ({ publish: async () => { posts += 1; return {}; } }),
  });
  await assert.rejects(() => service.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 0 }), /identificador/i);
  assert.equal(run.status, 'ERROR');
  await service.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 0 });
  assert.equal(posts, 1);
});

test('produção rejeita preview de ambiente ou projeto externo diferente', async () => {
  const service = new PublicationService({
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [{ file: 'index.html', data: 'x' }] }) },
    integrations: { credentials: async () => ({ token: 'token', vercelProjectId: 'prj_current' }) },
    deployments: { async find() { return { id: 'preview', environment: 'production', status: 'READY', snapshotHash: 'a'.repeat(64), externalProjectId: 'prj_old' }; } },
    audit: { record: async () => {} },
  });
  await assert.rejects(() => service.production({ companyId: 'c', projectId: 'p', requestedBy: 'u', previewRunId: 'preview', confirmed: true, expectedRevision: 0 }), /prévia validada/i);
});

test('overview mantém a prévia READY separada da última produção', async () => {
  const production = { id: 'production-1', environment: 'production', status: 'READY' };
  const preview = { id: 'preview-building', environment: 'preview', status: 'BUILDING' };
  const previewReady = { id: 'preview-ready', environment: 'preview', status: 'READY' };
  const service = new PublicationService({
    integrations: { publicSettings: async () => ({ connectionStatus: 'configured' }) },
    deployments: {
      async latest({ environment }) { return environment === 'production' ? production : preview; },
      async latestReady() { return previewReady; },
    },
  });
  const result = await service.overview({ companyId: 'c', projectId: 'p' });
  assert.equal(result.run.id, 'production-1');
  assert.equal(result.preview.id, 'preview-building');
  assert.equal(result.latestPreviewReady.id, 'preview-ready');
});
