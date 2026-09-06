#!/bin/sh
set -eu

# Ensaio descartável: somente bancos do Compose isolado, valores fictícios e sem pull de imagens.
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
UMAMI_POSTGRES_PASSWORD=$(random_hex)
UMAMI_APP_SECRET=$(random_hex)
UMAMI_USERNAME=local-restore-service
UMAMI_PASSWORD=$(random_hex)
UMAMI_RUNTIME_ENABLED=false
NVS_RUNTIME_ENABLED=false
TRACKING_MASTER_KEY=$(random_hex)
PUBLICATION_RUNTIME_HMAC_SECRET=$(random_hex)
PIXELS_ENABLED=false
TRACKING_PROVISION_ENABLED=false
NVS_MARIADB_PASSWORD=$(random_hex)
NVS_MARIADB_ROOT_PASSWORD=$(random_hex)
NVS_INTERNAL_HMAC_SECRET=$(random_hex)
NVS_PROPERTY_SECRETS_KEY=$(random_hex)
NVS_OUTBOX_DELIVERY_ENABLED=false
ASAAS_ENVIRONMENT=sandbox
ASAAS_SANDBOX_API_KEY=
ASAAS_SANDBOX_WEBHOOK_TOKEN=
ASAAS_PRODUCTION_API_KEY=
ASAAS_PRODUCTION_WEBHOOK_TOKEN=
EOF

compose() { docker compose --env-file "$environment" --project-name "$project" --file "$root/runtime/compose.yaml" "$@"; }
postgres_sql() { compose exec -T "$1" psql -v ON_ERROR_STOP=1 -U "$2" -d "$2" --command "$3"; }
mariadb_sql() { compose exec -T nvs-mariadb sh -ec 'exec mariadb -unvs -p"$MARIADB_PASSWORD" nvs -e "$1"' sh "$1"; }
postgres_value() { compose exec -T "$1" psql -U "$2" -d "$2" --tuples-only --no-align --command 'SELECT value FROM certification_restore_probe' | tr -d '\r\n'; }
studio_value() { postgres_value studio-postgres studio; }
umami_value() { postgres_value umami-postgres umami; }
nvs_value() { mariadb_sql 'SELECT value FROM certification_restore_probe' | tail -n 1 | tr -d '\r'; }

compose up --detach --wait --pull never studio-postgres umami-postgres nvs-mariadb >/dev/null
postgres_sql studio-postgres studio "CREATE TABLE certification_restore_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO certification_restore_probe VALUES (1, 'before-studio');" >/dev/null
postgres_sql umami-postgres umami "CREATE TABLE certification_restore_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO certification_restore_probe VALUES (1, 'before-umami');" >/dev/null
mariadb_sql "CREATE TABLE certification_restore_probe (id integer PRIMARY KEY, value varchar(80) NOT NULL); INSERT INTO certification_restore_probe VALUES (1, 'before-nvs');" >/dev/null

sh "$root/runtime/backup.sh" --env-file "$environment" --project-name "$project" --output-dir "$backup_dir" >/dev/null
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS >/dev/null)

postgres_sql studio-postgres studio "UPDATE certification_restore_probe SET value = 'after-studio' WHERE id = 1;" >/dev/null
postgres_sql umami-postgres umami "UPDATE certification_restore_probe SET value = 'after-umami' WHERE id = 1;" >/dev/null
mariadb_sql "UPDATE certification_restore_probe SET value = 'after-nvs' WHERE id = 1;" >/dev/null

sh "$root/runtime/restore.sh" --env-file "$environment" --project-name "$project" --input-dir "$backup_dir" --confirm-restore >/dev/null

[ "$(studio_value)" = 'before-studio' ] || { echo 'Studio PostgreSQL não foi restaurado.' >&2; exit 1; }
[ "$(umami_value)" = 'before-umami' ] || { echo 'Umami PostgreSQL não foi restaurado.' >&2; exit 1; }
[ "$(nvs_value)" = 'before-nvs' ] || { echo 'NVS MariaDB não foi restaurado.' >&2; exit 1; }
for writer in studio-web studio-worker studio-media-worker studio-billing-worker studio-tracking-worker umami nvs nvs-outbox-worker; do
  [ -z "$(compose ps -q "$writer")" ] || { echo "Writer iniciado indevidamente: $writer" >&2; exit 1; }
done
printf '%s\n' 'Backup e restauração locais dos três bancos verificados.'
