import { lookup } from 'node:dns/promises';
import { resolveAndValidateDestination, pinnedFetch } from './outbound-webhook.mjs';

const BACKOFF_SCHEDULE_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
export const MAX_WEBHOOK_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

export function computeNextDelayMs(attemptNumber) {
  const index = Math.min(Math.max(attemptNumber, 1), BACKOFF_SCHEDULE_MS.length) - 1;
  return BACKOFF_SCHEDULE_MS[index];
}

async function attemptOnce({ delivery, dnsLookup, fetchImpl, timeoutMs }) {
  const url = new URL(delivery.url);
  const target = await resolveAndValidateDestination(url, dnsLookup);
  if (!target) return { ok: false, outcome: 'blocked_destination', detail: 'Destino bloqueado: DNS não resolveu ou aponta para rede privada.' };
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(delivery.event),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  };
  try {
    const transport = fetchImpl || ((u, o) => pinnedFetch(u, o, target.address));
    const response = await transport(url.toString(), options, target.address);
    if (response?.ok) return { ok: true, outcome: 'delivered', detail: `HTTP ${response.status ?? ''}`.trim() };
    return { ok: false, outcome: 'rejected', detail: `HTTP ${response?.status ?? 'desconhecido'}` };
  } catch (error) {
    return { ok: false, outcome: 'network_error', detail: String(error?.message || error) };
  }
}

// Processa entregas devidas até esgotar a fila (ou o teto por chamada), desacoplado de qualquer
// requisição HTTP: quem chama esta função é o worker (via startWebhookWorker), nunca o handler
// de submissão do formulário.
export async function processDueWebhookDeliveries({
  repository,
  dnsLookup = lookup,
  fetchImpl,
  timeoutMs = 3000,
  leaseMs = 30_000,
  maxPerRun = 50,
  now = () => new Date(),
}) {
  let processed = 0;
  while (processed < maxPerRun) {
    const claim = await repository.claimNextDue({ leaseMs });
    if (!claim.claimed) break;
    const { delivery, token } = claim;
    const attemptNumber = delivery.attemptCount + 1;
    const result = await attemptOnce({ delivery, dnsLookup, fetchImpl, timeoutMs });
    await repository.recordAttempt({
      deliveryId: delivery.id,
      companyId: delivery.companyId,
      projectId: delivery.projectId,
      attemptNumber,
      outcome: result.outcome,
      detail: result.detail,
    });
    if (result.ok) {
      await repository.markDelivered({ id: delivery.id, claimToken: token });
    } else if (attemptNumber >= MAX_WEBHOOK_ATTEMPTS) {
      await repository.markDead({ id: delivery.id, claimToken: token, attemptCount: attemptNumber, lastError: result.detail });
    } else {
      const nextAttemptAt = new Date(now().getTime() + computeNextDelayMs(attemptNumber));
      await repository.markRetry({ id: delivery.id, claimToken: token, attemptCount: attemptNumber, nextAttemptAt, lastError: result.detail });
    }
    processed += 1;
  }
  return { processed };
}

// Loop de fundo, independente do ciclo de vida de qualquer requisição: cada tick tenta esvaziar
// a fila de entregas devidas. Erros de um tick nunca derrubam o loop nem o servidor.
export function startWebhookWorker({ intervalMs = 5000, ...deps }) {
  let stopped = false;
  const runOnce = () => processDueWebhookDeliveries(deps);
  const tick = async () => {
    if (stopped) return;
    try { await runOnce(); } catch { /* um tick com erro não deve interromper o próximo */ }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    stop: () => { stopped = true; clearInterval(timer); },
    runOnce,
  };
}
