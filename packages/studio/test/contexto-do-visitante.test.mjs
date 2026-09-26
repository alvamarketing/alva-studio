import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { contextoDoVisitante } from '../server/repositories/conversions-outbox-repository.mjs';

// A Meta conta o endereço e o navegador de quem converteu entre os sinais mais fortes de
// correspondência. Eles vão em `user_data`, ao lado dos hashes de contato.
test('o endereço e o navegador chegam ao corpo que vai para a Meta', () => {
  const evento = {
    event_name: 'lead', event_time: 1700000000, tracking_event_id: 'e1',
    client: { ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (iPhone)' },
  };
  const corpo = destinoPara('meta').requisicao(evento, { pixel_id: '1', access_token: 't' }).corpo;
  assert.equal(corpo.data[0].user_data.client_ip_address, '203.0.113.7');
  assert.equal(corpo.data[0].user_data.client_user_agent, 'Mozilla/5.0 (iPhone)');
});

test('sem esses dados, o corpo não ganha campo vazio', () => {
  const corpo = destinoPara('meta').requisicao({ event_name: 'lead', event_time: 1, tracking_event_id: 'e1' }, { pixel_id: '1', access_token: 't' }).corpo;
  assert.equal('client_ip_address' in corpo.data[0].user_data, false);
  assert.equal('client_user_agent' in corpo.data[0].user_data, false);
});

// O endereço precisa ser endereço. Um cabeçalho forjado ou um valor de proxy mal formado
// viraria lixo enviado a uma plataforma — e lixo guardado no nosso banco.
test('endereço inválido não entra, e o IPv6 entra', () => {
  assert.equal(contextoDoVisitante({ ip: 'não-é-ip', userAgent: 'x' }).ip, undefined);
  assert.equal(contextoDoVisitante({ ip: '203.0.113.7', userAgent: 'x' }).ip, '203.0.113.7');
  assert.equal(contextoDoVisitante({ ip: '2001:db8::1', userAgent: 'x' }).ip, '2001:db8::1');
  // O endereço mapeado que o Node entrega quando o socket é IPv6 servindo IPv4.
  assert.equal(contextoDoVisitante({ ip: '::ffff:203.0.113.7', userAgent: 'x' }).ip, '203.0.113.7');
});

test('endereço de rede privada não vai para a plataforma: é o proxy, não a pessoa', () => {
  for (const ip of ['127.0.0.1', '10.0.0.4', '192.168.1.10', '172.16.0.9', '::1']) {
    assert.equal(contextoDoVisitante({ ip, userAgent: 'x' }).ip, undefined, `${ip} não deveria entrar`);
  }
});

test('o navegador é cortado no limite e nunca vira linha quebrada', () => {
  const contexto = contextoDoVisitante({ ip: '203.0.113.7', userAgent: `Mozilla${'x'.repeat(600)}\nInjetado` });
  assert.ok(contexto.user_agent.length <= 512);
  assert.doesNotMatch(contexto.user_agent, /\n/);
});

// A linha da fila continua no banco depois de entregue, porque a tela de eventos a mostra.
// Sem apagar, "guardamos só até entregar" seria falso: o endereço da pessoa ficaria ali
// para sempre. Estes dois são os únicos dados de identificação que o Studio retém, então
// a entrega confirmada é o momento de largá-los.
test('a confirmação da entrega apaga o endereço e o navegador da linha', async (t) => {
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const { postgresFixture } = await import('./postgres-fixture.mjs');
  const { SecretVault } = await import('../server/repositories/publication-repository.mjs');
  const { ConversionsOutboxRepository } = await import('../server/repositories/conversions-outbox-repository.mjs');
  const { TrackingRepository } = await import('../server/repositories/tracking-repository.mjs');
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('c@alva.test','h','P') RETURNING id")).rows[0];
    const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('C','c') RETURNING id")).rows[0];
    const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'P','p',$2) RETURNING id", [company.id, user.id])).rows[0];
    const vault = new SecretVault({ masterKey: 'chave-de-teste-cliente' });
    await new TrackingRepository(database, { vault }).saveDestination({ companyId: company.id, projectId: project.id, environment: 'preview', provider: 'meta', configuration: { pixel_id: '1', access_token: 't' } });
    await database.query(
      `UPDATE tracking_bindings SET status='ready', encrypted_remote_reference=$4 WHERE company_id=$1 AND project_id=$2 AND environment=$3 AND engine='conversions'`,
      [company.id, project.id, 'preview', vault.encrypt('alva_p', `tracking-binding:${company.id}:${project.id}:preview:conversions`)],
    );
    const outbox = new ConversionsOutboxRepository(database, { vault });
    await database.transaction((client) => outbox.enqueue(client, {
      companyId: company.id, projectId: project.id, environment: 'preview',
      trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'lead',
      cliente: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone)' },
    }));
    const antes = (await database.query('SELECT payload FROM conversions_outbox')).rows[0].payload;
    assert.equal(antes.client.ip, '203.0.113.7', 'a caminho, o endereço está na linha');

    const reivindicado = await outbox.claimNextDue();
    assert.equal(reivindicado.delivery.payload.client.ip, '203.0.113.7', 'quem entrega precisa dele');
    await outbox.markDelivered({ id: reivindicado.delivery.id, claimToken: reivindicado.token });

    const depois = (await database.query('SELECT payload, status FROM conversions_outbox')).rows[0];
    assert.equal(depois.status, 'delivered');
    assert.equal(depois.payload.client, undefined, 'entregue, o contexto do visitante sai da linha');
    assert.equal(JSON.stringify(depois.payload).includes('203.0.113.7'), false);
    assert.equal(JSON.stringify(depois.payload).includes('iPhone'), false);
    // O resto da linha continua: a tela de eventos depende dela.
    assert.equal(depois.payload.event_name, 'lead');
  } finally { await database.close(); }
});
