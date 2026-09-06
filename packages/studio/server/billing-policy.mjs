const DEFAULT_LIMITS = Object.freeze({ projects: 5, members: 10, domains: 5 });
function fail(message) { return Object.assign(new Error(message), { status: 403, statusCode: 403, code: 'billing_access_required' }); }

export class BillingPolicy {
  constructor({ environment = 'sandbox', enforcement = false, repository } = {}) { this.environment = environment; this.enforcement = enforcement === true; this.repository = repository; }
  async assertQuota(client, { companyId, resource, countSql, params = [] }) {
    if (!Object.hasOwn(DEFAULT_LIMITS, resource)) throw new Error('Limite de cobrança inválido.');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`billing-quota:${companyId}`]);
    const entitlement = await client.query('SELECT limits FROM entitlements WHERE company_id = $1 AND environment = $2 FOR UPDATE', [companyId, this.environment]);
    const limit = Number(entitlement.rows[0]?.limits?.[resource] ?? DEFAULT_LIMITS[resource]);
    const count = await client.query(countSql, [companyId, ...params]);
    if (Number(count.rows[0]?.count || 0) >= limit) throw fail(`O limite de ${resource} do plano foi atingido.`);
  }
  async requireProductionAccess(companyId) { if (this.enforcement) return this.repository.requireAccess({ companyId, environment: this.environment }); }
}
