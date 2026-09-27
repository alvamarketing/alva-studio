// A Taboola como ela documenta.
//
// A auditoria de 27/09 achou o pixel e o S2S quebrados: o script apontava para um
// arquivo que não é o do pixel, o evento de visita ia no formato errado, e o S2S mandava
// o nome interno do evento (`lead`), quando a Taboola só registra o nome definido no
// Realize — "otherwise Taboola will not receive the event". E a tela não pedia nem o ID
// da conta, sem o qual o pixel não carrega.
// - https://developers.taboola.com/pixel/docs/add-the-base-pixel-manually
// - https://developers.taboola.com/pixel/docs/the-postback-url
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { createRuntimeLoader } from '../server/publication-runtime.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';
import { navegador, rodarCarregador } from './navegador-falso.mjs';

const CLIQUE = 'GiBZ9xS7l3nTHK9SS8q2gH9cRrKTfGpQyk7DcSQqmj5tkSDTj-3G3y9uBxGOoRBV';
const EVENTO = { event_name: 'lead', event_time: 1, tracking_event_id: 'e1', source_url: 'https://lp.exemplo.test/oferta', click_ids: { taboola_click_id: CLIQUE }, user: {}, params: {} };
const CONFIGURACAO = { account_id: '1234567', lead_event_name: 'lead_formulario' };

test('o S2S leva o nome do evento definido no Realize, não o nome interno', () => {
  const url = new URL(destinoPara('taboola').requisicao(EVENTO, CONFIGURACAO).url);
  assert.equal(url.origin + url.pathname, 'https://trc.taboola.com/actions-handler/log/3/s2s-action');
  assert.equal(url.searchParams.get('click-id'), CLIQUE);
  assert.equal(url.searchParams.get('name'), 'lead_formulario');
});

test('sem o nome do evento configurado, não sai nada para a Taboola', () => {
  assert.throws(() => destinoPara('taboola').requisicao({ ...EVENTO, event_name: 'purchase' }, CONFIGURACAO), /destination_event_name_missing/);
  assert.equal(new URL(destinoPara('taboola').requisicao({ ...EVENTO, event_name: 'purchase' }, { ...CONFIGURACAO, purchase_event_name: 'compra' }).url).searchParams.get('name'), 'compra');
});

test('eventos que a Taboola não tem como receber nem entram na fila dela', () => {
  assert.equal(destinoPara('taboola').podeAtribuir({ ...EVENTO, event_name: 'vsl_start' }), false);
  assert.equal(destinoPara('taboola').podeAtribuir(EVENTO), true);
});

test('o pixel carrega o script da conta e registra a visita no formato documentado', async () => {
  const fonte = createRuntimeLoader({ publicationId: 'pub-1', snapshotHash: 'a'.repeat(64), policyVersion: 1, origin: 'https://lp.exemplo.test', domain: 'lp.exemplo.test', environment: 'production', providers: [{ provider: 'taboola', id: '1234567' }] });
  const pagina = await rodarCarregador(fonte, navegador({ estadoDoConsentimento: 'granted' }));
  assert.equal(pagina.scripts[0].src, 'https://cdn.taboola.com/libtrc/unip/1234567/tfa.js');
  assert.deepEqual(pagina.window._tfa, [{ notify: 'event', name: 'page_view', id: 1234567 }]);
});

test('a conta da Taboola é guardada e o ID vai para o pixel da página publicada', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('tb@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  const tracking = new TrackingRepository(database, { vault: new SecretVault({ masterKey: 'e'.repeat(64) }) });
  const escopo = { companyId: empresa.id, projectId: projeto.id, environment: 'production' };
  await tracking.saveDestination({ ...escopo, provider: 'taboola', configuration: CONFIGURACAO });
  assert.deepEqual(await tracking.publicProviders(escopo), [{ provider: 'taboola', id: '1234567' }]);
  assert.equal((await tracking.conversionDestinations(escopo)).taboola.lead_event_name, 'lead_formulario');
  await assert.rejects(() => tracking.saveDestination({ ...escopo, provider: 'taboola', configuration: { account_id: 'abc', lead_event_name: 'x' } }), /inválida/);
});
