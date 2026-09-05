import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';

function request(bodyValue = {}) { return { socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json' }, bodyValue }; }

test('APIs do projeto encaminham preview, produção confirmada, status e domínio', async () => {
  const calls = [];
  const sessionService = {
    async require() { return { user: { id: 'user-a' }, companyId: 'company-a', currentProjectId: 'project-a' }; },
    async authorize(_context, capability, projectId) { calls.push(['authorize', capability, projectId]); },
  };
  const integrations = {
    async publicSettings() { return { provider: 'vercel', environment: 'production', connectionStatus: 'configured', teamId: 'team_1', vercelProjectId: 'prj_1' }; },
    async credentials() { return { token: 'secret', vercelProjectId: 'prj_1' }; },
  };
  const publication = {
    async preview(input) { calls.push(['preview', input]); return { id: 'run-preview', status: 'QUEUED' }; },
    async production(input) { calls.push(['production', input]); return { id: 'run-production', status: 'READY' }; },
    async status(input) { calls.push(['status', input]); return { id: input.runId, status: 'READY' }; },
    async domain(input) { calls.push(['domain', input]); return { name: input.domain, verified: true }; },
    publisher: async () => ({ publisher: { testConnection: async () => ({ ok: true }) } }),
  };
  const api = createProjectApi({ sessionService, integrations, publication, body: async (req) => req.bodyValue });
  const json = (value, status = 200) => ({ value, status });
  let result = await api({ req: request({ revision: 4 }), res: {}, path: '/api/projects/project-a/publication/preview', method: 'POST', json });
  assert.equal(result.value.id, 'run-preview');
  result = await api({ req: request({ confirmed: true, previewRunId: 'run-preview', revision: 4 }), res: {}, path: '/api/projects/project-a/publication/production', method: 'POST', json });
  assert.equal(result.value.id, 'run-production');
  result = await api({ req: request(), res: {}, path: '/api/projects/project-a/publication/runs/run-preview', method: 'GET', json });
  assert.equal(result.value.status, 'READY');
  result = await api({ req: request({ runId: 'run-production', domain: 'lp.alva.test' }), res: {}, path: '/api/projects/project-a/publication/domain', method: 'POST', json });
  assert.equal(result.value.verified, true);
  assert.deepEqual(calls.filter(([name, capability]) => name === 'authorize' && capability).map(([, capability]) => capability), ['deployment.publish', 'deployment.publish', 'deployment.publish', 'integration.manage']);
});

test('rotas legadas passam revisão ao publishPage e usam publication.status no status', async () => {
  const calls = [];
  const sessionService = {
    async require() { return { user: { id: 'user-a' }, companyId: 'company-a', currentProjectId: 'project-a' }; },
    async authorize() {},
  };
  const content = {
    async publishPage(input) { calls.push(['publishPage', input]); return { id: 'version-1' }; },
    async getPage() { return { id: 'page-a', projectId: 'project-a', lockVersion: 8, editorState: {}, renderedHtml: '<p>ok</p>' }; },
  };
  const publication = {
    async preview() { return { id: 'preview-1', status: 'QUEUED' }; },
    async overview() { calls.push(['overview']); return { production: { id: 'run-production' }, preview: { id: 'run-preview' } }; },
    async status(input) { calls.push(['status', input]); return { id: input.runId, status: 'READY' }; },
  };
  const api = createProjectApi({ sessionService, integrations: {}, publication, content, body: async (req) => req.bodyValue });
  const json = (value, status = 200) => ({ value, status });
  const requestWith = (bodyValue) => ({ ...request(bodyValue), bodyValue });
  await api({ req: requestWith({ revision: 7 }), res: {}, path: '/api/pages/page-a/publish', method: 'POST', json });
  assert.equal(calls.find(([name]) => name === 'publishPage')[1].lockVersion, 7);
  const result = await api({ req: requestWith(), res: {}, path: '/api/pages/page-a/status', method: 'GET', json });
  assert.equal(result.value.status, 'READY');
  assert.deepEqual(calls.at(-1), ['status', { companyId: 'company-a', projectId: 'project-a', runId: 'run-preview' }]);
});
