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

class ClaimDatabase {
  constructor() {
    this.row = {
      id: 'run-1', company_id: 'company-a', project_id: 'project-a', environment: 'preview',
      snapshot_hash: 'a'.repeat(64), idempotency_key: 'preview:key', expected_revision: 1, status: 'queued',
    };
  }

  async query(sql, params) {
    if (sql.includes('UPDATE deployment_runs')) {
      if (this.row.status === 'INITIALIZING' || this.row.external_deployment_id) return { rows: [] };
      this.row.status = 'INITIALIZING';
      this.row.claim_token = params[3];
      return { rows: [this.row] };
    }
    if (sql.includes('SELECT * FROM deployment_runs') && sql.includes('id = $3')) {
      return { rows: this.row.id === params[2] ? [this.row] : [] };
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

test('claim do repositório é atômico e o segundo chamador reutiliza a execução', async () => {
  const repository = new DeploymentRepository(new ClaimDatabase());
  const first = await repository.claim({ companyId: 'company-a', projectId: 'project-a', runId: 'run-1' });
  const second = await repository.claim({ companyId: 'company-a', projectId: 'project-a', runId: 'run-1' });
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.run.id, 'run-1');
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
  assert.deepEqual(previewBody.files, files.map((file) => ({ ...file, encoding: 'utf-8' })));
  await publisher.publish({ projectId: 'prj_stable', environment: 'production', files });
  assert.equal(JSON.parse(calls[1].options.body).target, 'production');
  assert.ok(!calls[0].options.body.includes('private-token'));
});

test('publicador repete somente consultas GET em erros temporários', async () => {
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
  const result = await publisher.status('dpl_2');
  assert.equal(result.id, 'dpl_2');
  assert.equal(attempts, 3);
});

test('retry de GET usa x-ratelimit-reset quando Retry-After não existe', async () => {
  let attempts = 0;
  const publisher = new Publisher({
    token: 'token', retryDelay: 10_000, fetcher: async () => {
      attempts += 1;
      if (attempts === 1) return new Response('', { status: 429, headers: { 'x-ratelimit-reset': String(Date.now()) } });
      return new Response(JSON.stringify({ id: 'dpl_reset', readyState: 'READY' }));
    },
  });
  const result = await publisher.status('dpl_reset');
  assert.equal(result.state, 'READY');
  assert.equal(attempts, 2);
});

test('deployment inline declara UTF-8 e timeout não repete POST', async () => {
  let attempts = 0;
  const publisher = new Publisher({ token: 'token', retryDelay: 0, fetcher: async (_url, options) => {
    attempts += 1;
    assert.equal(JSON.parse(options.body).files[0].encoding, 'utf-8');
    return new Response('', { status: 503 });
  } });
  await assert.rejects(() => publisher.publish({ projectId: 'prj', environment: 'preview', files: [{ file: 'index.html', data: 'ok', encoding: 'utf-8' }] }), /503/);
  assert.equal(attempts, 1);
});

test('status INITIALIZING é transitório e estados terminais são reconhecidos', async () => {
  const publisher = new Publisher({ token: 'token', fetcher: async () => new Response(JSON.stringify({ id: 'dpl_1', readyState: 'INITIALIZING' })) });
  const initializing = await publisher.status('dpl_1');
  assert.equal(initializing.state, 'INITIALIZING');
  assert.equal(initializing.terminal, false);
});

test('repositório persiste INITIALIZING e erro da execução', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /error/);
      return { rows: [{ id: params[2], company_id: params[0], project_id: params[1], status: params[3], error: params[5] }] };
    },
  };
  const repository = new DeploymentRepository(database);
  const result = await repository.updateStatus({ companyId: 'company-a', projectId: 'project-a', runId: 'run-1', status: 'INITIALIZING', error: 'falhou' });
  assert.equal(result.status, 'INITIALIZING');
  assert.equal(result.error, 'falhou');
});
