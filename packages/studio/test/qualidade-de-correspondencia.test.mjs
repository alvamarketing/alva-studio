import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualidadeDaCorrespondencia, resumoDaCorrespondencia } from '../server/qualidade-de-correspondencia.mjs';

// A nota mede o que o Studio manda, não o que a Meta calcula. Chamá-la de "nota da Meta"
// seria mentira: a Meta calcula a dela com dados que não temos. O que dá para dizer com
// honestidade é quais sinais de correspondência saíram daqui — e essa é justamente a
// parte sobre a qual alguém pode agir.
const completo = {
  user: { email_sha256: 'a'.repeat(64), phone_sha256: 'b'.repeat(64) },
  click_ids: { fbc: 'fb.1.1700000000.abc', fbp: 'fb.1.1700000000.123' },
  source_url: 'https://cliente.test/oferta',
  consent_state: 'granted',
};

test('um evento com todos os sinais que o Studio sabe enviar chega ao topo', () => {
  const nota = qualidadeDaCorrespondencia(completo);
  assert.equal(nota.pontos, nota.total);
  assert.deepEqual(nota.faltando, []);
  assert.equal(nota.nivel, 'boa');
});

test('sem nenhum sinal, a nota é zero e o motivo vem junto', () => {
  const nota = qualidadeDaCorrespondencia({ consent_state: 'pending' });
  assert.equal(nota.pontos, 0);
  assert.equal(nota.nivel, 'fraca');
  assert.ok(nota.faltando.length >= 4);
});

// O que falta só serve se disser o que fazer. "email_sha256 ausente" não é acionável;
// "o formulário não pede e-mail" é.
test('cada sinal que falta vem com o que fazer a respeito, em português', () => {
  const nota = qualidadeDaCorrespondencia({ consent_state: 'granted' });
  for (const item of nota.faltando) {
    assert.equal(typeof item.sinal, 'string');
    assert.ok(item.oQueFazer.length > 20, `ação curta demais para ${item.sinal}: ${item.oQueFazer}`);
    assert.doesNotMatch(item.oQueFazer, /sha256|payload|undefined|null/i, 'a ação é para uma pessoa, não para quem lê o código');
  }
});

// Consentimento negado não é defeito de configuração: é a pessoa exercendo um direito.
// Cobrar o e-mail nesse caso mandaria alguém tentar consertar o que não está quebrado.
test('com consentimento negado, o contato não é cobrado como falta', () => {
  const nota = qualidadeDaCorrespondencia({ consent_state: 'denied', click_ids: { fbc: 'fb.1.1.x' } });
  assert.equal(nota.faltando.some((item) => /mail|telefone/i.test(item.sinal)), false);
  assert.match(nota.observacao ?? '', /consentimento/i);
});

test('o identificador do clique pesa mais que o endereço da página', () => {
  const soClique = qualidadeDaCorrespondencia({ consent_state: 'pending', click_ids: { fbc: 'fb.1.1.x' } });
  const soEndereco = qualidadeDaCorrespondencia({ consent_state: 'pending', source_url: 'https://cliente.test/a' });
  assert.ok(soClique.pontos > soEndereco.pontos, 'o clique é o que liga a conversão ao anúncio');
});

test('hash mal formado não conta como sinal presente', () => {
  const nota = qualidadeDaCorrespondencia({ ...completo, user: { email_sha256: 'curto-demais' } });
  assert.ok(nota.faltando.some((item) => /mail/i.test(item.sinal)));
});

// A tela mostra o conjunto, não um evento. Um projeto com 200 conversões precisa saber
// onde está perdendo correspondência, não a nota da conversão número 87.
test('o resumo agrega as entregas e aponta a falta mais comum primeiro', () => {
  const resumo = resumoDaCorrespondencia([
    { payload: completo },
    { payload: { consent_state: 'granted', click_ids: { fbc: 'fb.1.1.x' }, source_url: 'https://a.test/b' } },
    { payload: { consent_state: 'granted', click_ids: { fbc: 'fb.1.1.y' }, source_url: 'https://a.test/c' } },
  ]);
  assert.equal(resumo.eventos, 3);
  assert.ok(resumo.media > 0 && resumo.media <= 100);
  assert.match(resumo.faltando[0].sinal, /mail/i, 'a falta que mais aparece vem primeiro');
  assert.equal(resumo.faltando[0].eventos, 2);
});

test('sem entrega nenhuma, o resumo não inventa nota', () => {
  const resumo = resumoDaCorrespondencia([]);
  assert.equal(resumo.eventos, 0);
  assert.equal(resumo.media, null);
  assert.deepEqual(resumo.faltando, []);
});

// O que a nota mede — hash de contato e identificador de clique — não pode chegar ao
// navegador. Só o número vai.
test('o registro que a tela recebe traz a nota, e nenhum dos dados que a produziram', async (t) => {
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const { postgresFixture } = await import('./postgres-fixture.mjs');
  const { SecretVault } = await import('../server/repositories/publication-repository.mjs');
  const { ConversionsOutboxRepository } = await import('../server/repositories/conversions-outbox-repository.mjs');
  const { TrackingRepository } = await import('../server/repositories/tracking-repository.mjs');
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('mq@alva.test','hash','Pessoa') RETURNING id")).rows[0];
    const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('MQ','mq') RETURNING id")).rows[0];
    const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'P','p',$2) RETURNING id", [company.id, user.id])).rows[0];
    const vault = new SecretVault({ masterKey: 'chave-de-teste-match' });
    const tracking = new TrackingRepository(database, { vault });
    await tracking.saveDestination({ companyId: company.id, projectId: project.id, environment: 'preview', provider: 'meta', configuration: { pixel_id: '1', access_token: 'tok' } });
    await database.query(
      `UPDATE tracking_bindings SET status = 'ready', encrypted_remote_reference = $4
        WHERE company_id = $1 AND project_id = $2 AND environment = $3 AND engine = 'conversions'`,
      [company.id, project.id, 'preview', vault.encrypt('alva_p', `tracking-binding:${company.id}:${project.id}:preview:conversions`)],
    );
    const outbox = new ConversionsOutboxRepository(database, { vault });
    await database.transaction((client) => outbox.enqueue(client, {
      companyId: company.id, projectId: project.id, environment: 'preview',
      trackingEventId: 'd1c9a8b4-558e-4a4f-9cc4-d2d2a47a1b29', eventName: 'lead',
      consentState: 'granted', answers: { email: 'pessoa@alva.test' },
      attribution: { fbclid: 'IwAR-x' },
      contexto: { sourceUrl: 'https://cliente.test/oferta', contentId: 'page-1', contentName: 'Landing' },
    }));
    const [registro] = await outbox.status({ companyId: company.id, projectId: project.id });
    assert.equal(typeof registro.matchQuality, 'number');
    assert.ok(registro.matchQuality > 0);
    assert.equal(registro.contentName, 'Landing');
    const serializado = JSON.stringify(registro);
    assert.equal(/[a-f0-9]{64}/.test(serializado), false, 'nenhum hash pode aparecer');
    assert.equal(serializado.includes('IwAR-x'), false, 'o identificador do clique não vai ao navegador');
    assert.equal(serializado.includes('pessoa@alva.test'), false);

    const resumo = await outbox.matchQuality({ companyId: company.id, projectId: project.id });
    assert.equal(resumo.eventos, 1);
    assert.ok(resumo.media > 0);
    // Faltou telefone e o identificador do navegador: a tela precisa dizer o que fazer.
    assert.ok(resumo.faltando.every((item) => item.oQueFazer.length > 20));
  } finally { await database.close(); }
});
