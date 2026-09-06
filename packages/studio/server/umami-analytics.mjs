function unavailable() { return Object.assign(new Error('Analytics indisponível.'), { status: 503 }); }
export class UmamiAnalyticsClient {
  constructor({ baseUrl = process.env.UMAMI_INTERNAL_URL, username = process.env.UMAMI_USERNAME, password = process.env.UMAMI_PASSWORD, fetchImpl = fetch, timeoutMs = 5000 } = {}) { this.baseUrl = baseUrl?.replace(/\/$/, ''); this.username = username; this.password = password; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.token = null; }
  async #request(path, retry = true) {
    if (!this.token) { const login = await this.fetch(`${this.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: this.username, password: this.password }), signal: AbortSignal.timeout(this.timeoutMs) }); const value = await login.json().catch(() => ({})); if (!login.ok || !value.token) throw unavailable(); this.token = value.token; }
    const response = await this.fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.timeoutMs) }); if (response.status === 401 && retry) { this.token = null; return this.#request(path, false); } if (!response.ok) throw unavailable(); return response.json();
  }
  async read({ remoteWebsiteId, from, to }) {
    if (!/^[0-9a-f-]{36}$/i.test(String(remoteWebsiteId))) throw unavailable(); const query = `startAt=${from.getTime()}&endAt=${to.getTime()}`; const root = `/api/websites/${encodeURIComponent(remoteWebsiteId)}`;
    const metric = (type) => this.#request(`${root}/metrics?${query}&type=${encodeURIComponent(type)}`);
    const [stats, pageviews, events, sessions, paths, referrers, utmSources, utmMediums, utmCampaigns, utmTerms, utmContents] = await Promise.all([
      this.#request(`${root}/stats?${query}`), this.#request(`${root}/pageviews?${query}`), this.#request(`${root}/events/stats?${query}`), this.#request(`${root}/sessions?${query}`),
      metric('path'), metric('referrer'), metric('utmSource'), metric('utmMedium'), metric('utmCampaign'), metric('utmTerm'), metric('utmContent'),
    ]);
    const rows = (value) => Array.isArray(value) ? value : value?.data || [];
    const metricRows = (value) => rows(value).map((row) => ({ value: String(row.x ?? row.name ?? row.value ?? '(direto)'), total: Number(row.y ?? row.count ?? row.total) || 0 }));
    const dimensions = { source: metricRows(utmSources), medium: metricRows(utmMediums), campaign: metricRows(utmCampaigns), term: metricRows(utmTerms), content: metricRows(utmContents) };
    return { pageviews: Number(stats.pageviews) || 0, visitors: Number(stats.visitors) || 0, visits: Number(stats.visits) || 0, bounces: Number(stats.bounces) || 0, totalTime: Number(stats.totaltime) || 0, dailyVisits: rows(pageviews).map((row) => ({ date: String(row.x ?? row.date).slice(0, 10), visits: Number(row.y ?? row.visits) || 0 })), events: rows(events).map((row) => ({ name: String(row.eventName ?? row.name), total: Number(row.count ?? row.total) || 0 })), sessions: Number(sessions.count ?? sessions.data?.length) || 0, topRoutes: metricRows(paths).map(({ value, total }) => ({ urlPath: value, total })), sources: metricRows(referrers).map(({ value, total }) => ({ source: value, total })), utms: [], utmDimensions: dimensions };
  }
}
