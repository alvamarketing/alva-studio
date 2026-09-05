import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SecretVault, ProjectIntegrationRepository } from '../server/repositories/publication-repository.mjs';

class MemoryDatabase {
  constructor() { this.integration = null; this.secret = null; }
  async query(sql, params) {
    if (sql.includes('DELETE FROM project_integrations')) { this.integration = null; return { rows: [] }; }
    if (sql.includes('FROM project_integrations')) return { rows: this.integration ? [{ configuration: this.integration }] : [] };
    if (sql.includes('FROM company_secrets')) return { rows: this.secret ? [{ encrypted_value: this.secret }] : [] };
    if (sql.includes('INSERT INTO company_secrets')) { this.secret = params[3]; return { rows: [] }; }
    if (sql.includes('INSERT INTO project_integrations')) { this.integration = JSON.parse(params[4]); return { rows: [] }; }
    if (sql.includes('SELECT 1 FROM project_integrations')) return { rows: [] };
    return { rows: [] };
  }
}

test('cofre cifra token com chave mestra e nunca devolve texto cifrado igual ao token', () => {
  const vault = new SecretVault({ masterKey: 'master-key-for-tests' });
  const encrypted = vault.encrypt('private-token');
  assert.notEqual(encrypted, 'private-token');
  assert.equal(vault.decrypt(encrypted), 'private-token');
  assert.throws(() => new SecretVault({ masterKey: '' }), /chave mestra/i);
});

test('integração Vercel pertence ao projeto e credencial fica somente no servidor', async () => {
  const database = new MemoryDatabase();
  const repository = new ProjectIntegrationRepository(database, { vault: new SecretVault({ masterKey: 'master-key-for-tests' }) });
  const saved = await repository.save({ companyId: 'company-a', projectId: 'project-a', teamId: 'team_123', vercelProjectId: 'prj_123', token: 'private-token' });
  assert.deepEqual(saved, { provider: 'vercel', environment: 'production', connectionStatus: 'configured', teamId: 'team_123', vercelProjectId: 'prj_123' });
  assert.ok(!JSON.stringify(saved).includes('private-token'));
  assert.ok(!database.secret.includes('private-token'));
  assert.deepEqual(await repository.publicSettings({ companyId: 'company-a', projectId: 'project-a' }), saved);
  assert.deepEqual(await repository.credentials({ companyId: 'company-a', projectId: 'project-a' }), { token: 'private-token', teamId: 'team_123', vercelProjectId: 'prj_123' });
  await repository.disconnect({ companyId: 'company-a', projectId: 'project-a' });
  assert.equal(await repository.credentials({ companyId: 'company-a', projectId: 'project-a' }), null);
});
