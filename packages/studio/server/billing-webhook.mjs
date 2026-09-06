import { timingSafeEqual } from 'node:crypto';

function fail(message, status) { return Object.assign(new Error(message), { status, statusCode: status }); }
function equal(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function acceptBillingWebhook({ method, headers = {}, raw, secret, environment, repository }) {
  if (method !== 'POST') throw fail('Método inválido.', 405);
  if (typeof secret !== 'string' || secret.length < 32) throw fail('Webhook de cobrança não configurado.', 503);
  if (!equal(headers['asaas-access-token'], secret)) throw fail('Não autorizado.', 401);
  if (!String(headers['content-type'] || '').startsWith('application/json')) throw fail('Envie JSON.', 415);
  if (!Buffer.isBuffer(raw) || raw.length > 64 * 1024) throw fail('Corpo muito grande.', 413);
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { throw fail('Evento inválido.', 400); }
  const providerEventId = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(providerEventId)) throw fail('Evento inválido.', 400);
  await repository.inboxWebhook({
    environment,
    raw: raw.toString('utf8'),
    provider: 'asaas',
    providerEventId,
    eventType: typeof payload?.event === 'string' ? payload.event : 'unknown',
    paymentId: typeof payload?.payment?.id === 'string' ? payload.payment.id : null,
    subscriptionId: typeof payload?.subscription?.id === 'string' ? payload.subscription.id : null,
  });
  return { status: 204 };
}
