#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
usage() { echo "Uso: $0 --output-dir DIRETORIO [--compose-file ARQUIVO] [--env-file ARQUIVO] [--project-name NOME]" >&2; exit 64; }
output_dir=''
compose_file="$script_dir/compose.yaml"
env_file=''
project_name='alva-studio-runtime'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir) [ "$#" -ge 2 ] || usage; output_dir=$2; shift 2 ;;
    --compose-file) [ "$#" -ge 2 ] || usage; compose_file=$2; shift 2 ;;
    --env-file) [ "$#" -ge 2 ] || usage; env_file=$2; shift 2 ;;
    --project-name) [ "$#" -ge 2 ] || usage; project_name=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$output_dir" ] || usage
[ -f "$compose_file" ] || { echo "Compose não encontrado: $compose_file" >&2; exit 66; }
[ -z "$env_file" ] || [ -f "$env_file" ] || { echo "Arquivo de ambiente não encontrado: $env_file" >&2; exit 66; }
[ ! -e "$output_dir" ] || { echo "O diretório de backup já existe: $output_dir" >&2; exit 73; }
command -v docker >/dev/null 2>&1 || { echo "Docker não está instalado." >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose não está instalado." >&2; exit 69; }
compose() {
  if [ -n "$env_file" ]; then docker compose --env-file "$env_file" -p "$project_name" -f "$compose_file" "$@"
  else docker compose -p "$project_name" -f "$compose_file" "$@"; fi
}
for service in studio-postgres umami-postgres nvs-mariadb; do
  compose ps -q "$service" | grep -q . || { echo "Serviço indisponível: $service" >&2; exit 69; }
done
mkdir "$output_dir"
cleanup() { rm -rf -- "$output_dir"; }
trap cleanup EXIT HUP INT TERM
compose exec -T studio-postgres pg_dump --clean --if-exists --no-owner --no-privileges -U studio -d studio > "$output_dir/studio-postgres.sql"
compose exec -T umami-postgres pg_dump --clean --if-exists --no-owner --no-privileges -U umami -d umami > "$output_dir/umami-postgres.sql"
compose exec -T nvs-mariadb sh -ec 'exec mariadb-dump --single-transaction --routines --events -unvs -p"$MARIADB_PASSWORD" nvs' > "$output_dir/nvs-mariadb.sql"
(cd "$output_dir" && shasum -a 256 studio-postgres.sql umami-postgres.sql nvs-mariadb.sql > SHA256SUMS)
trap - EXIT HUP INT TERM
echo "Backup criado em: $output_dir"
