import { SecretVault } from './publication-repository.mjs';

// A conexão da empresa com a Meta e os `state` de cada clique em "Conectar" (migração 034).
// O token fica no mesmo cofre dos destinos (mesma chave-mestra), com escopo próprio: cifrado
// para uma empresa e uma pessoa da Meta, não decifra no lugar de outra.
function escopoDoToken({ companyId, metaUserId }) { return `meta-connection:${companyId}:${metaUserId}`; }

const COLUNAS = `c.id, c.meta_user_id, c.meta_user_name, c.token_type, c.scopes, c.client_business_id, c.token_expires_at,
  c.status, c.status_reason, c.connected_at, c.connected_by_user_id, u.display_name AS connected_by_name`;

function publica(row) {
  return {
    id: row.id,
    metaUserId: row.meta_user_id,
    nome: row.meta_user_name,
    tipoDeToken: row.token_type,
    escopos: row.scopes ?? [],
    clientBusinessId: row.client_business_id,
    expiraEm: row.token_expires_at,
    status: row.status,
    motivo: row.status_reason,
    conectadoEm: row.connected_at,
    conectadoPor: row.connected_by_user_id ? { id: row.connected_by_user_id, nome: row.connected_by_name ?? '' } : null,
  };
}

export class MetaConnectionsRepository {
  constructor(database, { vault = null, masterKey } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco obrigatório para a conexão com a Meta.');
    this.database = database;
    this.vault = vault || new SecretVault({ masterKey: masterKey || process.env.TRACKING_MASTER_KEY });
  }

  async registrarState({ nonceHash, companyId, projectId, userId, sessionHash, redirectUri, expiraEm }) {
    await this.database.query(
      `INSERT INTO meta_oauth_states (nonce_hash, company_id, project_id, user_id, session_hash, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nonceHash, companyId, projectId, userId, sessionHash, redirectUri, expiraEm],
    );
    // Faxina de passagem: state vencido não serve para nada, e a tabela não deve crescer
    // com cliques abandonados.
    await this.database.query("DELETE FROM meta_oauth_states WHERE expires_at < now() - interval '1 day'");
  }

  // Uso único, atômico: o UPDATE só acerta a linha ainda não consumida, dentro do prazo e da
  // mesma empresa, pessoa e sessão. Duas conclusões simultâneas disputam a mesma linha e só
  // uma recebe a resposta.
  async consumirState({ nonceHash, companyId, userId, sessionHash }) {
    const { rows } = await this.database.query(
      `UPDATE meta_oauth_states SET consumed_at = now()
        WHERE nonce_hash = $1 AND consumed_at IS NULL AND expires_at > now()
          AND company_id = $2 AND user_id = $3 AND session_hash = $4
        RETURNING project_id, redirect_uri`,
      [nonceHash, companyId, userId, sessionHash],
    );
    return rows[0] ? { projectId: rows[0].project_id, redirectUri: rows[0].redirect_uri } : null;
  }

  // Conectar de novo substitui a conexão da empresa e mantém o id (outras tabelas apontam
  // para ele). Volta ao estado "conectado", sem o motivo antigo.
  async salvar({ companyId, metaUserId, nome, tipoDeToken, token, escopos = [], clientBusinessId = null, expiraEm = null, conectadoPor }) {
    const cifrado = this.vault.encrypt(token, escopoDoToken({ companyId, metaUserId }));
    await this.database.query(
      `INSERT INTO meta_connections (company_id, meta_user_id, meta_user_name, token_type, encrypted_token, scopes, client_business_id, token_expires_at, connected_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id) DO UPDATE SET
         meta_user_id = EXCLUDED.meta_user_id, meta_user_name = EXCLUDED.meta_user_name, token_type = EXCLUDED.token_type,
         encrypted_token = EXCLUDED.encrypted_token, scopes = EXCLUDED.scopes, client_business_id = EXCLUDED.client_business_id,
         token_expires_at = EXCLUDED.token_expires_at, connected_by_user_id = EXCLUDED.connected_by_user_id,
         status = 'connected', status_reason = NULL, connected_at = now(), updated_at = now()`,
      [companyId, metaUserId, String(nome ?? '').slice(0, 200), tipoDeToken, cifrado, escopos, clientBusinessId, expiraEm, conectadoPor],
    );
    return this.publica(companyId);
  }

  // O que a tela pode saber: quem, desde quando, em que estado. Nunca o token.
  async publica(companyId) {
    const { rows } = await this.database.query(
      `SELECT ${COLUNAS} FROM meta_connections c LEFT JOIN users u ON u.id = c.connected_by_user_id WHERE c.company_id = $1`, [companyId],
    );
    return rows[0] ? publica(rows[0]) : null;
  }

  // Só o servidor, na hora de falar com a Meta, decifra o token.
  async comToken(companyId) {
    const { rows } = await this.database.query(
      `SELECT ${COLUNAS}, c.encrypted_token FROM meta_connections c LEFT JOIN users u ON u.id = c.connected_by_user_id WHERE c.company_id = $1`, [companyId],
    );
    if (!rows[0]) return null;
    return { ...publica(rows[0]), token: this.vault.decrypt(rows[0].encrypted_token, escopoDoToken({ companyId, metaUserId: rows[0].meta_user_id })) };
  }

  async marcarParaReconectar({ companyId, motivo = null }) {
    await this.database.query(
      "UPDATE meta_connections SET status = 'needs_reconnect', status_reason = $2, updated_at = now() WHERE company_id = $1",
      [companyId, motivo ? String(motivo).slice(0, 200) : null],
    );
  }

  // Apaga só a conexão. As escolhas dos projetos (meta_audience_credentials) perdem o
  // vínculo pela própria chave estrangeira; os públicos registrados ficam (D10). Devolve
  // quem era e o token, para quem chamou poder desautorizar na Meta.
  async remover(companyId) {
    const { rows } = await this.database.query(
      'DELETE FROM meta_connections WHERE company_id = $1 RETURNING meta_user_id, encrypted_token', [companyId],
    );
    if (!rows[0]) return null;
    let token = null;
    try { token = this.vault.decrypt(rows[0].encrypted_token, escopoDoToken({ companyId, metaUserId: rows[0].meta_user_id })); } catch { token = null; }
    return { metaUserId: rows[0].meta_user_id, token };
  }

  // Quantas outras empresas usam a mesma pessoa da Meta. Desautorizar o app na Meta derruba
  // todo token dela, inclusive o de outra empresa do Studio.
  async outrasEmpresasDoUsuario({ metaUserId, companyId }) {
    const { rows } = await this.database.query(
      'SELECT count(*)::int AS n FROM meta_connections WHERE meta_user_id = $1 AND company_id <> $2', [metaUserId, companyId],
    );
    return rows[0].n;
  }
}
