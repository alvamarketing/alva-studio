import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeploymentRepository } from '../server/repositories/publication-repository.mjs';
import { Publisher } from '../server/publisher.mjs';

class DeploymentDatabase {
  constructor() { this.rows = []; }
  async query(sql, params) {
    if (sql.includes('SELECT') && sql.includes('deployment_runs')) {
      const row = this.rows.find((item) => item.project_id === params[0] && item.environment === params[1] && item.idempotency_key === params[2]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO deployment_runs')) {
      const existing = this.rows.find((item) => item.project_id === params[1] && item.environment === params[2] && item.idempotency_key === params[4]);
      if (existing) return { rows: [] };
      const row = { id: `run-${this.rows.length + 1}`, company_id: params[0], project_id: params[1], environment: params[2], snapshot_hash: params[3], idempotency_key: params[4], expected_revision: params[5], status: 'queued' };
      this.rows.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  }
}

test('execução combina ambiente e hash e repete sem criar novo deploy', async () => {
  const repository = new DeploymentRepository(new DeploymentDatabase());
  const first = await repository.createOrGet({ companyId: 'company-a', projectId: 'project-a', environment: 'preview', snapshotHash: 'a'.repeat(64), expectedRevision: 2, requestedBy: 'user-a' });
  const repeated = await repository.createOrGet({ companyId: 'company-a', projectId: 'project-a', environment: 'preview', snapshotHash: 'a'.repeat(64), expectedRevision: 2, requestedBy: 'user-a' });
  assert.equal(repeated.id, first.id);
  await assert.rejects(
    () => repository.createOrGet({ companyId: 'company-a', projectId: 'project-a', environment: 'preview', snapshotHash: 'b'.repeat(64), expectedRevision: 2, requestedBy: 'user-a', idempotencyKey: first.idempotencyKey }),
    /idempotência|conteúdo/i,
  );
});

test('publicador envia todas as rotas para o projeto estável e separa preview de produção', async () => {
  const calls = [];
  const publisher = new Publisher({
    token: 'private-token',
    teamId: 'team_123',
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: 'dpl_1', projectId: 'prj_stable', url: 'preview.example.test', readyState: 'QUEUED' }));
    },
  });
  const files = [{ file: 'index.html', data: '<h1>Home</h1>' }, { file: 'captura/index.html', data: '<h1>Captura</h1>' }];
  await publisher.publish({ projectId: 'prj_stable', environment: 'preview', files });
  const previewBody = JSON.parse(calls[0].options.body);
  assert.equal(previewBody.project, 'prj_stable');
  assert.equal(previewBody.target, undefined);
  assert.deepEqual(previewBody.files, files);
  await publisher.publish({ projectId: 'prj_stable', environment: 'production', files });
  assert.equal(JSON.parse(calls[1].options.body).target, 'production');
  assert.ok(!calls[0].options.body.includes('private-token'));
});

test('publicador repete somente erros temporários', async () => {
  let attempts = 0;
  const publisher = new Publisher({
    token: 'private-token',
    fetcher: async () => {
      attempts += 1;
      if (attempts < 3) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
      return new Response(JSON.stringify({ id: 'dpl_2', readyState: 'READY' }));
    },
    retryDelay: 0,
  });
  const result = await publisher.publish({ projectId: 'prj_stable', environment: 'preview', files: [{ file: 'index.html', data: 'ok' }] });
  assert.equal(result.id, 'dpl_2');
  assert.equal(attempts, 3);
});
