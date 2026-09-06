import { readFile } from 'node:fs/promises';

const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE || '/tmp/alva-worker-heartbeat.json';
const maxAgeMs = Number(process.env.WORKER_HEARTBEAT_MAX_AGE_MS || 30_000);

try {
  const heartbeat = JSON.parse(await readFile(heartbeatFile, 'utf8'));
  const age = Date.now() - Date.parse(heartbeat.at);
  if (!heartbeat.role || !Number.isFinite(age) || age < 0 || age > maxAgeMs) throw new Error('heartbeat stale');
} catch {
  process.exitCode = 1;
}
