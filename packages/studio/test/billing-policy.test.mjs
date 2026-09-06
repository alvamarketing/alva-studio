import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessForSubscription, billingAccessForCompany, canMutateWithEntitlement, enforcementIsValid, isConfirmingPaymentStatus } from '../server/billing-policy.mjs';

const now = new Date('2026-09-05T12:00:00.000Z');
const activePlan = { code: 'studio-essential-v1', status: 'active', priceCents: 9900 };
const sandboxActivation = { environment: 'sandbox', enforcementEnabled: true, planCode: 'studio-essential-v1', approvedPriceCents: 9900 };
const productionActivation = { ...sandboxActivation, environment: 'production', approvedByUserId: '00000000-0000-4000-8000-000000000001', approvedAt: now, checklistCompletedAt: now, graceDays: 7 };

test('política calcula acesso para todos os estados e datas de contrato', () => {
  const activation = sandboxActivation;
  assert.deepEqual(accessForSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00Z' }, activation, now), { accessState: 'active', effectiveUntil: new Date('2026-10-01T00:00:00Z') });
  assert.equal(accessForSubscription({ status: 'active', currentPeriodEnd: '2026-09-01T00:00:00Z' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'pending_checkout' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'canceled' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'suspended' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'cancel_at_period_end', currentPeriodEnd: '2026-10-01T00:00:00Z' }, activation, now).accessState, 'active');
  assert.equal(accessForSubscription({ status: 'cancel_at_period_end', currentPeriodEnd: '2026-09-01T00:00:00Z' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'past_due', graceUntil: '2026-09-06T00:00:00Z' }, activation, now).accessState, 'active');
  assert.equal(accessForSubscription({ status: 'past_due', graceUntil: '2026-09-01T00:00:00Z' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'active', currentPeriodEnd: 'not-a-date' }, activation, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00Z' }, { ...sandboxActivation, approvedPriceCents: 0 }, now).accessState, 'read_only');
  assert.equal(accessForSubscription({ status: 'past_due', graceUntil: '2026-09-06T00:00:00Z' }, { ...sandboxActivation, environment: 'production' }, now).accessState, 'read_only');
});

test('política só confirma pagamentos recebidos ou confirmados e exige ativação completa', () => {
  assert.equal(isConfirmingPaymentStatus('RECEIVED'), true);
  assert.equal(isConfirmingPaymentStatus('CONFIRMED'), true);
  assert.equal(isConfirmingPaymentStatus('PENDING'), false);
  assert.equal(enforcementIsValid(sandboxActivation, activePlan), true);
  assert.equal(enforcementIsValid({ ...productionActivation, graceDays: null }, activePlan), false);
  assert.equal(enforcementIsValid({ ...productionActivation, checklistCompletedAt: null }, activePlan), false);
});

test('enforcement off mantém acesso pleno e read only bloqueia só mutações não financeiras', () => {
  assert.deepEqual(billingAccessForCompany({ enforcement: 'off', entitlement: null }), { accessState: 'active', limits: null, effectiveUntil: null });
  assert.deepEqual(billingAccessForCompany({ entitlement: null }), { accessState: 'active', limits: null, effectiveUntil: null });
  assert.deepEqual(billingAccessForCompany({ enforcement: 'sandbox', activation: sandboxActivation, plan: activePlan, entitlement: { accessState: 'active', limits: { projects: 5 } } }), { accessState: 'active', limits: { projects: 5 }, effectiveUntil: null });
  assert.equal(billingAccessForCompany({ enforcement: 'sandbox', activation: { ...sandboxActivation, approvedPriceCents: 1 }, plan: activePlan, entitlement: { accessState: 'active' } }).accessState, 'read_only');
  assert.equal(billingAccessForCompany({ enforcement: 'production', activation: sandboxActivation, plan: activePlan, entitlement: { accessState: 'active' } }).accessState, 'read_only');
  assert.equal(canMutateWithEntitlement({ accessState: 'read_only' }, { method: 'GET', path: '/api/projects' }), true);
  assert.equal(canMutateWithEntitlement({ accessState: 'read_only' }, { method: 'PUT', path: '/api/projects/x' }), false);
  assert.equal(canMutateWithEntitlement({ accessState: 'read_only' }, { method: 'POST', path: '/api/projects' }), false);
  for (const path of ['/api/billing/checkout', '/api/billing/cancel', '/api/logout']) assert.equal(canMutateWithEntitlement({ accessState: 'read_only' }, { method: 'POST', path }), true);
});
