import { createHash } from 'node:crypto';
import { withTransaction } from '../db/postgres.mjs';
import { hasCapability } from '../domain/access.mjs';

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

async function authorizedProject(client, { companyId, projectId, actorId, capability }) {
  const { rows } = await client.query(
    `SELECT membership.role
       FROM projects project
       JOIN company_memberships membership
         ON membership.company_id = project.company_id
        AND membership.user_id = $3 AND membership.status = 'active'
       LEFT JOIN project_grants grant_access
         ON grant_access.company_id = project.company_id
        AND grant_access.project_id = project.id
        AND grant_access.membership_id = membership.id
      WHERE project.company_id = $1 AND project.id = $2 AND project.status = 'active'
        AND (membership.role IN ('owner', 'admin') OR grant_access.id IS NOT NULL)`,
    [companyId, projectId, actorId],
  );
  if (!rows.length) throw fail('Projeto não encontrado.', 404);
  if (capability && !hasCapability(rows[0].role, capability)) throw fail('Sem permissão para este conteúdo.', 403);
}

function dayKey(at) {
  return new Date(at).toISOString().slice(0, 10);
}

export class AnalyticsRepository {
  constructor(database) { this.database = database; }

  visitorHash({ websiteId, address, userAgent, at = new Date() }) {
    return createHash('sha256').update(`${dayKey(at)}:${websiteId}:${address ?? ''}:${userAgent ?? ''}`).digest('hex');
  }

  // companySlug/projectSlug vêm no mesmo JOIN para que o chamador (fronteira pública do coletor)
  // nunca precise de uma segunda consulta crua fora do repositório para montar o CORS por projeto.
  async resolveWebsite({ trackerPublicId }) {
    const value = String(trackerPublicId ?? '').trim();
    if (!value) return null;
    const { rows } = await this.database.query(
      `SELECT website.id, website.company_id, website.project_id, company.slug AS company_slug, project.slug AS project_slug
         FROM analytics_websites website
         JOIN companies company ON company.id = website.company_id
         JOIN projects project ON project.id = website.project_id AND project.company_id = website.company_id
        WHERE website.tracker_public_id = $1`,
      [value],
    );
    if (!rows.length) return null;
    return {
      websiteId: rows[0].id,
      companyId: rows[0].company_id,
      projectId: rows[0].project_id,
      companySlug: rows[0].company_slug,
      projectSlug: rows[0].project_slug,
    };
  }

  async ingest({ websiteId, companyId, projectId, visitorHash, event }) {
    const at = event?.at ?? new Date();
    const eventType = event?.type === 'custom' ? 'custom' : 'pageview';
    return withTransaction(this.database, async (client) => {
      const existing = await client.query(
        `SELECT id FROM analytics_sessions
          WHERE company_id = $1 AND project_id = $2 AND website_id = $3 AND visitor_hash = $4
            AND last_seen_at >= $5::timestamptz - interval '30 minutes'
          ORDER BY last_seen_at DESC LIMIT 1 FOR UPDATE`,
        [companyId, projectId, websiteId, visitorHash, at],
      );
      let sessionId;
      if (existing.rows.length) {
        sessionId = existing.rows[0].id;
        await client.query(
          `UPDATE analytics_sessions SET last_seen_at = $4
            WHERE company_id = $1 AND project_id = $2 AND id = $3 AND last_seen_at < $4`,
          [companyId, projectId, sessionId, at],
        );
      } else {
        const created = await client.query(
          `INSERT INTO analytics_sessions (company_id, project_id, website_id, visitor_hash, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
          [companyId, projectId, websiteId, visitorHash, at],
        );
        sessionId = created.rows[0].id;
      }
      const inserted = await client.query(
        `INSERT INTO analytics_events
           (company_id, project_id, website_id, session_id, event_at, event_type, url_path, url_query, referrer, event_name, tracking_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, gen_random_uuid()))
         RETURNING id, tracking_event_id`,
        [companyId, projectId, websiteId, sessionId, at, eventType, event?.urlPath ?? '/', event?.urlQuery ?? null,
          event?.referrer ?? null, event?.eventName ?? null, event?.trackingEventId ?? null],
      );
      return { sessionId, eventId: inserted.rows[0].id, trackingEventId: inserted.rows[0].tracking_event_id };
    });
  }

  async summary({ companyId, projectId, actorId, from, to }) {
    await authorizedProject(this.database, { companyId, projectId, actorId, capability: 'analytics.read' });
    const range = [companyId, projectId, from, to];

    const { rows } = await this.database.query(
      `SELECT event_type, COUNT(*)::int AS total
         FROM analytics_events
        WHERE company_id = $1 AND project_id = $2 AND event_at >= $3 AND event_at < $4
        GROUP BY event_type`,
      range,
    );
    const byType = Object.fromEntries(rows.map((current) => [current.event_type, current.total]));

    const { rows: visitorRows } = await this.database.query(
      `SELECT COUNT(DISTINCT visitor_hash)::int AS total
         FROM analytics_sessions
        WHERE company_id = $1 AND project_id = $2 AND first_seen_at >= $3 AND first_seen_at < $4`,
      range,
    );

    const { rows: sourceRows } = await this.database.query(
      `SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(referrer_domain, ''), '(direto)') AS source, COUNT(*)::int AS total
         FROM analytics_sessions
        WHERE company_id = $1 AND project_id = $2 AND first_seen_at >= $3 AND first_seen_at < $4
        GROUP BY source ORDER BY total DESC LIMIT 10`,
      range,
    );

    const { rows: utmRows } = await this.database.query(
      `SELECT COALESCE(utm_source, '') AS utm_source, COALESCE(utm_medium, '') AS utm_medium,
              COALESCE(utm_campaign, '') AS utm_campaign, COALESCE(utm_term, '') AS utm_term,
              COALESCE(utm_content, '') AS utm_content, COUNT(*)::int AS total
         FROM analytics_sessions
        WHERE company_id = $1 AND project_id = $2 AND first_seen_at >= $3 AND first_seen_at < $4
          AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL OR utm_term IS NOT NULL OR utm_content IS NOT NULL)
        GROUP BY utm_source, utm_medium, utm_campaign, utm_term, utm_content
        ORDER BY total DESC LIMIT 20`,
      range,
    );

    const { rows: routeRows } = await this.database.query(
      `SELECT url_path, COUNT(*)::int AS total
         FROM analytics_events
        WHERE company_id = $1 AND project_id = $2 AND event_at >= $3 AND event_at < $4 AND event_type = 'pageview'
        GROUP BY url_path ORDER BY total DESC LIMIT 10`,
      range,
    );

    const { rows: conversionRows } = await this.database.query(
      `SELECT url_path, COUNT(*)::int AS total
         FROM analytics_events
        WHERE company_id = $1 AND project_id = $2 AND event_at >= $3 AND event_at < $4 AND event_name = 'form_submit_attempt'
        GROUP BY url_path ORDER BY total DESC LIMIT 10`,
      range,
    );

    const { rows: vslRows } = await this.database.query(
      `SELECT event_name, COUNT(*)::int AS total
         FROM analytics_events
        WHERE company_id = $1 AND project_id = $2 AND event_at >= $3 AND event_at < $4
          AND event_name IN ('vsl_start', 'vsl_progress', 'vsl_complete')
        GROUP BY event_name`,
      range,
    );

    // Últimos 7 dias terminando em "to" (o widget "Visitas nos últimos 7 dias" do wireframe),
    // independente do range pedido — zero preenchido para dia sem pageview, nunca ausente.
    const sevenDaysStart = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { rows: dailyRows } = await this.database.query(
      `SELECT date_trunc('day', event_at) AS day, COUNT(*)::int AS total
         FROM analytics_events
        WHERE company_id = $1 AND project_id = $2 AND event_type = 'pageview'
          AND event_at >= $3 AND event_at < $4
        GROUP BY day`,
      [companyId, projectId, sevenDaysStart, to],
    );
    const dailyMap = new Map(dailyRows.map((current) => [current.day.toISOString().slice(0, 10), current.total]));
    const dailyVisits = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const key = new Date(to.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      dailyVisits.push({ date: key, total: dailyMap.get(key) ?? 0 });
    }

    // Jornada única no estilo do wireframe ("Meta Ads → rota → rota → Lead"): origem mais comum,
    // top 2 rotas e total de conversões — não é um grafo por sessão, é o caminho mais frequente.
    const funnel = [
      { label: sourceRows[0]?.source ?? '(direto)', total: sourceRows[0]?.total ?? 0 },
      ...routeRows.slice(0, 2).map((current) => ({ label: current.url_path, total: current.total })),
      { label: 'Lead', total: conversionRows.reduce((sum, current) => sum + current.total, 0) },
    ];

    return {
      totalEvents: rows.reduce((sum, current) => sum + current.total, 0),
      pageviews: byType.pageview ?? 0,
      custom: byType.custom ?? 0,
      visitors: visitorRows[0]?.total ?? 0,
      sources: sourceRows.map((current) => ({ source: current.source, total: current.total })),
      utms: utmRows.map((current) => ({
        source: current.utm_source, medium: current.utm_medium, campaign: current.utm_campaign,
        term: current.utm_term, content: current.utm_content, total: current.total,
      })),
      topRoutes: routeRows.map((current) => ({ urlPath: current.url_path, total: current.total })),
      conversions: conversionRows.map((current) => ({ urlPath: current.url_path, total: current.total })),
      vslFunnel: vslRows.map((current) => ({ eventName: current.event_name, total: current.total })),
      dailyVisits,
      funnel,
    };
  }

  async purgeExpired({ eventDays = 90, rollupMonths = 25, limit = 1000 } = {}) {
    let removidos = 0;
    for (;;) {
      const { rowCount } = await this.database.query(
        `DELETE FROM analytics_events WHERE ctid IN (
           SELECT ctid FROM analytics_events WHERE event_at < now() - ($1 || ' days')::interval LIMIT $2
         )`,
        [eventDays, limit],
      );
      removidos += rowCount;
      if (rowCount < limit) break;
    }
    for (;;) {
      const { rowCount } = await this.database.query(
        `DELETE FROM analytics_daily_rollup WHERE ctid IN (
           SELECT ctid FROM analytics_daily_rollup WHERE rollup_date < (now() - ($1 || ' months')::interval)::date LIMIT $2
         )`,
        [rollupMonths, limit],
      );
      removidos += rowCount;
      if (rowCount < limit) break;
    }
    return { removidos };
  }
}
