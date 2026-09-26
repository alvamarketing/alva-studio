#!/bin/sh
set -eu

# Ensaio descartável: somente o banco do Compose isolado, valores fictícios e sem pull de imagens.
#
# Eram três bancos enquanto o Analytics e o Rastreamento vinham de produtos externos. Sobrou
# um: o Postgres do Studio.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project="alva-restore-cert-$$"
workspace=$(mktemp -d)
environment="$workspace/runtime.env"
backup_dir="$workspace/backup"

cleanup() {
  docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$workspace"
}
trap cleanup EXIT HUP INT TERM

umask 077
random_hex() { openssl rand -hex 32; }
studio_password=$(random_hex)
cat >"$environment" <<EOF
STUDIO_POSTGRES_PASSWORD=$studio_password
STUDIO_DATABASE_URL=postgresql://studio:$studio_password@studio-postgres:5432/studio
PUBLIC_ORIGIN=https://studio-restore.local.test
TRACKING_MASTER_KEY=$(random_hex)
PUBLICATION_RUNTIME_HMAC_SECRET=$(random_hex)
PIXELS_ENABLED=false
TRACKING_PROVISION_ENABLED=false
ASAAS_ENVIRONMENT=sandbox
ASAAS_SANDBOX_API_KEY=
ASAAS_SANDBOX_WEBHOOK_TOKEN=
ASAAS_PRODUCTION_API_KEY=
ASAAS_PRODUCTION_WEBHOOK_TOKEN=
EOF

compose() { docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" "$@"; }
postgres_sql() { compose exec -T "$1" psql -v ON_ERROR_STOP=1 -U "$2" -d "$2" --command "$3"; }
postgres_value() { compose exec -T "$1" psql -U "$2" -d "$2" --tuples-only --no-align --command 'SELECT value FROM certification_restore_probe' | tr -d '\r\n'; }
studio_value() { postgres_value studio-postgres studio; }

compose up --detach --wait --pull never studio-postgres >/dev/null
postgres_sql studio-postgres studio "CREATE TABLE certification_restore_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO certification_restore_probe VALUES (1, 'before-studio');" >/dev/null

sh "$root/runtime/backup.sh" --env-file "$environment" --project-name "$project" --output-dir "$backup_dir" >/dev/null
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS >/dev/null)

postgres_sql studio-postgres studio "UPDATE certification_restore_probe SET value = 'after-studio' WHERE id = 1;" >/dev/null

sh "$root/runtime/restore.sh" --env-file "$environment" --project-name "$project" --input-dir "$backup_dir" --confirm-restore >/dev/null

[ "$(studio_value)" = 'before-studio' ] || { echo 'Studio PostgreSQL não foi restaurado.' >&2; exit 1; }
# Restaurar com um writer no ar sobrescreveria o que acabou de voltar.
for writer in studio-web studio-worker; do
  [ -z "$(compose ps -q "$writer")" ] || { echo "Writer iniciado indevidamente: $writer" >&2; exit 1; }
done
printf '%s\n' 'Backup e restauração locais do banco do Studio verificados.'
