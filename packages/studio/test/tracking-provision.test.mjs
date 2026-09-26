import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { processDueTrackingProvisionJobs, MAX_TRACKING_PROVISION_ATTEMPTS } from '../server/tracking-provision-worker.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { createProjectApi } from '../server/project-api.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function seed(database, suffix) {
  const user = (await database.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'hash', 'Pessoa') RETURNING id",
    [`${suffix}@alva.test`],
  )).rows[0];
  const company = (await database.query(
    'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Empresa ${suffix}`, `empresa-${suffix}`],
  )).rows[0];
  const project = (await database.query(
    'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [company.id, `Projeto ${suffix}`, `projeto-${suffix}`, user.id],
  )).rows[0];
  return { user, company, project };
}

test('projeto cria bindings independentes para preview e produção, sem IDs administrativos no DTO', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const first = await seed(database, 'a');
    const second = await seed(database, 'b');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const firstStatus = await repository.status({ companyId: first.company.id, projectId: first.project.id });
    const secondStatus = await repository.status({ companyId: second.company.id, projectId: second.project.id });
    assert.deepEqual(firstStatus.bindings.map((item) => [item.environment, item.engine]).sort(), [
      ['preview', 'conversions'], ['production', 'conversions'],
    ]);
    assert.equal(new Set(firstStatus.bindings.map((item) => item.id)).size, 2);
    assert.notDeepEqual(firstStatus.bindings.map((item) => item.id).sort(), secondStatus.bindings.map((item) => item.id).sort());
    assert.equal(JSON.stringify(firstStatus).includes('remote'), false, 'o DTO não pode revelar referências administrativas');
    await assert.rejects(
      () => repository.status({ companyId: first.company.id, projectId: second.project.id }),
      /Projeto de rastreamento não encontrado/,
    );
  } finally { await database.close(); }
});

test('worker provisiona de forma idempotente, trata falha parcial e não executa lease ainda ativo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'worker');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const calls = [];
    const clients = {
      conversions: { provision: async () => { calls.push(['conversions']); throw new Error('indisponível'); } },
    };
    const first = await processDueTrackingProvisionJobs({ repository, clients, maxPerRun: 4, now: () => new Date() });
    assert.equal(first.processed, 2, 'dois ambientes, um motor');
    assert.equal(calls.filter(([engine]) => engine === 'conversions').length, 2);
    const afterFirst = await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id });
    assert.equal(afterFirst.bindings.every((item) => item.status === 'pending'), true, 'a falha mantém o binding pendente');
    const claimed = await repository.claimNextDue({ leaseMs: 60_000 });
    assert.equal(claimed.claimed, false, 'backoff impede nova execução imediata');
    const due = await database.query("UPDATE tracking_provision_jobs SET lease_expires_at = now() - interval '1 second', next_attempt_at = now() WHERE status = 'retry' RETURNING id");
    assert.equal(due.rowCount, 2);
    const expired = await repository.claimNextDue({ leaseMs: 60_000 });
    assert.equal(expired.claimed, true, 'lease expirado pode ser recuperado');
    await repository.markRetry({ jobId: expired.job.id, bindingId: expired.job.bindingId, claimToken: expired.token, attemptCount: 1, nextAttemptAt: new Date(Date.now() + 60_000), lastError: 'falha' });
  } finally { await database.close(); }
});

test('falhas consecutivas terminam em dead e retry manual reabre somente o binding solicitado', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'dead');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const clients = { conversions: { provision: async () => { throw new Error('offline'); } } };
    for (let attempt = 0; attempt < MAX_TRACKING_PROVISION_ATTEMPTS; attempt += 1) {
      await database.query("UPDATE tracking_provision_jobs SET next_attempt_at = now(), lease_expires_at = NULL WHERE status IN ('queued', 'retry')");
      await processDueTrackingProvisionJobs({ repository, clients, now: () => new Date('2026-09-06T10:00:00.000Z') });
    }
    const status = await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id });
    const dead = status.bindings.find((item) => item.engine === 'conversions' && item.environment === 'production');
    assert.equal(dead.status, 'dead');
    const retried = await repository.retry({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', engine: 'conversions' });
    assert.equal(retried.status, 'pending');
    const untouched = (await repository.status({ companyId: seeded.company.id, projectId: seeded.project.id })).bindings.find((item) => item.engine === 'conversions' && item.environment === 'preview');
    assert.equal(untouched.status, 'dead');
  } finally { await database.close(); }
});

test('ciphertext de binding é vinculado criptograficamente ao escopo e não aceita troca entre tenants', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const first = await seed(database, 'scope-a');
    const second = await seed(database, 'scope-b');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const binding = (await database.query(
      "SELECT id FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND engine = 'conversions'",
      [second.company.id, second.project.id],
    )).rows[0];
    const foreignCiphertext = repository.vault.encrypt('id-de-outro-tenant', `binding:${first.company.id}:${first.project.id}:production:conversions`);
    await database.query("UPDATE tracking_provision_jobs SET status = 'succeeded' WHERE company_id IN ($1, $2)", [first.company.id, second.company.id]);
    await database.query("UPDATE tracking_bindings SET encrypted_remote_reference = $2 WHERE id = $1", [binding.id, foreignCiphertext]);
    await database.query("UPDATE tracking_provision_jobs SET status = 'retry', next_attempt_at = now() WHERE binding_id = $1", [binding.id]);
    await assert.rejects(() => repository.claimNextDue(), /conexão|cifrado|ler/i);
  } finally { await database.close(); }
});

test('destinos aceitam somente o contrato de cada plataforma e Taboola pode ser ativado sem credenciais', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'providers');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const configurations = {
      meta: { pixel_id: '123', access_token: 'token' },
      tiktok: { pixel_code: 'pixel-code', access_token: 'token' },
      google: { operating_account_id: '123', conversion_action_id: '9', oauth_access_token: 'token' },
      linkedin: { conversion_urn: 'urn:lla:llaPartnerConversion:1', access_token: 'token', linkedin_version: '202608' },
      taboola: {},
    };
    for (const [provider, configuration] of Object.entries(configurations)) await repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider, configuration });
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'taboola', configuration: { account_id: 'não-usado' } }),
      /Configuração do destino inválida/,
    );
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'google', configuration: { operating_account_id: 'account', conversion_action_id: '9', oauth_access_token: 'token' } }),
      /Configuração do destino inválida/,
    );
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'linkedin', configuration: { conversion_urn: 'urn:lla:llaPartnerConversion:bad', access_token: 'token', linkedin_version: '20260' } }),
      /Configuração do destino inválida/,
    );
    const destinations = await repository.conversionDestinations({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations, configurations);
    const { criarProvisionadorLocal } = await import('../server/tracking-provisionador-local.mjs');
    const provisionador = criarProvisionadorLocal({ tracking: repository });
    // O provisionamento deixou de sair pela rede: o que se verifica é que ele enxerga as
    // credenciais salvas e dá o projeto como pronto.
    const pronto = await provisionador.provision({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', bindingId: 'aaaa-bbbb',
    });
    assert.equal(pronto.remoteId, 'alva_aaaabbbb');
  } finally { await database.close(); }
});

test('salvar destino já configurado mescla: campo ausente mantém a credencial guardada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'merge-parcial');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token-original', pixel_id: '111' },
    });
    // A tela nunca recebe o token de volta, então reabrir o destino para só trocar o pixel
    // manda uma requisição sem access_token. Isso não pode zerar a credencial: o servidor
    // decifra o que já está guardado e mescla por cima só o que veio nesta chamada.
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { pixel_id: '222' },
    });
    const destinations = await repository.conversionDestinations({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations.meta, { access_token: 'token-original', pixel_id: '222' });
  } finally { await database.close(); }
});

test('salvar destino já configurado mescla: campo enviado substitui a credencial guardada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'merge-substitui');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token-antigo', pixel_id: '111' },
    });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token-novo', pixel_id: '111' },
    });
    const destinations = await repository.conversionDestinations({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations.meta, { access_token: 'token-novo', pixel_id: '111' });
  } finally { await database.close(); }
});

test('sem destino salvo, mesclar não dispensa o campo obrigatório ausente', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'merge-sem-existente');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    // Não existe destino anterior: não há o que mesclar, e a exigência de campo obrigatório
    // continua valendo como sempre valeu.
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta', configuration: { pixel_id: '111' } }),
      /Configuração do destino inválida/,
    );
    const stored = await database.query('SELECT count(*)::int AS count FROM tracking_destinations WHERE company_id = $1 AND project_id = $2', [seeded.company.id, seeded.project.id]);
    assert.equal(stored.rows[0].count, 0);
  } finally { await database.close(); }
});

test('mesclar não abre porta para gravar valor fora do formato do provedor', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'merge-formato-invalido');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token-original', pixel_id: '111' },
    });
    // O resto da configuração vem do que já estava guardado, mas o campo enviado nesta
    // chamada continua sujeito à validação de formato do provedor.
    await assert.rejects(
      () => repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta', configuration: { pixel_id: 'não-é-um-número' } }),
      /Configuração do destino inválida/,
    );
    const destinations = await repository.conversionDestinations({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations.meta, { access_token: 'token-original', pixel_id: '111' });
  } finally { await database.close(); }
});

test('leitura de destinos devolve sempre os cinco provedores, configurados ou não, e nunca o segredo cifrado', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'leitura-destinos');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'segredo-nunca-deve-vazar', pixel_id: '123' },
    });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'google',
      configuration: { operating_account_id: '1', conversion_action_id: '2', oauth_access_token: 'outro-segredo-nunca-deve-vazar' },
      publicConfiguration: { measurement_id: 'G-ABCD1234' },
    });
    const destinations = await repository.destinationsFor({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.deepEqual(destinations.map((item) => item.provider), ['meta', 'tiktok', 'google', 'linkedin', 'taboola'], 'ordem estável, os cinco sempre presentes');
    const meta = destinations.find((item) => item.provider === 'meta');
    assert.equal(meta.configured, true);
    assert.deepEqual(meta.publicConfiguration, { pixel_id: '123' });
    assert.ok(meta.updatedAt, 'destino configurado tem data de atualização');
    const google = destinations.find((item) => item.provider === 'google');
    assert.equal(google.configured, true);
    assert.deepEqual(google.publicConfiguration, { measurement_id: 'G-ABCD1234' });
    for (const provider of ['tiktok', 'linkedin', 'taboola']) {
      const item = destinations.find((entry) => entry.provider === provider);
      assert.equal(item.configured, false);
      assert.deepEqual(item.publicConfiguration, {});
      assert.equal(item.updatedAt, null);
    }
    const serializado = JSON.stringify(destinations);
    assert.equal(serializado.includes('segredo-nunca-deve-vazar'), false, 'o token da Meta não pode aparecer na resposta');
    assert.equal(serializado.includes('outro-segredo-nunca-deve-vazar'), false, 'o token do Google não pode aparecer na resposta');
    assert.equal(serializado.includes('access_token'), false);
    assert.equal(serializado.includes('oauth_access_token'), false);
  } finally { await database.close(); }
});

test('leitura de destinos não mistura preview e produção', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'leitura-ambientes');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token-producao', pixel_id: '999' },
    });
    const producao = await repository.destinationsFor({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    const preview = await repository.destinationsFor({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'preview' });
    assert.equal(producao.find((item) => item.provider === 'meta').configured, true);
    assert.equal(preview.find((item) => item.provider === 'meta').configured, false);
  } finally { await database.close(); }
});

test('remover destino recusa provedor desconhecido', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'remover-provedor-invalido');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await assert.rejects(
      () => repository.removeDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'bitcoin-ads' }),
      /Destino de rastreamento inválido/,
    );
  } finally { await database.close(); }
});

test('remover destino que não existe não falha', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'remover-inexistente');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const resultado = await repository.removeDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta' });
    assert.deepEqual(resultado, { provider: 'meta', environment: 'production', configured: false });
    const destinations = await repository.destinationsFor({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.equal(destinations.every((item) => item.configured === false), true);
  } finally { await database.close(); }
});

test('remover o último destino do ambiente deixa o binding pending sem job condenado a falhar', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'remover-ultimo');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({
      companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta',
      configuration: { access_token: 'token', pixel_id: '111' },
    });
    const binding = (await database.query(
      "SELECT id FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND engine = 'conversions'",
      [seeded.company.id, seeded.project.id],
    )).rows[0];
    const antesDeRemover = await database.query('SELECT status FROM tracking_provision_jobs WHERE binding_id = $1', [binding.id]);
    assert.equal(antesDeRemover.rows[0].status, 'queued', 'salvar o único destino enfileira o provisionamento, como já acontecia');

    const resultado = await repository.removeDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta' });
    assert.deepEqual(resultado, { provider: 'meta', environment: 'production', configured: false });

    // "Nenhum destino configurado" é uma configuração legítima (o projeto não envia
    // conversões), não uma falha do provisionador local — por isso não pode sobrar job
    // tentando o impossível e acabando morto por um erro que fomos nós que causamos.
    const jobsDepois = await database.query('SELECT status FROM tracking_provision_jobs WHERE binding_id = $1', [binding.id]);
    assert.equal(jobsDepois.rowCount, 0, 'nenhum job deve seguir tentando provisionar um binding sem destino');
    const bindingDepois = await database.query('SELECT status, last_error FROM tracking_bindings WHERE id = $1', [binding.id]);
    assert.equal(bindingDepois.rows[0].status, 'pending');
    assert.equal(bindingDepois.rows[0].last_error, null);
  } finally { await database.close(); }
});

test('remover um destino mantendo outros ainda enfileira provisionamento, como o salvar', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'remover-parcial');
    const repository = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    await repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta', configuration: { access_token: 'token', pixel_id: '111' } });
    await repository.saveDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'tiktok', configuration: { access_token: 'token', pixel_code: 'pixel-code' } });

    await repository.removeDestination({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production', provider: 'meta' });

    const destinations = await repository.destinationsFor({ companyId: seeded.company.id, projectId: seeded.project.id, environment: 'production' });
    assert.equal(destinations.find((item) => item.provider === 'meta').configured, false);
    assert.equal(destinations.find((item) => item.provider === 'tiktok').configured, true);
    const binding = (await database.query(
      "SELECT id, status FROM tracking_bindings WHERE company_id = $1 AND project_id = $2 AND environment = 'production' AND engine = 'conversions'",
      [seeded.company.id, seeded.project.id],
    )).rows[0];
    assert.equal(binding.status, 'pending');
    const job = (await database.query('SELECT status FROM tracking_provision_jobs WHERE binding_id = $1', [binding.id])).rows[0];
    assert.equal(job.status, 'queued', 'ainda sobra destino, então o provisionamento é reenfileirado como no salvar');
  } finally { await database.close(); }
});

test('API expõe leitura e remoção de destinos, exige integration.manage e nunca serializa segredo', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'api-leitura-remocao');
    const tracking = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const capabilities = [];
    const context = { companyId: seeded.company.id, currentProjectId: seeded.project.id, user: { id: seeded.user.id }, role: 'owner' };
    const api = createProjectApi({
      tracking, body: async (req) => req.bodyValue,
      sessionService: { require: async () => context, authorize: async (_context, capability, projectId) => {
        capabilities.push(capability);
        assert.equal(capability, 'integration.manage');
        assert.equal(projectId, seeded.project.id);
      } },
    });
    const invoke = async ({ path, url = path, method, bodyValue = {}, headers = {} }) => {
      let result;
      await api({ req: { bodyValue, url, headers }, res: {}, path, method, json: (data, status = 200) => { result = { data, status }; } });
      return result;
    };
    const base = `/api/projects/${seeded.project.id}/tracking/destinations`;

    const vazio = await invoke({ path: base, method: 'GET' });
    assert.equal(vazio.data.length, 5);
    assert.equal(vazio.data.every((item) => item.configured === false), true, 'sem environment na query, assume produção');

    await invoke({ path: `${base}/meta`, method: 'PUT', bodyValue: { environment: 'production', configuration: { access_token: 'segredo-de-api-nunca-deve-vazar', pixel_id: '123' } }, headers: { 'content-type': 'application/json' } });

    const comMeta = await invoke({ path: base, url: `${base}?environment=production`, method: 'GET' });
    assert.equal(comMeta.data.find((item) => item.provider === 'meta').configured, true);
    assert.equal(JSON.stringify(comMeta.data).includes('segredo-de-api-nunca-deve-vazar'), false);

    const previewVazio = await invoke({ path: base, url: `${base}?environment=preview`, method: 'GET' });
    assert.equal(previewVazio.data.find((item) => item.provider === 'meta').configured, false, 'preview não herda o destino de produção');

    const removido = await invoke({ path: `${base}/meta`, url: `${base}/meta?environment=production`, method: 'DELETE' });
    assert.deepEqual(removido.data, { provider: 'meta', environment: 'production', configured: false });

    const semNovaFalha = await invoke({ path: `${base}/meta`, url: `${base}/meta?environment=production`, method: 'DELETE' });
    assert.equal(semNovaFalha.data.configured, false, 'remover de novo não explode');

    await assert.rejects(
      () => invoke({ path: `${base}/provedor-inventado`, url: `${base}/provedor-inventado?environment=production`, method: 'DELETE' }),
      /Destino de rastreamento inválido/,
    );

    assert.equal(capabilities.every((capability) => capability === 'integration.manage'), true);

    const forbidden = createProjectApi({
      sessionService: { require: async () => context, authorize: async () => { throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 }); } },
      tracking, body: async () => ({}),
    });
    await assert.rejects(
      () => forbidden({ req: { url: base }, res: {}, path: base, method: 'GET', json: () => {} }),
      (error) => error.status === 403,
    );
    await assert.rejects(
      () => forbidden({ req: { url: `${base}/meta` }, res: {}, path: `${base}/meta`, method: 'DELETE', json: () => {} }),
      (error) => error.status === 403,
    );
  } finally { await database.close(); }
});

test('API rejeita formato inválido de destino antes de cifrar ou enfileirar provisionamento', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  try {
    const seeded = await seed(database, 'provider-api');
    const tracking = new TrackingRepository(database, { masterKey: 'chave-de-teste' });
    const context = { companyId: seeded.company.id, currentProjectId: seeded.project.id, user: { id: seeded.user.id }, role: 'owner' };
    const api = createProjectApi({
      tracking, body: async (req) => req.bodyValue,
      sessionService: { require: async () => context, authorize: async (_context, capability, projectId) => {
        assert.equal(capability, 'integration.manage'); assert.equal(projectId, seeded.project.id);
      } },
    });
    await assert.rejects(
      () => api({ req: { bodyValue: { environment: 'production', configuration: { operating_account_id: 'account', conversion_action_id: '9', oauth_access_token: 'token' } }, url: `/api/projects/${seeded.project.id}/tracking/destinations/google` }, res: {}, path: `/api/projects/${seeded.project.id}/tracking/destinations/google`, method: 'PUT', json: () => {} }),
      /Configuração do destino inválida/,
    );
    const stored = await database.query('SELECT count(*)::int AS count FROM tracking_destinations WHERE company_id = $1 AND project_id = $2', [seeded.company.id, seeded.project.id]);
    assert.equal(stored.rows[0].count, 0);
  } finally { await database.close(); }
});

test('nova publicação exige apenas os bindings dos motores ativos sem invalidar snapshot já publicado', async () => {
  const required = [];
  const ready = { async assertReady(input) { required.push(input.engines); throw Object.assign(new Error('Rastreamento do ambiente ainda não está pronto.'), { status: 409 }); } };
  const service = new PublicationService({
    tracking: ready,
    trackingRequiredEngines: ['conversions'],
    snapshotBuilder: { build: async () => ({ hash: 'a'.repeat(64), manifest: [], files: [] }) },
    integrations: { credentials: async () => ({ token: 'privado', vercelProjectId: 'vercel' }), publicSettings: async () => ({ connectionStatus: 'configured' }) },
    deployments: { async latest() { return { id: 'snapshot-antigo', status: 'READY' }; }, async latestReady() { return null; } },
  });
  await assert.rejects(
    () => service.preview({ companyId: 'c', projectId: 'p', requestedBy: 'u', expectedRevision: 1 }),
    /rastreamento/i,
  );
  assert.deepEqual(required, [['conversions']]);
  const overview = await service.overview({ companyId: 'c', projectId: 'p' });
  assert.equal(overview.production.id, 'snapshot-antigo');
});

test('gate de publicação falha fechado quando há motores obrigatórios sem repositório', async () => {
  const service = new PublicationService({ trackingRequiredEngines: ['conversions'] });
  await assert.rejects(() => service.requireTracking({ companyId: 'c', projectId: 'p' }, 'preview'), /rastreamento/i);
});

test('API de tracking exige integration.manage e nunca serializa dados administrativos', async () => {
  const calls = [];
  const tracking = {
    async ensureJobs(input) { calls.push(['provision', input]); return { bindings: [{ id: 'publico', environment: 'preview', engine: 'conversions', status: 'pending' }] }; },
    async status(input) { calls.push(['status', input]); return { bindings: [] }; },
    async retry(input) { calls.push(['retry', input]); return { id: 'publico', environment: input.environment, engine: input.engine, status: 'pending' }; },
    async saveDestination(input) { calls.push(['destination', input]); return { provider: input.provider, environment: input.environment, configured: true }; },
  };
  const context = { companyId: 'company-a', currentProjectId: 'project-a', user: { id: 'user-a' }, role: 'owner' };
  const sessionService = { require: async () => context, authorize: async (_context, capability, projectId) => {
    if (projectId !== 'project-a') throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
    if (capability !== 'integration.manage') throw new Error('capacidade errada');
  } };
  const api = createProjectApi({ sessionService, tracking, body: async (req) => req.bodyValue });
  const invoke = async (path, method, bodyValue = {}) => {
    let result;
    await api({ req: { bodyValue, url: path }, res: {}, path, method, json: (data, status = 200) => { result = { data, status }; } });
    return result;
  };
  const provision = await invoke('/api/projects/project-a/tracking/provision', 'POST');
  assert.equal(provision.status, 202);
  assert.equal(JSON.stringify(provision.data).includes('remote'), false);
  await invoke('/api/projects/project-a/tracking/retry', 'POST', { environment: 'production', engine: 'conversions' });
  await invoke('/api/projects/project-a/tracking/destinations/meta', 'PUT', { environment: 'production', configuration: { pixel_id: 'pixel-1' } });
  assert.deepEqual(calls.map(([name]) => name), ['provision', 'retry', 'destination']);
  const forbidden = createProjectApi({ sessionService: { ...sessionService, authorize: async () => { throw Object.assign(new Error('Sem permissão para esta ação.'), { status: 403 }); } }, tracking, body: async () => ({}) });
  await assert.rejects(
    () => forbidden({ req: { url: '/api/projects/project-a/tracking/status' }, res: {}, path: '/api/projects/project-a/tracking/status', method: 'GET', json: () => {} }),
    (error) => error.status === 403,
  );
});
