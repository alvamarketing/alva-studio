export const TRACKING_PROVISION_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
export const MAX_TRACKING_PROVISION_ATTEMPTS = TRACKING_PROVISION_BACKOFF_MS.length;
export function trackingProvisionDelay(attempt) { return TRACKING_PROVISION_BACKOFF_MS[Math.max(0, Math.min(attempt - 1, TRACKING_PROVISION_BACKOFF_MS.length - 1))]; }

function safeFailure(error) { return String(error?.message || 'Falha no provisionamento.').replace(/[\r\n]/g, ' ').slice(0, 240); }
function nvsPropertyId(bindingId) { return `nvs_${bindingId.replace(/-/g, '')}`; }

export async function processDueTrackingProvisionJobs({ repository, clients, maxPerRun = 50, leaseMs = 30_000, now = () => new Date() }) {
  let processed = 0;
  while (processed < maxPerRun) {
    const claim = await repository.claimNextDue({ leaseMs });
    if (!claim.claimed) break;
    const { job, token } = claim;
    const attempt = job.attemptCount + 1;
    try {
      const client = clients?.[job.engine];
      if (!client || typeof client.provision !== 'function') throw new Error('Motor de rastreamento indisponível.');
      const result = await client.provision({
        companyId: job.companyId, projectId: job.projectId, bindingId: job.bindingId,
        environment: job.environment, projectName: job.projectName, projectSlug: job.projectSlug,
        propertyId: job.engine === 'nvs' ? (job.remoteReference || nvsPropertyId(job.bindingId)) : undefined,
        destinations: job.engine === 'nvs' ? await repository.nvsDestinations({ companyId: job.companyId, projectId: job.projectId, environment: job.environment }) : undefined,
      });
      await repository.markReady({ jobId: job.id, bindingId: job.bindingId, claimToken: token, remoteReference: result?.remoteId || null });
    } catch (error) {
      if (attempt >= MAX_TRACKING_PROVISION_ATTEMPTS) {
        await repository.markDead({ jobId: job.id, bindingId: job.bindingId, claimToken: token, attemptCount: attempt, lastError: safeFailure(error) });
      } else {
        await repository.markRetry({ jobId: job.id, bindingId: job.bindingId, claimToken: token, attemptCount: attempt, nextAttemptAt: new Date(now().getTime() + trackingProvisionDelay(attempt)), lastError: safeFailure(error) });
      }
    }
    processed += 1;
  }
  return { processed };
}

export function startTrackingProvisionWorker({ intervalMs = 5000, ...deps }) {
  let stopped = false;
  const runOnce = () => processDueTrackingProvisionJobs(deps);
  const tick = async () => { if (!stopped) await runOnce().catch(() => {}); };
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  return { runOnce, stop: () => { stopped = true; clearInterval(timer); } };
}
