import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelRepository } from '../server/repositories/pixel-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function databaseFor(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  return database;
}

async function seed(database, suffix) {
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id", [`pixels-${suffix}@alva.test`])).rows[0];
  const company = (await database.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Pixels ${suffix}`, `pixels-${suffix}`])).rows[0];
  const project = (await database.query('INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [company.id, `Projeto ${suffix}`, `projeto-${suffix}`, user.id])).rows[0];
  const website = (await database.query("SELECT id FROM analytics_websites WHERE company_id = $1 AND project_id = $2 AND environment = 'production'", [company.id, project.id])).rows[0];
  return { companyId: company.id, projectId: project.id, websiteId: website.id };
}

async function activePublication(database, scope, suffix = 'active') {
  const snapshotHash = 'a'.repeat(64);
  const run = (await database.query(
    "INSERT INTO deployment_runs (company_id, project_id, environment, snapshot_hash, idempotency_key, expected_revision, status) VALUES ($1, $2, 'production', $3, $4, 0, 'READY') RETURNING id",
    [scope.companyId, scope.projectId, snapshotHash, `pixels-${suffix}`],
  )).rows[0];
  const reservation = (await database.query(
    "INSERT INTO publication_build_reservations (public_id, company_id, project_id, environment, deployment_run_id, state, expires_at) VALUES ($1, $2, $3, 'production', $4, 'claimed', now() + interval '1 hour') RETURNING id, public_id",
    [`publication-${suffix}`, scope.companyId, scope.projectId, run.id],
  )).rows[0];
  await database.query(
    "INSERT INTO publication_tracking_artifacts (reservation_id, deployment_run_id, snapshot_hash, manifest, tracking_public, asset_versions, status) VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'ready')",
    [reservation.id, run.id, snapshotHash],
  );
  return { publicationId: reservation.public_id, environment: 'production', snapshotHash };
}

test('política e providers não cruzam tenant e projeção pública só expõe pixels habilitados', async (t) => {
  const database = await databaseFor(t);
  try {
    const first = await seed(database, 'a');
    const second = await seed(database, 'b');
    const repository = new PixelRepository(database);
    await assert.rejects(() => repository.saveProvider({ ...second, provider: 'meta_pixel', enabled: true, identifier: '123456789012345' }), /política/i);
    await assert.rejects(() => repository.savePolicy({ ...first, privacyPolicyUrl: 'http://pixels.example.test/privacy', policyVersion: 'v1' }), /HTTPS/i);
    await assert.rejects(() => repository.savePolicy({ ...first, privacyPolicyUrl: 'https://pixels.example.test/privacy', policyVersion: ' ' }), /versão/i);

    assert.deepEqual(await repository.savePolicy({ ...first, privacyPolicyUrl: 'https://pixels.example.test/privacy', policyVersion: 'v1' }), {
      privacyPolicyUrl: 'https://pixels.example.test/privacy', policyVersion: 'v1', consentExpiryDays: 365,
    });
    await repository.saveProvider({ ...first, provider: 'meta_pixel', enabled: true, identifier: '123456789012345' });
    const firstProviders = await repository.list(first);
    assert.deepEqual(firstProviders.find(({ provider }) => provider === 'meta_pixel'), { provider: 'meta_pixel', enabled: true, identifier: '123456789012345' });
    assert.equal((await repository.list(second)).every(({ enabled }) => enabled === false), true);

    const projection = await repository.publicProjection({ ...first, environment: 'production', pixelsEnabled: true });
    assert.deepEqual(projection, {
      formatVersion: 1,
      trackerPublicId: projection.trackerPublicId,
      policyUrl: 'https://pixels.example.test/privacy',
      policyVersion: 'v1',
      consentExpiryDays: 365,
      pixelsEnabled: true,
      pixels: [{ provider: 'meta_pixel', identifier: '123456789012345' }],
    });
    assert.equal(JSON.stringify(projection).includes(first.companyId), false);
    assert.equal(JSON.stringify(projection).includes(first.projectId), false);
    assert.equal(JSON.stringify(projection).match(/hmac|token|secret|email/i), null);
    await database.query(
      "UPDATE project_integrations SET configuration = '{\"enabled\":true,\"identifier\":\"https://evil.example/pixel.js\",\"token\":\"não-publicar\"}'::jsonb WHERE company_id = $1 AND project_id = $2 AND provider = 'meta_pixel' AND environment = 'production'",
      [first.companyId, first.projectId],
    );
    assert.deepEqual((await repository.list(first)).find(({ provider }) => provider === 'meta_pixel'), { provider: 'meta_pixel', enabled: false, identifier: null });
    assert.deepEqual((await repository.publicProjection({ ...first, environment: 'production', pixelsEnabled: true })).pixels, []);
    assert.deepEqual(await repository.publicProjection({ ...first, environment: 'preview', pixelsEnabled: true }), {
      ...projection, pixelsEnabled: false, pixels: [], trackerPublicId: null, policyUrl: null, policyVersion: null, consentExpiryDays: null,
    });
  } finally { await database.close(); }
});

test('consentimento é idempotente, usa política atual e nunca devolve token ou hash', async (t) => {
  const database = await databaseFor(t);
  try {
    const scope = await seed(database, 'consent');
    const repository = new PixelRepository(database);
    await repository.savePolicy({ ...scope, privacyPolicyUrl: 'https://pixels.example.test/privacy', policyVersion: 'v1' });
    const publication = await activePublication(database, scope, 'consent');
    const input = { consentToken: 'consent-token-32-bytes-base64url', ...publication };
    await assert.rejects(
      () => repository.grantConsent({ ...input, publicationId: 'publication-not-active' }),
      /publicação/i,
      'o consentimento não pode escolher empresa, site ou publicação sem run/artifact ativo',
    );
    const granted = await repository.grantConsent(input);
    assert.deepEqual(granted, { advertising: 'granted', policyVersion: 'v1' });
    assert.equal(JSON.stringify(granted).match(/token|hash/i), null);
    assert.deepEqual(await repository.consentState(input), { advertising: 'granted', policyVersion: 'v1' });

    const concurrent = await Promise.all([repository.grantConsent(input), repository.grantConsent(input)]);
    assert.deepEqual(concurrent, [{ advertising: 'granted', policyVersion: 'v1' }, { advertising: 'granted', policyVersion: 'v1' }]);
    const active = await database.query("SELECT count(*)::int AS count FROM analytics_consents WHERE company_id = $1 AND project_id = $2 AND revoked_at IS NULL", [scope.companyId, scope.projectId]);
    assert.equal(active.rows[0].count, 1);

    await database.query("UPDATE analytics_consents SET granted_at = now() - interval '2 seconds', expires_at = now() - interval '1 second' WHERE company_id = $1 AND project_id = $2", [scope.companyId, scope.projectId]);
    assert.deepEqual(await repository.consentState(input), { advertising: 'denied', policyVersion: 'v1' });
    await repository.grantConsent(input);

    await repository.savePolicy({ ...scope, privacyPolicyUrl: 'https://pixels.example.test/privacy-revised', policyVersion: 'v1' });
    assert.deepEqual(await repository.consentState(input), { advertising: 'denied', policyVersion: 'v1' });
    await repository.grantConsent(input);

    await repository.savePolicy({ ...scope, privacyPolicyUrl: 'https://pixels.example.test/privacy-v2', policyVersion: 'v2' });
    assert.deepEqual(await repository.consentState(input), { advertising: 'denied', policyVersion: 'v2' });
    await repository.grantConsent(input);
    assert.deepEqual(await repository.revokeConsent(input), { advertising: 'denied', policyVersion: 'v2' });
    assert.deepEqual(await repository.consentState(input), { advertising: 'denied', policyVersion: 'v2' });
  } finally { await database.close(); }
});
