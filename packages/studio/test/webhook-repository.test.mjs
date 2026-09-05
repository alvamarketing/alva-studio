import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { WebhookDeliveryRepository } from '../server/repositories/webhook-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

async function seedFormSubmission(database) {
  const suffix = randomUUID();
  const user = (await database.query(
    "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Dona') RETURNING id",
    [`dona-${suffix}@alva.test`],
  )).rows[0];
  const company = (await database.query(
    'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
    [`Empresa ${suffix}`, `empresa-${suffix}`],
  )).rows[0];
  await database.query(
    "INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())",
    [company.id, user.id],
  );
  const project = (await database.query(
    'INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [company.id, `Projeto ${suffix}`, `projeto-${suffix}`, user.id],
  )).rows[0];
  const route = (await database.query(
    "INSERT INTO project_routes (company_id, project_id, path, content_type) VALUES ($1, $2, $3, 'form') RETURNING id",
    [company.id, project.id, `/formulario-${suffix}`],
  )).rows[0];
  const form = (await database.query(
    'INSERT INTO forms (company_id, project_id, route_id, name, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [company.id, project.id, route.id, `Formulário ${suffix}`, user.id],
  )).rows[0];
  const version = (await database.query(
    "INSERT INTO form_versions (company_id, project_id, form_id, version_number, schema) VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id",
    [company.id, project.id, form.id],
  )).rows[0];
  const submission = (await database.query(
    "INSERT INTO form_submissions (company_id, project_id, form_id, form_version_id, answers) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id",
    [company.id, project.id, form.id, version.id, JSON.stringify({ email: 'lead@alva.test' })],
  )).rows[0];
  return { companyId: company.id, projectId: project.id, formId: form.id, submissionId: submission.id };
}

test('fila de entrega de webhook: enfileira com idempotência, reivindica com exclusividade e nunca reabre uma entrega confirmada', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  t.after(() => database.close());
  await migrate(database);
  const repository = new WebhookDeliveryRepository(database);
  const seed = await seedFormSubmission(database);
  const enqueueInput = {
    companyId: seed.companyId, projectId: seed.projectId, formId: seed.formId, submissionId: seed.submissionId,
    url: 'https://hooks.example.test/lead', event: { eventId: randomUUID(), event: 'form.submitted' },
  };

  const first = await repository.enqueue(database, enqueueInput);
  assert.equal(first.status, 'pending');
  assert.equal(first.attemptCount, 0);

  const second = await repository.enqueue(database, { ...enqueueInput, url: 'https://outro.example.test/lead' });
  assert.equal(second.id, first.id, 'reenfileirar a mesma submissão não deve criar uma segunda entrega');
  const countAfterDuplicate = await database.query('SELECT count(*)::int AS count FROM webhook_deliveries');
  assert.equal(countAfterDuplicate.rows[0].count, 1);

  const claim = await repository.claimNextDue({ leaseMs: 60_000 });
  assert.equal(claim.claimed, true);
  assert.equal(claim.delivery.id, first.id);

  const raceClaim = await repository.claimNextDue({ leaseMs: 60_000 });
  assert.equal(raceClaim.claimed, false, 'uma entrega já reivindicada (lease ativo) não pode ser reivindicada de novo');

  await repository.recordAttempt({ deliveryId: first.id, companyId: seed.companyId, projectId: seed.projectId, attemptNumber: 1, outcome: 'blocked_private_ip', detail: 'endereço 10.0.0.1 bloqueado' });
  await repository.recordAttempt({ deliveryId: first.id, companyId: seed.companyId, projectId: seed.projectId, attemptNumber: 1, outcome: 'delivered', detail: 'duplicata deve ser ignorada' });
  const attempts = await database.query('SELECT attempt_number, outcome FROM webhook_delivery_attempts WHERE delivery_id = $1 ORDER BY attempt_number', [first.id]);
  assert.equal(attempts.rows.length, 1, 'um número de tentativa só pode gravar um registro de auditoria');
  assert.equal(attempts.rows[0].outcome, 'blocked_private_ip');

  const retried = await repository.markRetry({ id: first.id, claimToken: claim.token, attemptCount: 1, nextAttemptAt: new Date(Date.now() + 60_000), lastError: 'bloqueado' });
  assert.equal(retried.status, 'pending');
  assert.equal(retried.attemptCount, 1);
  assert.ok(retried.nextAttemptAt > new Date());

  const notYetDue = await repository.claimNextDue({ leaseMs: 60_000 });
  assert.equal(notYetDue.claimed, false, 'não pode reivindicar antes do próximo horário de tentativa');

  await database.query('UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1', [first.id]);
  const secondClaim = await repository.claimNextDue({ leaseMs: 60_000 });
  assert.equal(secondClaim.claimed, true);

  const delivered = await repository.markDelivered({ id: first.id, claimToken: secondClaim.token });
  assert.equal(delivered.status, 'delivered');

  const staleRetryAttempt = await repository.markRetry({ id: first.id, claimToken: secondClaim.token, attemptCount: 2, nextAttemptAt: new Date(), lastError: 'não deveria acontecer' });
  assert.equal(staleRetryAttempt, null, 'uma entrega já confirmada como entregue nunca pode voltar a pending');

  const finalRow = await database.query('SELECT status FROM webhook_deliveries WHERE id = $1', [first.id]);
  assert.equal(finalRow.rows[0].status, 'delivered');

  const deadEnqueue = await seedFormSubmission(database);
  const deadInput = { companyId: deadEnqueue.companyId, projectId: deadEnqueue.projectId, formId: deadEnqueue.formId, submissionId: deadEnqueue.submissionId, url: 'https://hooks.example.test/lead', event: { eventId: randomUUID() } };
  await repository.enqueue(database, deadInput);
  const deadClaim = await repository.claimNextDue({ leaseMs: 60_000 });
  const dead = await repository.markDead({ id: deadClaim.delivery.id, claimToken: deadClaim.token, attemptCount: 6, lastError: 'excedeu tentativas' });
  assert.equal(dead.status, 'dead');
});
