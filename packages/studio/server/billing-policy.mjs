const CONFIRMING_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED']);
const SUBSCRIPTION_STATUSES = new Set(['pending_checkout', 'active', 'past_due', 'cancel_at_period_end', 'canceled', 'suspended']);
const READ_ONLY_POSTS = new Set(['/api/billing/checkout', '/api/billing/cancel', '/api/logout']);

function value(item, camel, snake) {
  return item?.[camel] ?? item?.[snake] ?? null;
}

function date(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function activationIsValid(activation) {
  const environment = value(activation, 'environment', 'environment');
  const enabled = value(activation, 'enforcementEnabled', 'enforcement_enabled');
  const planCode = value(activation, 'planCode', 'plan_code');
  const price = value(activation, 'approvedPriceCents', 'approved_price_cents');
  if (!enabled || !['sandbox', 'production'].includes(environment) || !planCode || !Number.isInteger(price) || price <= 0) return false;
  if (environment === 'sandbox') return true;
  return Boolean(value(activation, 'approvedByUserId', 'approved_by_user_id') && date(value(activation, 'approvedAt', 'approved_at')) && date(value(activation, 'checklistCompletedAt', 'checklist_completed_at')) && Number.isInteger(value(activation, 'graceDays', 'grace_days')) && value(activation, 'graceDays', 'grace_days') >= 0);
}

export function isConfirmingPaymentStatus(status) {
  return CONFIRMING_PAYMENT_STATUSES.has(status);
}

export function accessForSubscription(subscription, activation, now = new Date()) {
  const instant = date(now);
  const status = value(subscription, 'status', 'status');
  if (!activationIsValid(activation))
    return { accessState: 'read_only', effectiveUntil: null };
  if (!instant || !SUBSCRIPTION_STATUSES.has(status)) return { accessState: 'read_only', effectiveUntil: null };
  if (status === 'active') {
    const until = date(value(subscription, 'currentPeriodEnd', 'current_period_end'));
    return until && until > instant ? { accessState: 'active', effectiveUntil: until } : { accessState: 'read_only', effectiveUntil: until };
  }
  if (status === 'cancel_at_period_end') {
    const until = date(value(subscription, 'currentPeriodEnd', 'current_period_end'));
    return until && until > instant ? { accessState: 'active', effectiveUntil: until } : { accessState: 'read_only', effectiveUntil: until };
  }
  if (status === 'past_due') {
    const until = date(value(subscription, 'graceUntil', 'grace_until'));
    return until && until > instant ? { accessState: 'active', effectiveUntil: until } : { accessState: 'read_only', effectiveUntil: until };
  }
  return { accessState: 'read_only', effectiveUntil: null };
}

export function enforcementIsValid(activation, plan) {
  const environment = value(activation, 'environment', 'environment');
  const planCode = value(activation, 'planCode', 'plan_code');
  const price = value(activation, 'approvedPriceCents', 'approved_price_cents');
  return activationIsValid(activation) && plan?.status === 'active' && planCode === plan?.code && price === value(plan, 'priceCents', 'price_cents');
}

export function billingAccessForCompany({ enforcement, activation, plan, entitlement }) {
  if (enforcement === undefined || enforcement === 'off') return { accessState: 'active', limits: null, effectiveUntil: null };
  if (!['sandbox', 'production'].includes(enforcement) || !entitlement || activation?.environment !== enforcement || !enforcementIsValid(activation, plan)) return { accessState: 'read_only', limits: null, effectiveUntil: null };
  return {
    accessState: value(entitlement, 'accessState', 'access_state') === 'active' ? 'active' : 'read_only',
    limits: value(entitlement, 'limits', 'limits'),
    effectiveUntil: date(value(entitlement, 'effectiveUntil', 'effective_until')),
  };
}

export function canMutateWithEntitlement(entitlement, { method, path }) {
  if (value(entitlement, 'accessState', 'access_state') !== 'read_only') return true;
  if (String(method).toUpperCase() === 'GET' || String(method).toUpperCase() === 'HEAD' || String(method).toUpperCase() === 'OPTIONS') return true;
  return String(method).toUpperCase() === 'POST' && READ_ONLY_POSTS.has(path);
}
