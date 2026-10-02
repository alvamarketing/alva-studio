import { SecretVault } from './publication-repository.mjs';

// O token de gerenciar anúncios e os públicos já criados a partir dele (migração 032).
// O cofre é o mesmo dos destinos de rastreamento (mesma chave-mestra), com um escopo
// próprio: um token cifrado para um projeto não decifra em outro, nem no lugar de um destino.
function escopoDoToken({ companyId, projectId }) { return `meta-audience-credentials:${companyId}:${projectId}`; }

export class MetaAudiencesRepository {
  constructor(database, { vault = null, masterKey } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório para os públicos da Meta.');
    this.database = database;
    this.vault = vault || new SecretVault({ masterKey: masterKey || process.env.TRACKING_MASTER_KEY });
  }

  // O que a tela pode saber: a conta, nunca o token.
  // `origem` (migração 034): 'manual' é o token colado; 'connection' usa o token da conexão
  // da empresa e não guarda token próprio.
  async credenciaisPublicas({ companyId, projectId }) {
    const { rows } = await this.database.query(
      'SELECT ad_account_id, source, updated_at FROM meta_audience_credentials WHERE company_id = $1 AND project_id = $2', [companyId, projectId],
    );
    return rows[0] ? { adAccountId: rows[0].ad_account_id, origem: rows[0].source, updatedAt: rows[0].updated_at } : null;
  }

  // Só o servidor, na hora de falar com a Meta, decifra o token. Pela conexão não há token
  // aqui: quem chama busca o da conexão da empresa.
  async credenciais({ companyId, projectId }) {
    const { rows } = await this.database.query(
      'SELECT ad_account_id, encrypted_token, source, connection_id FROM meta_audience_credentials WHERE company_id = $1 AND project_id = $2', [companyId, projectId],
    );
    if (!rows[0]) return null;
    if (rows[0].source === 'connection') return { adAccountId: rows[0].ad_account_id, origem: 'connection', conexaoId: rows[0].connection_id, token: null };
    return { adAccountId: rows[0].ad_account_id, origem: 'manual', token: this.vault.decrypt(rows[0].encrypted_token, escopoDoToken({ companyId, projectId })) };
  }

  // A escolha pela conexão: a conta vem da lista da Meta, o token é o da conexão. Substitui a
  // credencial manual (o token colado é apagado — nunca as duas origens, D2). Trocar a
  // escolha invalida os públicos registrados: trocar de conta (os ids eram da conta antiga)
  // ou só o pixel (a regra guardada aponta o pixel antigo). Desconectar não passa por aqui e
  // nunca apaga nada (D10). `client` deixa a escolha inteira numa transação só.
  async usarConexao({ companyId, projectId, adAccountId, connectionId, pixelId = null, client = null }) {
    const run = async (client) => {
      const atual = await client.query(
        'SELECT ad_account_id FROM meta_audience_credentials WHERE company_id = $1 AND project_id = $2 FOR UPDATE', [companyId, projectId],
      );
      await client.query(
        `INSERT INTO meta_audience_credentials (company_id, project_id, ad_account_id, encrypted_token, source, connection_id)
         VALUES ($1, $2, $3, NULL, 'connection', $4)
         ON CONFLICT (company_id, project_id) DO UPDATE
           SET ad_account_id = EXCLUDED.ad_account_id, encrypted_token = NULL, source = 'connection',
               connection_id = EXCLUDED.connection_id, updated_at = now()`,
        [companyId, projectId, adAccountId, connectionId],
      );
      if (atual.rows[0] && atual.rows[0].ad_account_id !== adAccountId) {
        await client.query('DELETE FROM meta_audiences WHERE company_id = $1 AND project_id = $2', [companyId, projectId]);
      } else if (pixelId) {
        // O pixel de cada público está na regra gravada (`definition.regra`). Registro de erro
        // não tem regra e fica: ele não aponta pixel nenhum.
        await client.query(
          `DELETE FROM meta_audiences WHERE company_id = $1 AND project_id = $2
             AND definition #>> '{regra,inclusions,rules,0,event_sources,0,id}' IS NOT NULL
             AND definition #>> '{regra,inclusions,rules,0,event_sources,0,id}' <> $3`,
          [companyId, projectId, String(pixelId)],
        );
      }
    };
    if (client) await run(client);
    else await (this.database.transaction ? this.database.transaction(run) : run(this.database));
  }

  // `token` ausente mantém o que está guardado (o servidor nunca o devolve, então quem corrige
  // só o ID da conta não tem o token à mão). Trocar de conta apaga os públicos registrados:
  // os ids pertenciam à conta antiga e a Meta não os conhece na nova.
  async salvarCredenciais({ companyId, projectId, adAccountId, token }) {
    const run = async (client) => {
      const atual = await client.query(
        'SELECT ad_account_id, source FROM meta_audience_credentials WHERE company_id = $1 AND project_id = $2 FOR UPDATE', [companyId, projectId],
      );
      const cifrado = token ? this.vault.encrypt(token, escopoDoToken({ companyId, projectId })) : null;
      // Sem token novo, só vale manter o que existe — e pela conexão não há token guardado:
      // passar para o manual exige colar um.
      if (!cifrado && (!atual.rows[0] || atual.rows[0].source === 'connection')) throw Object.assign(new Error('Informe o token de acesso da Meta.'), { status: 400, statusCode: 400 });
      // Token colado vira a origem (D2): a credencial deixa de usar a conexão.
      await client.query(
        `INSERT INTO meta_audience_credentials (company_id, project_id, ad_account_id, encrypted_token)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, project_id) DO UPDATE
           SET ad_account_id = EXCLUDED.ad_account_id,
               encrypted_token = COALESCE($5, meta_audience_credentials.encrypted_token),
               source = 'manual', connection_id = NULL, updated_at = now()`,
        [companyId, projectId, adAccountId, cifrado ?? 'pendente', cifrado],
      );
      if (atual.rows[0] && atual.rows[0].ad_account_id !== adAccountId) {
        await client.query('DELETE FROM meta_audiences WHERE company_id = $1 AND project_id = $2', [companyId, projectId]);
      }
    };
    await (this.database.transaction ? this.database.transaction(run) : run(this.database));
  }

  async removerCredenciais({ companyId, projectId }) {
    const run = async (client) => {
      await client.query('DELETE FROM meta_audiences WHERE company_id = $1 AND project_id = $2', [companyId, projectId]);
      await client.query('DELETE FROM meta_audience_credentials WHERE company_id = $1 AND project_id = $2', [companyId, projectId]);
    };
    await (this.database.transaction ? this.database.transaction(run) : run(this.database));
  }

  async listar({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT audience_key, meta_audience_id, status, last_error, updated_at
         FROM meta_audiences WHERE company_id = $1 AND project_id = $2`, [companyId, projectId],
    );
    return rows.map((row) => ({ chave: row.audience_key, metaId: row.meta_audience_id, status: row.status, erro: row.last_error, atualizadoEm: row.updated_at }));
  }

  async gravar({ companyId, projectId, chave, status, metaId = null, definicao = {}, erro = null }) {
    await this.database.query(
      `INSERT INTO meta_audiences (company_id, project_id, audience_key, meta_audience_id, status, definition, last_error)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (company_id, project_id, audience_key) DO UPDATE
         SET meta_audience_id = COALESCE(EXCLUDED.meta_audience_id, meta_audiences.meta_audience_id),
             status = EXCLUDED.status, definition = EXCLUDED.definition, last_error = EXCLUDED.last_error, updated_at = now()`,
      [companyId, projectId, chave, metaId, status, JSON.stringify(definicao), erro ? String(erro).slice(0, 300) : null],
    );
  }

  async esquecer({ companyId, projectId, chave }) {
    await this.database.query(
      'DELETE FROM meta_audiences WHERE company_id = $1 AND project_id = $2 AND audience_key = $3', [companyId, projectId, chave],
    );
  }
}
