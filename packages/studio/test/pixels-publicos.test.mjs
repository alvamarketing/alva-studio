// Só entra no manifesto publicado o pixel que tem ID público.
//
// Achado da revisão independente de 27/09: com os pixels ligados por padrão, publicar
// quebrava em todo projeto com Google Ads ou LinkedIn configurado. A tela não pede ID de
// pixel de navegador para esses dois — eles entregam pelo servidor —, o destino ia para o
// manifesto sem ID, e o manifesto recusava a publicação inteira. O mesmo com a Taboola
// salva antes de a tela pedir o ID da conta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

test('destino sem ID público não vira pixel, e a publicação segue', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('pp@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  const tracking = new TrackingRepository(database, { vault: new SecretVault({ masterKey: 'f'.repeat(64) }) });
  const escopo = { companyId: empresa.id, projectId: projeto.id, environment: 'production' };
  await tracking.saveDestination({ ...escopo, provider: 'meta', configuration: { pixel_id: '123456', access_token: 't' } });
  await tracking.saveDestination({ ...escopo, provider: 'google', configuration: { operating_account_id: '1234567890', conversion_action_id: '987', oauth_access_token: 't' } });
  await tracking.saveDestination({ ...escopo, provider: 'linkedin', configuration: { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 't' } });
  // Uma Taboola salva antes de a tela pedir o ID da conta ficou com a parte pública vazia.
  await tracking.saveDestination({ ...escopo, provider: 'taboola', configuration: { account_id: '1234567', lead_event_name: 'lead' } });
  await database.query("UPDATE tracking_destinations SET public_configuration = '{}'::jsonb WHERE provider = 'taboola'");

  const providers = await tracking.publicProviders(escopo);
  assert.deepEqual(providers, [{ provider: 'meta', id: '123456' }]);
  assert.doesNotThrow(() => buildRuntimeManifest({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), origin: 'https://lp.exemplo.test', domain: 'lp.exemplo.test', environment: 'production', providers, contents: [] }));
});
