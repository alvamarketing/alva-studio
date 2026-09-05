import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { VideoRepository } from '../server/repositories/video-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function row(database, query, values = []) {
  return (await database.query(query, values)).rows[0];
}

async function seed(database, suffix) {
  const user = await row(database, "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id", [`vsl-${suffix}@alva.test`]);
  const company = await row(database, 'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${suffix}`, `empresa-${suffix}`]);
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [company.id, user.id]);
  const project = await row(database, 'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [company.id, `Projeto ${suffix}`, `projeto-${suffix}`, user.id]);
  return { user, company, project };
}

const input = (seeded, extra = {}) => ({
  companyId: seeded.company.id,
  projectId: seeded.project.id,
  actorId: seeded.user.id,
  name: 'VSL principal',
  sourceUrl: 'https://media.example.test/sales.mp4',
  sourceType: 'mp4',
  posterUrl: 'https://media.example.test/poster.jpg',
  captionsUrl: 'https://media.example.test/captions.vtt',
  accentColor: '#286eea',
  aspectRatio: '16:9',
  autoplayMuted: true,
  resumeEnabled: true,
  ctaText: 'Quero participar',
  ctaUrl: '/checkout',
  ctaSeconds: 42,
  ...extra,
});

test('repositório de VSL valida URL HTTPS, cria e atualiza com lock otimista', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const seeded = await seed(database, 'repo');
  const repository = new VideoRepository(database);
  try {
    await assert.rejects(() => repository.createVideo(input(seeded, { sourceUrl: 'http://media.example.test/a.mp4' })), /HTTPS/i);
    for (const field of ['sourceUrl', 'posterUrl', 'captionsUrl']) {
      for (const value of ['//media.example.test/a.mp4', 'video.mp4', 'https:video.mp4']) {
        await assert.rejects(() => repository.createVideo(input(seeded, { [field]: value })), /HTTPS|URL/i);
      }
    }
    await assert.rejects(() => repository.createVideo(input(seeded, { ctaUrl: 'https://:senha@evil.test/checkout' })), /credenciais/i);
    await assert.rejects(() => repository.createVideo(input(seeded, { ctaText: 'Comprar', ctaUrl: '/checkout', ctaSeconds: null })), /CTA/i);
    await assert.rejects(() => repository.createVideo(input(seeded, { ctaText: null, ctaUrl: null, ctaSeconds: 0 })), /CTA/i);
    const zeroCta = await repository.createVideo(input(seeded, { ctaText: 'Comprar agora', ctaUrl: '/checkout', ctaSeconds: 0 }));
    assert.equal(zeroCta.ctaSeconds, 0);
    const created = await repository.createVideo(input(seeded));
    assert.equal(created.projectId, seeded.project.id);
    assert.equal(created.lockVersion, 0);
    assert.match(created.publicId, /^[A-Za-z0-9_-]{16,32}$/);
    const updated = await repository.updateVideo({ ...input(seeded), videoId: created.id, lockVersion: 0, name: 'VSL editada' });
    assert.equal(updated.name, 'VSL editada');
    assert.equal(updated.lockVersion, 1);
    await assert.rejects(() => repository.updateVideo({ ...input(seeded), videoId: created.id, lockVersion: 0 }), /mudou/i);
    await assert.rejects(() => repository.removeVideo({ ...input(seeded), videoId: created.id }), /Revisão/i);
    await assert.rejects(() => repository.removeVideo({ ...input(seeded), videoId: created.id, lockVersion: 0 }), /mudou/i);
    assert.deepEqual(await repository.removeVideo({ ...input(seeded), videoId: created.id, lockVersion: 1 }), { ok: true });
  } finally {
    await database.close();
  }
});

test('publicação de VSL congela snapshot e leitura pública respeita empresa e projeto', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const first = await seed(database, 'first');
  const second = await seed(database, 'second');
  const repository = new VideoRepository(database);
  try {
    const created = await repository.createVideo(input(first));
    const published = await repository.publishVideo({ ...input(first), videoId: created.id, lockVersion: 0 });
    assert.equal(published.versionNumber, 1);
    assert.equal(published.sourceUrl, input(first).sourceUrl);
    const changed = await repository.updateVideo({ ...input(first), videoId: created.id, lockVersion: 0, sourceUrl: 'https://media.example.test/changed.m3u8', sourceType: 'hls' });
    assert.equal(changed.publishedVersionId, published.id);
    const publicBefore = await repository.getPublicVideo(created.publicId);
    assert.equal(publicBefore.sourceUrl, input(first).sourceUrl);
    await assert.rejects(() => repository.getVideo({ companyId: second.company.id, projectId: second.project.id, actorId: second.user.id, videoId: created.id }), /não encontrad[oa]/i);
    await assert.rejects(() => repository.getPublicVideo('missing-public-id'), /não encontrad[oa]/i);
  } finally {
    await database.close();
  }
});
