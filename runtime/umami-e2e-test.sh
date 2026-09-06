#!/bin/sh
set -eu

# Homologação descartável: não usa portas publicadas, credenciais reais ou recursos já existentes.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project="alva-umami-e2e-$$"
environment=$(mktemp)
cleanup() {
  docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$environment"
}
trap cleanup EXIT INT TERM

umask 077
random_hex() { openssl rand -hex 32; }
studio_db_password=$(random_hex)
cat >"$environment" <<EOF
STUDIO_DATABASE_URL=postgresql://studio:${studio_db_password}@studio-postgres:5432/studio
STUDIO_POSTGRES_PASSWORD=${studio_db_password}
PUBLIC_ORIGIN=https://studio-e2e.test
TRACKING_MASTER_KEY=$(random_hex)
UMAMI_POSTGRES_PASSWORD=$(random_hex)
UMAMI_APP_SECRET=$(random_hex)
UMAMI_USERNAME=tracking-provisioner
UMAMI_PASSWORD=$(random_hex)
UMAMI_RUNTIME_ENABLED=true
NVS_RUNTIME_ENABLED=false
TRACKING_PROVISION_ENABLED=false
NVS_MARIADB_PASSWORD=$(random_hex)
NVS_MARIADB_ROOT_PASSWORD=$(random_hex)
NVS_INTERNAL_HMAC_SECRET=$(random_hex)
NVS_PROPERTY_SECRETS_KEY=$(random_hex)
EOF

compose() { docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" "$@"; }
compose up --build --detach studio-web umami >/dev/null
ready=false
for attempt in $(seq 1 45); do
  if compose exec -T studio-web node -e "Promise.all([fetch('http://127.0.0.1:4178/health/ready'),fetch('http://umami:3000/api/heartbeat')]).then(([studio,umami]) => process.exit(studio.ok && umami.status === 200 ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || {
  compose logs --no-color studio-web >&2 || true
  compose run --rm --no-deps studio-web node --input-type=module <<'NODE' >&2 || true
import { createDatabase, migrate } from './server/db/postgres.mjs';
const database = createDatabase({ connectionString: process.env.DATABASE_URL, log: () => {} });
try { await migrate(database); } catch (error) { console.error(`Umami E2E migration diagnostic: ${error.name}: ${error.message}`); process.exitCode = 1; } finally { await database.close(); }
NODE
  printf '%s\n' 'Umami E2E: Studio não ficou pronto.' >&2; exit 1;
}

# A execução acontece dentro do Studio: o gateway, o cliente administrativo e o banco usado são os
# mesmos do runtime, mas a rede/volumes são exclusivos deste projeto Compose.
driver_output=$(compose exec -T studio-web node --input-type=module <<'NODE'
import { createDatabase, migrate } from './server/db/postgres.mjs';
import { TrackingRepository } from './server/repositories/tracking-repository.mjs';
import { UmamiClient } from './server/tracking-clients.mjs';
import { request as httpRequest } from 'node:http';

const database = createDatabase({ connectionString: process.env.DATABASE_URL, log: () => {} });
const fail = (message) => { throw new Error(`Umami E2E: ${message}`); };
try {
  await migrate(database);
  const suffix = `e2e-${process.pid}`;
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'e2e', 'E2E') RETURNING id", [`${suffix}@example.invalid`])).rows[0];
  const company = (await database.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`E2E ${suffix}`, suffix])).rows[0];
  const project = (await database.query('INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [company.id, `E2E ${suffix}`, suffix, user.id])).rows[0];
  const previewHost = `preview-${suffix}.tracking.internal`;
  const productionHost = `production-${suffix}.tracking.internal`;
  const previewOrigin = `https://${previewHost}`;
  const productionOrigin = `https://${productionHost}`;
  await database.query(
    `INSERT INTO project_domains (company_id, project_id, environment, domain, is_canonical, verification_status)
     VALUES ($1, $2, 'preview', $3, true, 'verified'), ($1, $2, 'production', $4, true, 'verified')`,
    [company.id, project.id, previewHost, productionHost],
  );
  const repository = new TrackingRepository(database);
  const umami = new UmamiClient();
  for (;;) {
    const claim = await repository.claimNextDue();
    if (!claim.claimed) break;
    if (claim.job.companyId !== company.id) fail('fila recebeu trabalho fora do escopo isolado');
    if (claim.job.engine === 'umami') {
      const result = await umami.provision({ bindingId: claim.job.bindingId, projectName: claim.job.projectName, projectSlug: claim.job.projectSlug, environment: claim.job.environment });
      await repository.markReady({ jobId: claim.job.id, bindingId: claim.job.bindingId, claimToken: claim.token, remoteReference: result.remoteId });
    } else {
      await repository.markDead({ jobId: claim.job.id, bindingId: claim.job.bindingId, claimToken: claim.token, attemptCount: 1, lastError: 'fora do escopo da homologação Umami' });
    }
  }
  const websites = (await database.query(
    `SELECT website.environment, website.tracker_public_id, website.cutover_at, binding.encrypted_remote_reference
       FROM analytics_websites website
       JOIN tracking_bindings binding ON binding.company_id = website.company_id AND binding.project_id = website.project_id
        AND binding.environment = website.environment AND binding.engine = 'umami'
      WHERE website.company_id = $1 AND website.project_id = $2 ORDER BY website.environment`,
    [company.id, project.id],
  )).rows;
  if (websites.length !== 2 || new Set(websites.map((row) => row.tracker_public_id)).size !== 2) fail('tokens preview/produção não são independentes');
  const preview = websites.find((row) => row.environment === 'preview');
  const production = websites.find((row) => row.environment === 'production');
  if (!preview || !production || preview.cutover_at || production.cutover_at) fail('estado inicial de cutover inválido');
  const host = 'studio-e2e.test';
  const studioRequest = (path, { method = 'GET', payload, origin = previewOrigin } = {}) => new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = httpRequest({ host: '127.0.0.1', port: 4178, path, method, headers: { Host: host, Origin: origin, 'User-Agent': 'e2e-browser', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject); if (body) req.write(body); req.end();
  });
  const script = await studioRequest('/tracker.js', { origin: 'https://studio-e2e.test' });
  const scriptText = script.text;
  if (script.status !== 200 || !scriptText.includes('data-website-id') || !scriptText.includes('/api/public/umami/send')) fail(`script oficial inválido: status=${script.status} data-website-id=${scriptText.includes('data-website-id')} gateway=${scriptText.includes('/api/public/umami/send')}`);

  const base = { type: 'event', payload: { website: preview.tracker_public_id, hostname: previewHost, url: `https://${previewHost}/oferta?utm_source=e2e&utm_campaign=cutover`, referrer: '', screen: '1440x900', language: 'pt-BR', ip: '203.0.113.77', 'user-agent': 'e2e-payload-agent' } };
  const pii = structuredClone(base);
  pii.payload.url = `https://${previewHost}/oferta?email=e2e-pii%40example.invalid`;
  if ((await studioRequest('/api/public/umami/send', { method: 'POST', payload: pii })).status !== 400) fail('PII não foi recusada pelo gateway');
  const before = await database.query('SELECT cutover_at FROM analytics_websites WHERE company_id = $1 AND project_id = $2 AND environment = $3', [company.id, project.id, 'preview']);
  if (before.rows[0]?.cutover_at) fail('cutover ocorreu antes de envio aceito');
  const crossEnvironment = structuredClone(base);
  crossEnvironment.payload.website = production.tracker_public_id;
  crossEnvironment.payload.hostname = productionHost;
  crossEnvironment.payload.url = `${productionOrigin}/oferta?utm_source=e2e`;
  if ((await studioRequest('/api/public/umami/send', { method: 'POST', payload: crossEnvironment })).status !== 403) fail('origem preview foi aceita pelo token de produção');

  if ((await studioRequest('/api/public/umami/send', { method: 'POST', payload: base })).status !== 204) fail('pageview permitido não chegou ao gateway');
  const custom = structuredClone(base);
  custom.payload.name = 'form_start'; custom.payload.data = { formId: 'form-e2e' };
  if ((await studioRequest('/api/public/umami/send', { method: 'POST', payload: custom })).status !== 204) fail('evento permitido não chegou ao gateway');
  const after = await database.query('SELECT environment, cutover_at FROM analytics_websites WHERE company_id = $1 AND project_id = $2 ORDER BY environment', [company.id, project.id]);
  if (!after.rows.find((row) => row.environment === 'preview')?.cutover_at || after.rows.find((row) => row.environment === 'production')?.cutover_at) fail('cutover não respeitou o ambiente');
  const legacy = await database.query('SELECT count(*)::int AS total FROM analytics_events WHERE company_id = $1 AND project_id = $2', [company.id, project.id]);
  if (legacy.rows[0].total !== 0) fail('flag Umami permitiu escrita no coletor legado');
  const legacyResponse = await studioRequest('/api/public/collect', { method: 'POST', payload: { trackerPublicId: preview.tracker_public_id, event_name: 'pageview', url_path: '/' } });
  if (legacyResponse.status === 204) fail('endpoint legado aceitou escrita após a flag Umami');
  const legacyAfter = await database.query('SELECT count(*)::int AS total FROM analytics_events WHERE company_id = $1 AND project_id = $2', [company.id, project.id]);
  if (legacyAfter.rows[0].total !== 0) fail('endpoint legado escreveu após a flag Umami');

  const previewRemote = await repository.remoteWebsiteFor({ companyId: company.id, projectId: project.id, environment: 'preview' });
  const productionRemote = await repository.remoteWebsiteFor({ companyId: company.id, projectId: project.id, environment: 'production' });
  if (!previewRemote || !productionRemote || previewRemote === productionRemote) fail('referências remotas dos ambientes não são independentes');
  console.log(`UMAMI_E2E_REMOTE ${previewRemote} ${productionRemote}`);
  console.log('Umami E2E: gateway, cutover e bloqueio legado confirmados.');
} finally {
  await database.close();
}
NODE
)
printf '%s\n' "$driver_output"
remote_ids=$(printf '%s\n' "$driver_output" | awk '/^UMAMI_E2E_REMOTE / { print $2 " " $3 }')
preview_remote=${remote_ids%% *}
production_remote=${remote_ids#* }
[ -n "$preview_remote" ] && [ -n "$production_remote" ] && [ "$preview_remote" != "$production_remote" ] || { printf '%s\n' 'Umami E2E: referências remotas não foram registradas.' >&2; exit 1; }
# Umami 3.3.1 persiste pageviews e eventos em website_event; event_data contém apenas propriedades.
# O endpoint de ingestão pode responder antes de o commit ficar visível na conexão de leitura.
deadline=$(( $(date +%s) + 12 ))
delivery='0|0|0|0'
while :; do
  delivery=$(compose exec -T umami-postgres psql -U umami -d umami --tuples-only --no-align --field-separator='|' --command "SELECT count(*) FILTER (WHERE website_id = '$preview_remote' AND event_name IS NULL), count(*) FILTER (WHERE website_id = '$preview_remote' AND event_name = 'form_start'), count(*) FILTER (WHERE website_id = '$production_remote'), count(*) FILTER (WHERE website_id NOT IN ('$preview_remote', '$production_remote')) FROM \"website_event\"")
  [ "$delivery" = '1|1|0|0' ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { printf 'Umami E2E: eventos não ficaram isolados no website preview (pageview|form_start|produção|fora=%s).\n' "$delivery" >&2; exit 1; }
  sleep 1
done

# A URL com PII foi recusada; confira que ela não apareceu na linha persistida.
pii_rows=$(compose exec -T umami-postgres psql -U umami -d umami --tuples-only --no-align --command "SELECT count(*) FROM \"website_event\" WHERE website_id = '$preview_remote' AND (COALESCE(url_path, '') || COALESCE(url_query, '')) LIKE '%e2e-pii%'")
[ "$pii_rows" = '0' ] || { printf '%s\n' 'Umami E2E: dado PII persistido.' >&2; exit 1; }
# O contrato 3.3.1 não tem colunas para IP ou user-agent brutos; o gateway também descarta ambos.
raw_identifier_columns=$(compose exec -T umami-postgres psql -U umami -d umami --tuples-only --no-align --command "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND lower(column_name) IN ('ip', 'ip_address', 'user_agent', 'useragent')")
[ "$raw_identifier_columns" = '0' ] || { printf '%s\n' 'Umami E2E: schema permite identificador bruto proibido.' >&2; exit 1; }
printf '%s\n' 'Umami E2E descartável aprovado; recursos alva-umami-e2e-* removidos no encerramento.'
