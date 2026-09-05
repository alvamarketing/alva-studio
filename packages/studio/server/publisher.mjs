const TERMINAL = new Set(['READY', 'ERROR', 'CANCELED', 'BLOCKED']);

function fail(message, status = 400) { return Object.assign(new Error(message), { status, statusCode: status }); }
function transientStatus(status) { return status === 429 || status >= 500; }
function retryAfter(response, fallback) {
  const value = response.headers.get('retry-after');
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(30_000, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(30_000, date - Date.now())) : fallback;
}
function timeoutError(error) { return error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timeout/i.test(error?.message || ''); }

export class Publisher {
  constructor({ token, teamId, fetcher = fetch, retryLimit = 2, retryDelay = 250, timeoutMs = 30_000 } = {}) {
    this.token = token; this.teamId = teamId; this.fetcher = fetcher; this.retryLimit = retryLimit; this.retryDelay = retryDelay; this.timeoutMs = timeoutMs;
  }
  get connected() { return Boolean(this.token); }
  async request(path, body) {
    if (!this.token) throw fail('Conecte a Vercel nas configurações para publicar.', 400);
    const url = new URL('https://api.vercel.com' + path);
    if (this.teamId) url.searchParams.set('teamId', this.teamId);
    let lastError;
    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      let response;
      try {
        response = await this.fetcher(url.toString(), {
          method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (!timeoutError(error) || attempt >= this.retryLimit) throw fail('Não foi possível conectar à Vercel. Tente novamente.', 502);
        lastError = error; await new Promise((resolve) => setTimeout(resolve, this.retryDelay * 2 ** attempt)); continue;
      }
      if (response.ok) {
        try { return await response.json(); } catch { throw fail('A Vercel devolveu uma resposta inválida.', 502); }
      }
      if (!transientStatus(response.status) || attempt >= this.retryLimit)
        throw fail(`A Vercel recusou a solicitação (${response.status}). Verifique a conta e as permissões.`, 502);
      lastError = fail(`Vercel ${response.status}`, 502);
      await new Promise((resolve) => setTimeout(resolve, retryAfter(response, this.retryDelay * 2 ** attempt)));
    }
    throw lastError || fail('Não foi possível concluir a publicação.', 502);
  }
  async testConnection() {
    const { user } = await this.request('/v2/user');
    const team = this.teamId ? await this.request('/v2/teams/' + encodeURIComponent(this.teamId)) : null;
    return { ok: true, account: { name: user?.name || user?.username || '', email: user?.email || '' }, team: team ? { id: team.id, name: team.name || team.slug || '' } : null };
  }
  async publish(input) {
    const legacy = !Array.isArray(input?.files);
    const projectId = legacy ? input?.deployment?.projectId || 'alva-' + input.id : input.projectId;
    const environment = legacy ? 'production' : input.environment;
    const files = legacy ? [{ file: 'index.html', data: input.html }, { file: 'vercel.json', data: JSON.stringify({ version: 2, cleanUrls: true }) }] : input.files;
    if (!projectId || !Array.isArray(files) || !files.length) throw fail('Snapshot sem arquivos para publicar.', 400);
    if (legacy && !input.html) throw fail('Salve a página antes de publicar.', 400);
    if (!['preview', 'production'].includes(environment)) throw fail('Ambiente de publicação inválido.', 400);
    const payload = { name: input.projectName || projectId, project: projectId, ...(environment === 'production' ? { target: 'production' } : {}), projectSettings: { framework: null }, files };
    const result = await this.request('/v13/deployments', payload);
    return { id: result.id, projectId: result.projectId || result.project?.id || projectId, url: result.url, state: result.readyState || result.status || 'QUEUED', ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}), ...(input.revision !== undefined ? { revision: input.revision } : {}), environment, createdAt: new Date().toISOString() };
  }
  async status(id) {
    if (!/^dpl_[a-zA-Z0-9]+$/.test(id)) throw new Error('Publicação inválida.');
    const result = await this.request('/v13/deployments/' + id);
    const state = result.readyState || result.status;
    return { id: result.id, url: result.url, state, terminal: TERMINAL.has(String(state || '').toUpperCase()) };
  }
  async domain(input) {
    const legacy = input?.deployment || input?.domain;
    const domain = input?.domain;
    if (!domain) throw fail('Informe um domínio.', 400);
    const projectId = legacy ? input.deployment?.projectId || 'alva-' + input.id : input.projectId;
    if (!projectId) throw fail('Projeto da Vercel não configurado.', 409);
    const result = await this.request('/v10/projects/' + encodeURIComponent(projectId) + '/domains', { name: domain });
    return { name: result.name, verified: result.verified, verification: result.verification || [] };
  }
  configureDomain(input) { return this.domain(input); }
}
