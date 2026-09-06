#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project="alva-umami-contract-$$"
environment=$(mktemp)
cleanup() {
  docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$environment"
}
trap cleanup EXIT INT TERM

umask 077
random_hex() { openssl rand -hex 32; }
cat >"$environment" <<EOF
STUDIO_DATABASE_URL=postgresql://studio:$(random_hex)@studio-postgres:5432/studio
STUDIO_POSTGRES_PASSWORD=$(random_hex)
PUBLIC_ORIGIN=https://studio-contract.test
TRACKING_MASTER_KEY=$(random_hex)
UMAMI_POSTGRES_PASSWORD=$(random_hex)
UMAMI_APP_SECRET=$(random_hex)
UMAMI_USERNAME=tracking-provisioner
UMAMI_PASSWORD=$(random_hex)
UMAMI_BOOTSTRAP_ASSERT_ARGV=true
NVS_MARIADB_PASSWORD=$(random_hex)
NVS_MARIADB_ROOT_PASSWORD=$(random_hex)
NVS_INTERNAL_HMAC_SECRET=$(random_hex)
NVS_PROPERTY_SECRETS_KEY=$(random_hex)
EOF

if ! docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" up --build --detach umami >/dev/null; then
  docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" logs --no-color umami >&2 || true
  exit 1
fi
if ! docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" exec -T umami node --input-type=module <<'NODE'
const username = process.env.UMAMI_USERNAME;
const password = process.env.UMAMI_PASSWORD;
const website = { id: '0d8a9f7e-2aa4-4d0f-aef7-bd850453ccb6', name: 'Contrato Preview', domain: 'preview-contract.tracking.internal' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let login;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    login = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (login.ok) break;
  } catch {}
  await delay(500);
}
if (!login?.ok) throw new Error('a credencial técnica não autenticou');
const { token } = await login.json();
if (!token) throw new Error('a credencial técnica não autenticou');
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const created = await fetch('http://127.0.0.1:3000/api/websites', { method: 'POST', headers, body: JSON.stringify(website) });
if (created.status !== 200) throw new Error(`POST website retornou ${created.status}`);
const found = await fetch(`http://127.0.0.1:3000/api/websites/${website.id}`, { headers: { Authorization: `Bearer ${token}` } });
const payload = await found.json();
if (!found.ok || payload.id !== website.id || payload.name !== website.name || payload.domain !== website.domain) throw new Error('GET não confirmou o ID e campos estáveis');
const duplicate = await fetch('http://127.0.0.1:3000/api/websites', { method: 'POST', headers, body: JSON.stringify(website) });
if (duplicate.status !== 500) throw new Error(`o conflito do Umami 3.3.1 mudou: ${duplicate.status}`);
NODE
then
  docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" logs --no-color umami >&2 || true
  exit 1
fi
technical_role=$(docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" exec -T umami-postgres psql -U umami -d umami --tuples-only --no-align --command "SELECT role FROM \"user\" WHERE username = 'tracking-provisioner' AND deleted_at IS NULL")
[ "$technical_role" = 'user' ] || { printf '%s\n' 'A conta técnica Umami não tem a role mínima user.' >&2; exit 1; }
seed_absent=$(docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" exec -T umami-postgres psql -U umami -d umami --tuples-only --no-align --command "SELECT NOT EXISTS (SELECT 1 FROM \"user\" WHERE username = 'admin')")
[ "$seed_absent" = 't' ] || { printf '%s\n' 'O usuário seed padrão do Umami permaneceu no banco.' >&2; exit 1; }
set -a
. "$environment"
set +a
docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" logs --no-color umami | node --input-type=module --eval 'let logs = ""; for await (const part of process.stdin) logs += part; for (const value of [process.env.UMAMI_PASSWORD, process.env.UMAMI_POSTGRES_PASSWORD]) if (value && logs.includes(value)) throw new Error("log do Umami expôs segredo");'
printf '%s\n' 'Umami 3.3.1: bootstrap técnico e contrato de ID estável verificados.'
