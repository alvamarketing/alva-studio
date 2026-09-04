export class Publisher {
  constructor({ token, teamId, fetcher = fetch } = {}) {
    this.token = token;
    this.teamId = teamId;
    this.fetcher = fetcher;
  }
  get connected() {
    return Boolean(this.token);
  }
  async request(path, body) {
    if (!this.token)
      throw Object.assign(new Error('Conecte a Vercel nas configurações para publicar.'), { status: 400 });
    const url = new URL('https://api.vercel.com' + path);
    if (this.teamId) url.searchParams.set('teamId', this.teamId);
    const response = await this.fetcher(url.toString(), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(`A Vercel recusou a solicitação (${response.status}). Verifique a conta e as permissões.`),
        { status: 502 },
      );
    return response.json();
  }
  async testConnection() {
    const { user } = await this.request('/v2/user');
    const team = this.teamId ? await this.request('/v2/teams/' + encodeURIComponent(this.teamId)) : null;
    return {
      ok: true,
      account: { name: user?.name || user?.username || '', email: user?.email || '' },
      team: team ? { id: team.id, name: team.name || team.slug || '' } : null,
    };
  }
  async publish(page) {
    if (!page.html) throw Object.assign(new Error('Salve a página antes de publicar.'), { status: 400 });
    const result = await this.request('/v13/deployments', {
      name: 'alva-' + page.id,
      project: page.deployment?.projectId || 'alva-' + page.id,
      target: 'production',
      projectSettings: { framework: null },
      files: [
        { file: 'index.html', data: page.html },
        { file: 'vercel.json', data: JSON.stringify({ version: 2, cleanUrls: true }) },
      ],
    });
    return {
      id: result.id,
      projectId: result.projectId || result.project?.id || page.deployment?.projectId || 'alva-' + page.id,
      url: result.url,
      state: result.readyState || 'QUEUED',
      revision: page.revision,
      createdAt: new Date().toISOString(),
    };
  }
  async status(id) {
    if (!/^dpl_[a-zA-Z0-9]+$/.test(id)) throw new Error('Publicação inválida.');
    const r = await this.request('/v13/deployments/' + id);
    return { id: r.id, url: r.url, state: r.readyState || r.status };
  }
  async domain(page) {
    if (!page.domain) throw Object.assign(new Error('Informe um domínio.'), { status: 400 });
    if (!page.deployment)
      throw Object.assign(new Error('Publique a página antes de conectar o domínio.'), { status: 400 });
    const project = page.deployment.projectId || 'alva-' + page.id;
    const r = await this.request('/v10/projects/' + encodeURIComponent(project) + '/domains', { name: page.domain });
    return { name: r.name, verified: r.verified, verification: r.verification || [] };
  }
}
