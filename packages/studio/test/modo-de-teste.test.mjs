// O modo de teste: conferir o rastreamento na plataforma sem sujar os dados das campanhas.
//
// Critério 15 do rastreamento: "Com o modo de teste ligado, o dono vê o evento aparecer
// na aba Eventos de Teste da Meta, sem afetar os dados reais." A Meta e o TikTok dão, no
// gerenciador de eventos, um código de teste; evento que chega com ele aparece só na aba de
// teste. Sem esse modo, a única forma de conferir o rastreamento era mandar evento de
// verdade para a conta do cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { configuracaoParaSalvar, destinosDeConversaoModel } from '../public/studio-dashboard.js';
import { postgresFixture } from './postgres-fixture.mjs';

const EVENTO = { event_name: 'lead', event_time: 1_727_400_000, tracking_event_id: '9b2f6a7e-4c1d-4e8a-9f3b-2d6c8e1a5b70', source_url: 'https://lp.exemplo.test/oferta', client: { user_agent: 'Mozilla/5.0 (iPhone)' } };
const META = { pixel_id: '123456', access_token: 'token-meta' };
const TIKTOK = { pixel_code: 'PXTIKTOK', access_token: 'token-tiktok' };

test('com o código de teste, a Meta recebe o evento marcado como teste', () => {
  assert.equal(destinoPara('meta').requisicao(EVENTO, { ...META, test_event_code: 'TEST12345' }).corpo.test_event_code, 'TEST12345');
  assert.equal('test_event_code' in destinoPara('meta').requisicao(EVENTO, META).corpo, false, 'sem código, o evento é de verdade');
});

test('com o código de teste, o TikTok recebe o evento marcado como teste', () => {
  assert.equal(destinoPara('tiktok').requisicao(EVENTO, { ...TIKTOK, test_event_code: 'TEST67890' }).corpo.test_event_code, 'TEST67890');
  assert.equal('test_event_code' in destinoPara('tiktok').requisicao(EVENTO, TIKTOK).corpo, false);
});

test('o código de teste é guardado, aparece na tela e sai quando apagado', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('teste@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  const tracking = new TrackingRepository(database, { vault: new SecretVault({ masterKey: 'd'.repeat(64) }) });
  const escopo = { companyId: empresa.id, projectId: projeto.id, environment: 'production' };

  await tracking.saveDestination({ ...escopo, provider: 'meta', configuration: { ...META, test_event_code: 'TEST12345' } });
  assert.equal((await tracking.conversionDestinations(escopo)).meta.test_event_code, 'TEST12345', 'o envio precisa do código');
  const meta = (await tracking.destinationsFor(escopo)).find((linha) => linha.provider === 'meta');
  assert.equal(meta.publicConfiguration.test_event_code, 'TEST12345', 'a tela precisa saber que o modo de teste está ligado');
  assert.equal(meta.publicConfiguration.pixel_id, '123456');

  // Corrigir outro campo não desliga o modo de teste por acidente.
  await tracking.saveDestination({ ...escopo, provider: 'meta', configuration: { pixel_id: '654321' } });
  assert.equal((await tracking.conversionDestinations(escopo)).meta.test_event_code, 'TEST12345');

  // Apagar o código volta a mandar de verdade, sem precisar redigitar o token.
  await tracking.saveDestination({ ...escopo, provider: 'meta', configuration: { test_event_code: '' } });
  const depois = await tracking.conversionDestinations(escopo);
  assert.equal('test_event_code' in depois.meta, false);
  assert.equal(depois.meta.access_token, 'token-meta');
  assert.equal('test_event_code' in (await tracking.destinationsFor(escopo)).find((linha) => linha.provider === 'meta').publicConfiguration, false);

  await assert.rejects(() => tracking.saveDestination({ ...escopo, provider: 'meta', configuration: { test_event_code: 'com espaço' } }), /inválida/);
});

test('a tela diz que o destino está em modo de teste', () => {
  const [meta] = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '123456', test_event_code: 'TEST12345' } }], [{ destination: 'meta' }]);
  assert.equal(meta.stateLabel, 'Modo de teste');
  assert.equal(meta.state, 'teste', 'modo de teste não pode parecer entrega de verdade');
  assert.equal(meta.testCode, 'TEST12345');
  const [real] = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '123456' } }], [{ destination: 'meta' }]);
  assert.equal(real.stateLabel, 'Enviando');
});

test('apagar o código de teste no formulário sobe o pedido de desligar', () => {
  const [meta] = destinosDeConversaoModel([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '123456', test_event_code: 'TEST12345' } }], []);
  assert.deepEqual(configuracaoParaSalvar(meta, { pixel_id: '123456', access_token: '', test_event_code: '' }), { pixel_id: '123456', test_event_code: '' });
  assert.deepEqual(configuracaoParaSalvar(meta, { pixel_id: '123456', test_event_code: ' TEST999 ' }), { pixel_id: '123456', test_event_code: 'TEST999' });
});
