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
      async find() { return { id: 'preview-1', status: 'READY', snapshotHash: 'a'.repeat(64) }; },
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
