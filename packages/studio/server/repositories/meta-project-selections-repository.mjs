// A escolha de conta de anúncios e pixel de cada projeto, feita pela conexão da empresa
// (migração 035). Não guarda segredo nenhum: só ids e os nomes que a Meta mostrava.
function publica(row) {
  return {
    adAccountId: row.ad_account_id,
    adAccountNome: row.ad_account_name,
    pixelId: row.pixel_id,
    pixelNome: row.pixel_name,
    automatica: row.automatic,
    // null quando a conexão que fez a escolha foi desfeita (D10): a escolha fica.
    conexaoId: row.connection_id,
    escolhidaEm: row.updated_at,
  };
}

const COLUNAS = 'ad_account_id, ad_account_name, pixel_id, pixel_name, automatic, connection_id, updated_at';

export class MetaProjectSelectionsRepository {
  constructor(database) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório para a escolha da Meta.');
    this.database = database;
  }

  async ler({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT ${COLUNAS} FROM meta_project_selections WHERE company_id = $1 AND project_id = $2`, [companyId, projectId],
    );
    return rows[0] ? publica(rows[0]) : null;
  }

  async salvar({ companyId, projectId, connectionId, adAccountId, adAccountNome = '', pixelId, pixelNome = '', automatica = false, userId = null }) {
    const { rows } = await this.database.query(
      `INSERT INTO meta_project_selections (company_id, project_id, connection_id, ad_account_id, ad_account_name, pixel_id, pixel_name, automatic, selected_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, project_id) DO UPDATE SET
         connection_id = EXCLUDED.connection_id, ad_account_id = EXCLUDED.ad_account_id, ad_account_name = EXCLUDED.ad_account_name,
         pixel_id = EXCLUDED.pixel_id, pixel_name = EXCLUDED.pixel_name, automatic = EXCLUDED.automatic,
         selected_by_user_id = EXCLUDED.selected_by_user_id, updated_at = now()
       RETURNING ${COLUNAS}`,
      [companyId, projectId, connectionId, adAccountId, String(adAccountNome ?? '').slice(0, 200), pixelId, String(pixelNome ?? '').slice(0, 200), automatica === true, userId],
    );
    return publica(rows[0]);
  }
}
