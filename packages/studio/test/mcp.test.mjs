import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { createApp } from '../server/index.mjs';
import { SessionService } from '../server/session-service.mjs';
import { McpKeyRepository } from '../server/repositories/mcp-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function harness(t) {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const user = (await database.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ('mcp@alva.test', 'scrypt-v1$00$00', 'MCP') RETURNING id",
  )).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('MCP', 'mcp') RETURNING id")).rows[0];
  const membership = (await database.query(
    "INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now()) RETURNING id",
    [company.id, user.id],
  )).rows[0];
  const project = (await database.query(
    "INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto MCP', 'mcp', $2) RETURNING id",
    [company.id, user.id],
  )).rows[0];
  return { database, repository: new McpKeyRepository(database), user, company, membership, project };
}

test('chave MCP exibe segredo uma vez, armazena hash e revalida membership e projeto', async (t) => {
  const { database, repository, user, company, project } = await harness(t);
  const created = await repository.create({
    companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['read', 'drafts'], expiresInDays: 30,
  });
  assert.match(created.token, /^alva_[A-Za-z0-9_-]{43}$/);
  assert.equal((await database.query('SELECT token_hash FROM agent_keys WHERE id = $1', [created.key.id])).rows[0].token_hash === created.token, false);
  const authenticated = await repository.authenticate(created.token);
  assert.equal(authenticated.projectId, project.id);
  await database.query("UPDATE company_memberships SET status = 'suspended' WHERE company_id = $1 AND user_id = $2", [company.id, user.id]);
  await assert.rejects(() => repository.authenticate(created.token), (error) => error.status === 401);
});

test('chave MCP expirada ou revogada não autentica', async (t) => {
  const { database, repository, user, company, project } = await harness(t);
  const created = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['read'], expiresInDays: 1 });
  await database.query("UPDATE agent_keys SET expires_at = now() - interval '1 second' WHERE id = $1", [created.key.id]);
  await assert.rejects(() => repository.authenticate(created.token), (error) => error.status === 401);
  const next = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Hermes', scopes: ['read'], expiresInDays: 1 });
  await repository.revoke({ companyId: company.id, projectId: project.id, actorUserId: user.id, keyId: next.key.id });
  await assert.rejects(() => repository.authenticate(next.token), (error) => error.status === 401);
});

test('idempotência MCP é durável por chave, projeto e operação e recusa outro payload', async (t) => {
  const { repository, user, company, project } = await harness(t);
  const created = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['drafts'], expiresInDays: 30 });
  const first = await repository.createOperation({ keyId: created.key.id, companyId: company.id, projectId: project.id, operation: 'page_draft', idempotencyKey: 'draft-001', request: { name: 'Página' } });
  const second = await repository.createOperation({ keyId: created.key.id, companyId: company.id, projectId: project.id, operation: 'page_draft', idempotencyKey: 'draft-001', request: { name: 'Página' } });
  assert.equal(first.id, second.id);
  await assert.rejects(() => repository.createOperation({ keyId: created.key.id, companyId: company.id, projectId: project.id, operation: 'page_draft', idempotencyKey: 'draft-001', request: { name: 'Outra' } }), /idempotência/i);
});

test('rate limit MCP é atômico e persistente por chave', async (t) => {
  const { repository, user, company, project } = await harness(t);
  const created = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['read'], expiresInDays: 30 });
  await repository.consumeRateLimit({ keyId: created.key.id, limit: 2 });
  await repository.consumeRateLimit({ keyId: created.key.id, limit: 2 });
  await assert.rejects(() => repository.consumeRateLimit({ keyId: created.key.id, limit: 2 }), (error) => error.status === 429);
});

test('criação concorrente de chaves nunca ultrapassa o limite persistido', async (t) => {
  const { repository, user, company, project } = await harness(t);
  const attempts = await Promise.allSettled(Array.from({ length: 21 }, (_, index) => repository.create({
    companyId: company.id, projectId: project.id, actorUserId: user.id, name: `Agente ${index}`, scopes: ['read'], expiresInDays: 30,
  })));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 20);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected' && attempt.reason.status === 409).length, 1);
});

async function mcpRequest(base, token, payload, { method = 'POST', protocol = '2025-06-18' } = {}) {
  const response = await fetch(base + '/mcp', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': protocol,
    },
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
  });
  return { status: response.status, protocol: response.headers.get('mcp-protocol-version'), json: response.status === 202 ? null : await response.json() };
}

test('MCP negocia protocolo, expõe somente seis ferramentas e fixa o projeto da chave', async (t) => {
  const { database, repository, user, company, project } = await harness(t);
  const other = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Outro', 'outro', $2) RETURNING id", [company.id, user.id])).rows[0];
  const created = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['read', 'drafts'], expiresInDays: 30 });
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;

  const initialized = await mcpRequest(base, created.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
  assert.equal(initialized.status, 200);
  assert.equal(initialized.protocol, '2025-06-18');
  assert.equal(initialized.json.result.serverInfo.name, 'alva-studio');
  const tools = await mcpRequest(base, created.token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(tools.json.result.tools.map((tool) => tool.name).sort(), ['alva_create_page_draft', 'alva_create_quiz_draft', 'alva_get_content', 'alva_get_project', 'alva_list_pages', 'alva_list_quizzes']);
  const draft = await mcpRequest(base, created.token, {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'alva_create_page_draft', arguments: { name: 'Rascunho', route: '/rascunho', idempotency_key: 'mcp-draft-001', projectId: other.id } },
  });
  assert.equal(draft.status, 200);
  assert.equal(draft.json.result.isError, true);
  const validDraft = await mcpRequest(base, created.token, {
    jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'alva_create_page_draft', arguments: { name: 'Rascunho', route: '/rascunho', idempotency_key: 'mcp-draft-001' } },
  });
  assert.equal(validDraft.json.result.isError, undefined);
  const projectId = JSON.parse(validDraft.json.result.content[0].text).projectId;
  assert.equal(projectId, project.id);
  const same = await mcpRequest(base, created.token, {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'alva_create_page_draft', arguments: { name: 'Rascunho', route: '/rascunho', idempotency_key: 'mcp-draft-001' } },
  });
  assert.equal(JSON.parse(same.json.result.content[0].text).id, JSON.parse(validDraft.json.result.content[0].text).id);
  const forbidden = await mcpRequest(base, created.token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'alva_publicar', arguments: {} } });
  assert.equal(forbidden.json.result.isError, true);
  const audited = (await database.query("SELECT actor_agent_key_id, metadata FROM audit_events WHERE action = 'mcp.tool.success' ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.equal(audited.actor_agent_key_id, created.key.id);
  assert.equal(JSON.stringify(audited.metadata).includes(created.token), false);
  assert.equal((await mcpRequest(base, created.token, {}, { method: 'GET' })).status, 405);
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const batch = await mcpRequest(base, created.token, [{ jsonrpc: '2.0', id: 6, method: 'ping' }]);
  assert.equal(batch.status, 400);
  const crossOrigin = await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${created.token}`, Origin: 'https://forjado.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }) });
  assert.equal(crossOrigin.status, 403);
  const noId = await mcpRequest(base, created.token, { jsonrpc: '2.0', method: 'ping' });
  assert.equal(noId.status, 400);
  const nullId = await mcpRequest(base, created.token, { jsonrpc: '2.0', id: null, method: 'ping' });
  assert.equal(nullId.status, 200);
  assert.equal(nullId.json.id, null);
  assert.deepEqual(nullId.json.result, {});
  const notificationWithId = await mcpRequest(base, created.token, { jsonrpc: '2.0', id: 8, method: 'notifications/initialized' });
  assert.equal(notificationWithId.status, 400);
  const notification = await mcpRequest(base, created.token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
});

test('rascunho MCP é idempotente sob concorrência e rollback intermediário permite retry sem duplicar conteúdo', async (t) => {
  const { database, repository, user, company, project } = await harness(t);
  const created = await repository.create({ companyId: company.id, projectId: project.id, actorUserId: user.id, name: 'Claude', scopes: ['read', 'drafts'], expiresInDays: 30 });
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'alva_create_page_draft', arguments: { name: 'Concorrente', route: '/concorrente', idempotency_key: 'mcp-race-001' } } };
  const [first, second] = await Promise.all([mcpRequest(base, created.token, payload), mcpRequest(base, created.token, { ...payload, id: 2 })]);
  assert.equal(first.json.result.isError, undefined);
  assert.equal(second.json.result.isError, undefined);
  assert.equal(JSON.parse(first.json.result.content[0].text).id, JSON.parse(second.json.result.content[0].text).id);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM pages WHERE company_id = $1 AND project_id = $2', [company.id, project.id])).rows[0].count, 1);

  await database.query(`
    CREATE FUNCTION fail_mcp_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha intermediária MCP'; END; $$;
    CREATE TRIGGER fail_mcp_completion BEFORE UPDATE OF resource_id ON agent_key_operations
    FOR EACH ROW WHEN (NEW.resource_id IS NOT NULL) EXECUTE FUNCTION fail_mcp_completion();
  `);
  const failedPayload = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'alva_create_page_draft', arguments: { name: 'Retry', route: '/retry', idempotency_key: 'mcp-retry-001' } } };
  const failed = await mcpRequest(base, created.token, failedPayload);
  assert.equal(failed.json.result.isError, true);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM pages WHERE route_id IN (SELECT id FROM project_routes WHERE path = '/retry')")).rows[0].count, 0);
  await database.query('DROP TRIGGER fail_mcp_completion ON agent_key_operations; DROP FUNCTION fail_mcp_completion();');
  const retried = await mcpRequest(base, created.token, { ...failedPayload, id: 4 });
  assert.equal(retried.json.result.isError, undefined);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM pages WHERE route_id IN (SELECT id FROM project_routes WHERE path = '/retry')")).rows[0].count, 1);
});

test('API administrativa cria, lista e revoga chave MCP sem devolver segredo novamente', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const sessions = new SessionService(database);
  const context = await sessions.setup({ name: 'Admin', email: 'admin@mcp.test', password: 'senha-segura-123' });
  const headers = new Map();
  await sessions.issue({ setHeader: (name, value) => headers.set(name, value) }, context);
  const cookie = headers.get('Set-Cookie').split(';')[0];
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (path, method = 'GET', body) => fetch(base + path, {
    method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = await request(`/api/projects/${context.projectId}/mcp/keys`, 'POST', { name: 'Claude', scopes: ['read'], expiresInDays: 30 });
  assert.equal(create.status, 201);
  const body = await create.json();
  assert.match(body.token, /^alva_/);
  const listed = await request(`/api/projects/${context.projectId}/mcp/keys`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json())[0].token, undefined);
  const revoked = await request(`/api/projects/${context.projectId}/mcp/keys/${body.key.id}`, 'DELETE', {});
  assert.equal(revoked.status, 200);
  const actions = (await database.query("SELECT action, metadata FROM audit_events WHERE resource_id = $1 ORDER BY created_at", [body.key.id])).rows;
  assert.deepEqual(actions.map((row) => row.action).sort(), ['mcp.key.create', 'mcp.key.revoke']);
  assert.equal(JSON.stringify(actions).includes(body.token), false);
});

test('falha de auditoria faz rollback da criação de chave MCP sem devolver segredo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const sessions = new SessionService(database);
  const context = await sessions.setup({ name: 'Admin', email: 'audit@mcp.test', password: 'senha-segura-123' });
  const headers = new Map();
  await sessions.issue({ setHeader: (name, value) => headers.set(name, value) }, context);
  const cookie = headers.get('Set-Cookie').split(';')[0];
  await database.query(`
    CREATE FUNCTION fail_mcp_key_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha de auditoria MCP'; END; $$;
    CREATE TRIGGER fail_mcp_key_audit BEFORE INSERT ON audit_events
    FOR EACH ROW WHEN (NEW.action = 'mcp.key.create') EXECUTE FUNCTION fail_mcp_key_audit();
  `);
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const response = await fetch(`${base}/api/projects/${context.projectId}/mcp/keys`, {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Claude', scopes: ['read'], expiresInDays: 30 }),
  });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.token, undefined);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM agent_keys WHERE company_id = $1 AND project_id = $2', [context.companyId, context.projectId])).rows[0].count, 0);
});

test('falha de auditoria mantém chave MCP ativa e retry revoga uma vez', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const sessions = new SessionService(database);
  const context = await sessions.setup({ name: 'Admin', email: 'revoke@mcp.test', password: 'senha-segura-123' });
  const headers = new Map();
  await sessions.issue({ setHeader: (name, value) => headers.set(name, value) }, context);
  const cookie = headers.get('Set-Cookie').split(';')[0];
  const app = createApp({ database });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (path, method = 'GET', body) => fetch(base + path, {
    method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const created = await request(`/api/projects/${context.projectId}/mcp/keys`, 'POST', { name: 'Claude', scopes: ['read'], expiresInDays: 30 });
  assert.equal(created.status, 201);
  const key = (await created.json()).key;
  await database.query(`
    CREATE FUNCTION fail_mcp_key_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha de auditoria MCP'; END; $$;
    CREATE TRIGGER fail_mcp_key_revoke_audit BEFORE INSERT ON audit_events
    FOR EACH ROW WHEN (NEW.action = 'mcp.key.revoke') EXECUTE FUNCTION fail_mcp_key_revoke_audit();
  `);
  const failed = await request(`/api/projects/${context.projectId}/mcp/keys/${key.id}`, 'DELETE', {});
  assert.equal(failed.status, 500);
  assert.equal((await database.query('SELECT revoked_at FROM agent_keys WHERE id = $1', [key.id])).rows[0].revoked_at, null);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'mcp.key.revoke' AND resource_id = $1", [key.id])).rows[0].count, 0);
  await database.query('DROP TRIGGER fail_mcp_key_revoke_audit ON audit_events; DROP FUNCTION fail_mcp_key_revoke_audit();');
  const retried = await request(`/api/projects/${context.projectId}/mcp/keys/${key.id}`, 'DELETE', {});
  assert.equal(retried.status, 200);
  assert.ok((await database.query('SELECT revoked_at FROM agent_keys WHERE id = $1', [key.id])).rows[0].revoked_at);
  assert.equal((await database.query("SELECT count(*)::int AS count FROM audit_events WHERE action = 'mcp.key.revoke' AND resource_id = $1", [key.id])).rows[0].count, 1);
});
