import { validateWebhookUrl } from '../outbound-webhook.mjs';

// Destino padrão dos leads de um projeto (migração 031). Uma linha por projeto; o webhook
// da página, quando existe, sobrescreve este na hora do envio (content-repository).
//
// A autorização fica na rota (integration.manage); aqui toda consulta carrega a empresa
// junto, para que um id de projeto de outra empresa nunca encontre linha.
export class LeadWebhookRepository {
  constructor(database) { this.database = database; }

  async get({ companyId, projectId }, client = this.database) {
    const { rows } = await client.query(
      'SELECT url FROM project_lead_webhooks WHERE company_id = $1 AND project_id = $2',
      [companyId, projectId],
    );
    const url = rows[0]?.url ?? '';
    return { configured: Boolean(url), url };
  }

  // Só o host. Quem edita uma página não gerencia integrações, e o caminho ou a query da
  // URL costumam carregar o token do CRM: a tela da página mostra de onde vai o lead, não
  // a chave de quem recebe.
  async host({ companyId, projectId }, client = this.database) {
    const { url } = await this.get({ companyId, projectId }, client);
    try { return url ? new URL(url).host : ''; } catch { return ''; }
  }

  async save({ companyId, projectId, url }) {
    // Mesma regra do webhook de página: https, sem usuário e senha na URL, até 2000 chars.
    const normalized = validateWebhookUrl(url);
    await this.database.query(
      `INSERT INTO project_lead_webhooks (company_id, project_id, url)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE SET url = EXCLUDED.url, updated_at = now()
       WHERE project_lead_webhooks.company_id = EXCLUDED.company_id`,
      [companyId, projectId, normalized],
    );
    return this.get({ companyId, projectId });
  }

  async remove({ companyId, projectId }) {
    await this.database.query(
      'DELETE FROM project_lead_webhooks WHERE company_id = $1 AND project_id = $2',
      [companyId, projectId],
    );
    return { configured: false, url: '' };
  }
}
