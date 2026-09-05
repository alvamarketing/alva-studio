import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectDomainRepository, SecretVault, ProjectIntegrationRepository } from '../server/repositories/publication-repository.mjs';

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

class DomainDatabase {
  constructor(rows = []) { this.rows = rows; this.transactionCalls = 0; }
  async transaction(callback) {
    this.transactionCalls += 1;
    return callback(this);
  }
  async query(sql, params) {
    if (sql.includes('SELECT * FROM project_domains')) {
      const row = this.rows.find((item) => item.domain === params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('UPDATE project_domains SET is_canonical')) {
      for (const row of this.rows) {
        if (row.company_id === params[0] && row.project_id === params[1] && row.environment === params[2]) row.is_canonical = false;
      }
      return { rows: [] };
    }
    if (sql.includes('UPDATE project_domains SET is_canonical = true')) {
      const row = this.rows.find((item) => item.id === params[3]);
      row.is_canonical = true;
      row.verification_status = params[4];
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO project_domains')) {
      const row = { id: `domain-${this.rows.length + 1}`, company_id: params[0], project_id: params[1], environment: params[2], domain: params[3], is_canonical: true, verification_status: params[4] };
      this.rows.push(row);
      return { rows: [row] };
    }
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

test('domínio de outro projeto entra em conflito e troca canônica do mesmo projeto é transacional', async () => {
  const foreign = new DomainDatabase([{ id: 'foreign', company_id: 'company-b', project_id: 'project-b', environment: 'production', domain: 'lp.example.test', is_canonical: true, verification_status: 'verified' }]);
  const repository = new ProjectDomainRepository(foreign);
  await assert.rejects(
    () => repository.save({ companyId: 'company-a', projectId: 'project-a', domain: 'lp.example.test' }),
    (error) => error.statusCode === 409,
  );
  const owned = new DomainDatabase([{ id: 'owned', company_id: 'company-a', project_id: 'project-a', environment: 'production', domain: 'old.example.test', is_canonical: true, verification_status: 'verified' }]);
  await new ProjectDomainRepository(owned).save({ companyId: 'company-a', projectId: 'project-a', domain: 'new.example.test', verificationStatus: 'pending' });
  assert.equal(owned.transactionCalls, 1);
  assert.equal(owned.rows.find((row) => row.domain === 'old.example.test').is_canonical, false);
  assert.equal(owned.rows.find((row) => row.domain === 'new.example.test').is_canonical, true);
});
