const DAY = 24 * 60 * 60 * 1000;

function clampLegacyFrom(from, to) {
  return new Date(Math.max(from.getTime(), to.getTime() - 90 * DAY));
}

function merge(left, right) {
  const sum = (key) => (Number(left[key]) || 0) + (Number(right[key]) || 0);
  const mergeRows = (a = [], b = [], key) => {
    const map = new Map();
    for (const row of [...a, ...b]) {
      const current = map.get(row[key]) || { ...row, total: 0 };
      current.total += Number(row.total) || 0;
      map.set(row[key], current);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };
  const daily = new Map();
  for (const row of [...(left.dailyVisits || []), ...(right.dailyVisits || [])]) {
    const current = daily.get(row.date) || { date: row.date, visits: 0 };
    current.visits += Number(row.visits) || 0;
    daily.set(row.date, current);
  }
  const dimensions = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) dimensions[key] = mergeRows(left.utmDimensions?.[key], right.utmDimensions?.[key], 'value');
  return {
    totalEvents: sum('totalEvents'), pageviews: sum('pageviews'), custom: sum('custom'), visitors: sum('visitors'),
    sources: mergeRows(left.sources, right.sources, 'source'),
    utms: mergeRows(left.utms, right.utms, 'source'),
    topRoutes: mergeRows(left.topRoutes, right.topRoutes, 'urlPath'),
    conversions: mergeRows(left.conversions, right.conversions, 'contentId'),
    vslFunnel: mergeRows(left.vslFunnel, right.vslFunnel, 'eventName'),
    dailyVisits: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    funnel: right.funnel?.length ? right.funnel : left.funnel,
    events: mergeRows(left.events, right.events, 'name'),
    utmDimensions: dimensions,
  };
}

function umamiDto(value) {
  const events = value.events || [];
  return {
    totalEvents: (Number(value.pageviews) || 0) + events.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    pageviews: Number(value.pageviews) || 0,
    custom: events.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    visitors: Number(value.visitors) || 0,
    sources: value.sources || [], utms: value.utms || [], utmDimensions: value.utmDimensions || {}, topRoutes: value.topRoutes || [], conversions: [], vslFunnel: [],
    dailyVisits: value.dailyVisits || [],
    funnel: events.map(({ name, total }) => ({ label: name, total: Number(total) || 0 })),
    events: events.map(({ name, total }) => ({ name, total: Number(total) || 0 })),
  };
}

function legacyEvents(value) {
  return [
    ...(value.conversions || []).map((row) => ({ name: 'lead', total: Number(row.total) || 0 })),
    ...(value.vslFunnel || []).map((row) => ({ name: row.eventName, total: Number(row.total) || 0 })),
  ];
}

export class UmamiAnalyticsReader {
  constructor({ database, legacy, tracking, client }) { this.database = database; this.legacy = legacy; this.tracking = tracking; this.client = client; }

  async cutover({ companyId, projectId, environment = 'production' }) {
    const { rows } = await this.database.query(
      `SELECT cutover_at FROM analytics_websites WHERE company_id = $1 AND project_id = $2 AND environment = $3 LIMIT 1`,
      [companyId, projectId, environment],
    );
    return rows[0]?.cutover_at ? new Date(rows[0].cutover_at) : null;
  }

  async umami({ companyId, projectId, environment, from, to }) {
    const remoteWebsiteId = await this.tracking.remoteWebsiteFor({ companyId, projectId, environment });
    if (!remoteWebsiteId) throw Object.assign(new Error('Analytics indisponível.'), { status: 503 });
    return umamiDto(await this.client.read({ remoteWebsiteId, from, to }));
  }

  async summary({ companyId, projectId, actorId, from, to, environment = 'production' }) {
    const cut = await this.cutover({ companyId, projectId, environment });
    if (!cut || to <= cut) {
      const value = await this.legacy.summary({ companyId, projectId, actorId, from: clampLegacyFrom(from, to), to });
      return { ...value, events: legacyEvents(value), utmDimensions: {}, source: 'legacy' };
    }
    if (from >= cut) return { ...await this.umami({ companyId, projectId, environment, from, to }), source: 'umami' };
    const [legacy, modern] = await Promise.all([
      this.legacy.summary({ companyId, projectId, actorId, from: clampLegacyFrom(from, cut), to: cut }).then((value) => ({ ...value, events: legacyEvents(value) })),
      this.umami({ companyId, projectId, environment, from: cut, to }),
    ]);
    return { ...merge(legacy, modern), source: 'mixed' };
  }

  async events(input) { return (await this.summary(input)).events || []; }
  async journey(input) { return (await this.summary(input)).funnel || []; }
}
