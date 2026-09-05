import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectDomainRepository, SecretVault, ProjectIntegrationRepository } from '../server/repositories/publication-repository.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { CompanyRepository } from '../server/repositories/company-repository.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { ProjectRepository } from '../server/repositories/project-repository.mjs';
import { VideoRepository } from '../server/repositories/video-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import { randomUUID } from 'node:crypto';

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

test('publicação inválida falha antes de deployment ou POST externo', async () => {
  let deployments = 0;
  let posts = 0;
  const service = new PublicationService({
    snapshotBuilder: { build: async () => {
      const error = Object.assign(new Error('Publique a VSL antes de publicar este projeto.'), { status: 409, statusCode: 409 });
      throw error;
    } },
    integrations: { credentials: async () => { throw new Error('não deveria consultar integração'); } },
    deployments: { async createOrGet() { deployments += 1; } },
    publisherFactory: () => ({ publish: async () => { posts += 1; } }),
  });
  await assert.rejects(
    () => service.preview({ companyId: 'company-a', projectId: 'project-a', requestedBy: 'user-a', expectedRevision: 1 }),
    (error) => error.status === 409 && /publique a VSL/i.test(error.message),
  );
  assert.equal(deployments, 0);
  assert.equal(posts, 0);
});

test('publicar conteúdo com VSL inválida não cria versão e preserva a publicação anterior', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const owner = (await database.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, 'Owner') RETURNING id`,
      [`publication-vsl-${randomUUID()}@test`, 'hash'],
    )).rows[0];
    const companies = new CompanyRepository(database);
    const projects = new ProjectRepository(database);
    const company = await companies.create({ ownerUserId: owner.id, name: 'Empresa VSL', slug: `empresa-vsl-${randomUUID().slice(0, 8)}` });
    const project = await projects.create({ companyId: company.id, actorUserId: owner.id, name: 'Projeto VSL', slug: `projeto-vsl-${randomUUID().slice(0, 8)}` });
    const videos = new VideoRepository(database);
    const videoInput = { companyId: company.id, projectId: project.id, actorId: owner.id, name: 'VSL', sourceUrl: 'https://media.example.test/vsl.mp4', sourceType: 'mp4' };
    const video = await videos.createVideo(videoInput);
    await videos.publishVideo({ ...videoInput, videoId: video.id, lockVersion: 0 });
    const content = new ContentRepository(database, { publicOrigin: 'https://studio.alva.test' });
    const page = await content.createPage({ companyId: company.id, projectId: project.id, actorId: owner.id, name: 'Página', route: '/pagina', editorState: { components: [{ type: 'vsl', publicId: video.publicId }] }, renderedHtml: `<div data-alva-vsl="${video.publicId}"></div>` });
    const published = await content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    const publishedContent = await content.getPublicContent({ companyId: company.id, projectId: project.id, route: '/pagina' });
    assert.match(publishedContent.renderedHtml, /https:\/\/studio\.alva\.test\/embed\/v\//);
    const changed = await content.updatePage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: 0, editorState: { components: [{ type: 'vsl', publicId: 'public-vsl-missing' }] }, renderedHtml: '<div data-alva-vsl="public-vsl-missing"></div>' });
    await assert.rejects(() => content.publishPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id, lockVersion: changed.lockVersion }), (error) => error.statusCode === 409 && /publique a VSL/i.test(error.message));
    const current = await content.getPage({ companyId: company.id, projectId: project.id, actorId: owner.id, pageId: page.id });
    assert.equal(current.publishedVersionId, published.id);
  } finally {
    await database.close();
  }
});
