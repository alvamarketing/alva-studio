import { AuditRepository } from './repositories/publication-repository.mjs';
import { withTransaction } from './db/postgres.mjs';

const PROTOCOLS = new Set(['2025-03-26', '2025-06-18', '2025-11-25']);
const DEFAULT_PROTOCOL = '2025-06-18';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message, status = 400, code) {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}

function object(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

export const MCP_TOOLS = Object.freeze([
  {
    name: 'alva_get_project',
    description: 'Consulta o projeto autorizado por esta chave MCP.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'alva_list_pages',
    description: 'Lista as landing pages do projeto autorizado.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'alva_list_quizzes',
    description: 'Lista os quizzes do projeto autorizado.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'alva_get_content',
    description: 'Consulta uma landing page ou quiz do projeto autorizado.',
    inputSchema: object({ kind: { type: 'string', enum: ['page', 'quiz'] }, id: { type: 'string', format: 'uuid' } }, ['kind', 'id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'alva_create_page_draft',
    description: 'Cria um rascunho de landing page. Reutilize a mesma idempotency_key para o mesmo pedido.',
    inputSchema: object({ name: { type: 'string', minLength: 1, maxLength: 100 }, route: { type: 'string', minLength: 1, maxLength: 120 }, idempotency_key: { type: 'string', minLength: 8, maxLength: 160 } }, ['name', 'route', 'idempotency_key']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'alva_create_quiz_draft',
    description: 'Cria um rascunho de quiz. Reutilize a mesma idempotency_key para o mesmo pedido.',
    inputSchema: object({ name: { type: 'string', minLength: 1, maxLength: 100 }, route: { type: 'string', minLength: 1, maxLength: 120 }, idempotency_key: { type: 'string', minLength: 8, maxLength: 160 } }, ['name', 'route', 'idempotency_key']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
]);

function protocol(version) {
  if (typeof version === 'string' && PROTOCOLS.has(version)) return version;
  if (version === undefined || version === null || version === '') return DEFAULT_PROTOCOL;
  throw fail('Versão MCP não suportada.', 400);
}

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function content(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function plain(value, label = 'Argumentos') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw fail(`${label} inválidos.`);
  return value;
}

function exact(input, keys, required = []) {
  const value = plain(input);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw fail('Argumento MCP não permitido.');
  if (required.some((key) => value[key] === undefined)) throw fail('Argumento MCP obrigatório ausente.');
  return value;
}

function draftArgs(input) {
  const value = exact(input, ['name', 'route', 'idempotency_key'], ['name', 'route', 'idempotency_key']);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw fail('Nome do rascunho inválido.');
  if (typeof value.route !== 'string' || !value.route.startsWith('/') || value.route.length > 120) throw fail('Rota do rascunho inválida.');
  if (typeof value.idempotency_key !== 'string' || !/^[A-Za-z0-9._:-]{8,160}$/.test(value.idempotency_key)) throw fail('Chave de idempotência MCP inválida.');
  return value;
}

function scope(actor, required) {
  if (!actor.scopes.includes(required)) throw fail('Esta chave MCP não possui o escopo necessário.', 403);
}

function recordForAgent(record) {
  return { id: record.id, projectId: record.projectId, name: record.name, route: record.route, status: record.status, lockVersion: record.lockVersion, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export class McpServer {
  constructor({ keys, projects, content, audit, rateLimit = 60 } = {}) {
    if (!keys || !projects || !content) throw new Error('Dependências MCP obrigatórias ausentes.');
    this.keys = keys;
    this.projects = projects;
    this.content = content;
    this.audit = audit;
    this.rateLimit = rateLimit;
  }

  async tool(actor, name, args) {
    const scopeBase = { companyId: actor.companyId, projectId: actor.projectId, actorId: actor.actorUserId };
    if (name === 'alva_get_project') {
      exact(args, []);
      return this.projects.getAuthorized({ companyId: actor.companyId, projectId: actor.projectId, userId: actor.actorUserId });
    }
    if (name === 'alva_list_pages') {
      exact(args, []); scope(actor, 'read');
      return (await this.content.listPages(scopeBase)).map(recordForAgent);
    }
    if (name === 'alva_list_quizzes') {
      exact(args, []); scope(actor, 'read');
      return (await this.content.listForms(scopeBase)).map(recordForAgent);
    }
    if (name === 'alva_get_content') {
      const input = exact(args, ['kind', 'id'], ['kind', 'id']); scope(actor, 'read');
      if (!['page', 'quiz'].includes(input.kind) || typeof input.id !== 'string' || !UUID.test(input.id)) throw fail('Conteúdo MCP inválido.');
      return input.kind === 'page'
        ? this.content.getPage({ ...scopeBase, pageId: input.id })
        : this.content.getForm({ ...scopeBase, formId: input.id });
    }
    if (!['alva_create_page_draft', 'alva_create_quiz_draft'].includes(name)) throw fail('Ferramenta MCP não permitida.', 404);
    scope(actor, 'drafts');
    const input = draftArgs(args);
    const type = name === 'alva_create_page_draft' ? 'page' : 'quiz';
    const outcome = await withTransaction(this.keys.database, async (client) => {
      const operation = await this.keys.createOperation({
        keyId: actor.id, companyId: actor.companyId, projectId: actor.projectId, operation: `${type}_draft`, idempotencyKey: input.idempotency_key,
        request: { name: input.name, route: input.route }, client,
      });
      if (operation.existing) return { resourceId: operation.resource_id, created: null };
      const created = type === 'page'
        ? await this.content.createPage({ ...scopeBase, name: input.name, route: input.route, editorState: {}, renderedHtml: '', client })
        : await this.content.createForm({ ...scopeBase, name: input.name, route: input.route, draftSchema: {}, client });
      await this.keys.completeOperation({ id: operation.id, resourceType: type, resourceId: created.id, client });
      return { resourceId: created.id, created };
    });
    if (outcome.created) return outcome.created;
    if (!outcome.resourceId) throw fail('A operação idempotente não foi concluída. Tente novamente com uma nova chave de idempotência.', 409);
    return type === 'page'
      ? this.content.getPage({ ...scopeBase, pageId: outcome.resourceId })
      : this.content.getForm({ ...scopeBase, formId: outcome.resourceId });
  }

  async handle({ method, headers, raw }) {
    if (method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, body: { error: 'Método não permitido.' } };
    const authorization = String(headers.authorization || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return { status: 401, body: { error: 'Bearer MCP obrigatório.' } };
    if (!String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) return { status: 415, body: { error: 'Envie JSON-RPC como application/json.' } };
    let actor;
    try { actor = await this.keys.authenticate(match[1]); await this.keys.consumeRateLimit({ keyId: actor.id, limit: this.rateLimit }); }
    catch (error) { return { status: error.status || 401, body: { error: error.message || 'Chave MCP inválida.' } }; }
    let request;
    try { request = JSON.parse(Buffer.from(raw).toString('utf8')); }
    catch { return { status: 400, body: rpcError(null, -32700, 'JSON inválido.') }; }
    if (!request || Array.isArray(request) || typeof request !== 'object' || request.jsonrpc !== '2.0' || typeof request.method !== 'string')
      return { status: 400, body: rpcError(request?.id, -32600, 'Requisição JSON-RPC inválida.') };
    const initializedNotification = request.method === 'notifications/initialized';
    const validId = request.id === null || typeof request.id === 'string' || (typeof request.id === 'number' && Number.isFinite(request.id));
    if ((initializedNotification && Object.hasOwn(request, 'id')) || (!initializedNotification && !validId))
      return { status: 400, body: rpcError(null, -32600, 'Identificador JSON-RPC inválido.') };
    let version;
    try { version = protocol(headers['mcp-protocol-version'] || request.params?.protocolVersion); }
    catch (error) { return { status: 400, body: rpcError(request.id, -32602, error.message) }; }
    const responseHeaders = { 'MCP-Protocol-Version': version };
    if (initializedNotification) return { status: 202, headers: responseHeaders, body: null };
    try {
      let output;
      if (request.method === 'initialize') {
        output = { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'alva-studio', version: '1.0.0' }, instructions: 'Esta chave opera somente no projeto autorizado. Use ferramentas de leitura e rascunho; publicação exige ação humana no Studio.' };
      } else if (request.method === 'ping') output = {};
      else if (request.method === 'tools/list') output = { tools: MCP_TOOLS };
      else if (request.method === 'tools/call') {
        const params = exact(request.params, ['name', 'arguments'], ['name']);
        if (typeof params.name !== 'string') throw fail('Nome da ferramenta MCP inválido.');
        try {
          const value = await this.tool(actor, params.name, params.arguments ?? {});
          await this.audit?.record({ companyId: actor.companyId, projectId: actor.projectId, actorAgentKeyId: actor.id, action: 'mcp.tool.success', resourceType: 'agent_key', resourceId: actor.id, result: 'success', metadata: { tool: params.name } });
          output = content(value);
        } catch (error) {
          await this.audit?.record({ companyId: actor.companyId, projectId: actor.projectId, actorAgentKeyId: actor.id, action: 'mcp.tool.failure', resourceType: 'agent_key', resourceId: actor.id, result: 'failure', metadata: { tool: params.name, code: error.code || null } }).catch(() => {});
          output = content({ error: error.message || 'Falha na ferramenta MCP.', code: error.code || null }, true);
        }
      } else return { status: 200, headers: responseHeaders, body: rpcError(request.id, -32601, 'Método MCP não encontrado.') };
      return { status: 200, headers: responseHeaders, body: result(request.id, output) };
    } catch (error) {
      return { status: 200, headers: responseHeaders, body: rpcError(request.id, -32602, error.message || 'Parâmetros inválidos.') };
    }
  }
}

export function createMcpServer({ database, keys, projects, content, rateLimit } = {}) {
  return new McpServer({ keys, projects, content, audit: database ? new AuditRepository(database) : null, rateLimit });
}
