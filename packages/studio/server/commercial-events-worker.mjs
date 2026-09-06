import { MAX_COMMERCIAL_ATTEMPTS, commercialRetryDelay } from './repositories/nvs-commercial-outbox-repository.mjs';

function safeError(error) {
  return String(error?.message || 'delivery_failed')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redigido]')
    .replace(/\b(secret|token|password|authorization|api[_-]?key)\b[^\s,;]*/gi, '$1=[redigido]')
    .replace(/[\r\n]/g, ' ').slice(0, 240);
}

export async function processDueCommercialEvents({ repository, client, maxPerRun = 50, leaseMs = 30_000, now = () => new Date() }) {
  let processed = 0;
  while (processed < maxPerRun) {
    const claim = await repository.claimNextDue({ leaseMs });
    if (!claim.claimed) break;
    const attemptCount = claim.delivery.attemptCount + 1;
    try {
      await client.sendEvent(claim.delivery.payload);
      await repository.markDelivered({ id: claim.delivery.id, claimToken: claim.token });
    } catch (error) {
      const lastError = safeError(error);
      if (attemptCount >= MAX_COMMERCIAL_ATTEMPTS) await repository.markDead({ id: claim.delivery.id, claimToken: claim.token, attemptCount, lastError });
      else await repository.markRetry({ id: claim.delivery.id, claimToken: claim.token, attemptCount, nextAttemptAt: new Date(now().getTime() + commercialRetryDelay(attemptCount)), lastError });
    }
    processed += 1;
  }
  return { processed };
}

export function startCommercialEventsWorker({ intervalMs = 5000, ...dependencies }) {
  let stopped = false;
  const runOnce = () => processDueCommercialEvents(dependencies);
  const timer = setInterval(() => { if (!stopped) runOnce().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return { runOnce, stop: () => { stopped = true; clearInterval(timer); } };
}
