import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function keyFrom(value) {
  if (typeof value !== 'string' || !value.trim()) throw fail('A chave mestra VERCEL_MASTER_KEY é obrigatória no servidor.', 500);
  return createHash('sha256').update(value).digest();
}

export class SecretVault {
  constructor({ masterKey = process.env.VERCEL_MASTER_KEY } = {}) { this.key = keyFrom(masterKey); }

  encrypt(value) {
    if (typeof value !== 'string' || !value) throw fail('Token Vercel inválido.', 400);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return JSON.stringify({
      iv: iv.toString('hex'),
      data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      keyVersion: 1,
    });
  }

  decrypt(value) {
    try {
      const secret = typeof value === 'string' ? JSON.parse(value) : value;
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(secret.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(secret.tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(secret.data, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      throw fail('Não foi possível ler a conexão Vercel. Salve-a novamente.', 500);
    }
  }
}

function cleanTeamId(value) {
  const teamId = String(value ?? '').trim();
  if (teamId && !/^team_[a-zA-Z0-9]+$/.test(teamId)) throw fail('Informe um Team ID válido, iniciado por team_.');
  return teamId;
}

function cleanProjectId(value) {
  const projectId = String(value ?? '').trim();
  if (!projectId || projectId.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw fail('Informe o projeto da Vercel.');
  return projectId;
}

function cleanToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)) throw fail('Token Vercel inválido.');
  return value;
}

function publicConfiguration(configuration = {}) {
  return {
    provider: 'vercel',
    environment: 'production',
    connectionStatus: configuration.connectionStatus === 'configured' ? 'configured' : 'pending',
    teamId: configuration.teamId || '',
    vercelProjectId: configuration.vercelProjectId || '',
  };
}

export class ProjectIntegrationRepository {
  constructor(database, { vault = new SecretVault(), provider = 'vercel', environment = 'production' } = {}) {
    if (!database || typeof database.query !== 'function') throw new Error('Banco inválido para integrações.');
    this.database = database;
    this.vault = vault;
    this.provider = provider;
    this.environment = environment;
  }

  async queryIntegration({ companyId, projectId }) {
    const { rows } = await this.database.query(
      `SELECT configuration
         FROM project_integrations
        WHERE company_id = $1 AND project_id = $2 AND provider = $3 AND environment = $4`,
      [companyId, projectId, this.provider, this.environment],
    );
    return rows[0]?.configuration || null;
  }

  async publicSettings(scope) {
    return publicConfiguration(await this.queryIntegration(scope) || {});
  }

  async save({ companyId, projectId, teamId = '', vercelProjectId, token }) {
    const cleanProject = cleanProjectId(vercelProjectId);
    const cleanTeam = cleanTeamId(teamId);
    const clean = cleanToken(token);
    const secretName = 'access_token';
    const encrypted = this.vault.encrypt(clean);
    const run = async (client) => {
      await client.query(
        `INSERT INTO company_secrets (company_id, provider, secret_name, encrypted_value, key_version, rotated_at)
         VALUES ($1, $2, $3, $4, 1, now())
         ON CONFLICT (company_id, provider, secret_name, key_version)
         DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, rotated_at = now()`,
        [companyId, this.provider, secretName, encrypted],
      );
      const configuration = { connectionStatus: 'configured', teamId: cleanTeam, vercelProjectId: cleanProject, secretName };
      await client.query(
        `INSERT INTO project_integrations (company_id, project_id, provider, environment, configuration, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (project_id, provider, environment)
         DO UPDATE SET company_id = EXCLUDED.company_id, configuration = EXCLUDED.configuration, updated_at = now()`,
        [companyId, projectId, this.provider, this.environment, JSON.stringify(configuration)],
      );
      return publicConfiguration(configuration);
    };
    return this.database.transaction ? this.database.transaction(run) : run(this.database);
  }

  async credentials({ companyId, projectId }) {
    const configuration = await this.queryIntegration({ companyId, projectId });
    if (!configuration || configuration.connectionStatus !== 'configured') return null;
    const { rows } = await this.database.query(
      `SELECT encrypted_value
         FROM company_secrets
        WHERE company_id = $1 AND provider = $2 AND secret_name = $3
        ORDER BY key_version DESC LIMIT 1`,
      [companyId, this.provider, configuration.secretName || 'access_token'],
    );
    if (!rows[0]) return null;
    return {
      token: this.vault.decrypt(rows[0].encrypted_value),
      teamId: configuration.teamId || '',
      vercelProjectId: configuration.vercelProjectId,
    };
  }

  async disconnect({ companyId, projectId }) {
    await this.database.query(
      `DELETE FROM project_integrations
        WHERE company_id = $1 AND project_id = $2 AND provider = $3 AND environment = $4`,
      [companyId, projectId, this.provider, this.environment],
    );
    return publicConfiguration({});
  }
}
