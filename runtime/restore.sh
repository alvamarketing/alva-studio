#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
usage() { echo "Uso: $0 --input-dir DIRETORIO --confirm-restore [--compose-file ARQUIVO] [--env-file ARQUIVO] [--project-name NOME]" >&2; exit 64; }
input_dir=''
compose_file="$script_dir/compose.yaml"
env_file=''
project_name='alva-studio-runtime'
confirmed=false
writers_stopped=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --input-dir) [ "$#" -ge 2 ] || usage; input_dir=$2; shift 2 ;;
    --compose-file) [ "$#" -ge 2 ] || usage; compose_file=$2; shift 2 ;;
    --env-file) [ "$#" -ge 2 ] || usage; env_file=$2; shift 2 ;;
    --project-name) [ "$#" -ge 2 ] || usage; project_name=$2; shift 2 ;;
    --confirm-restore) confirmed=true; shift ;;
    *) usage ;;
  esac
done
[ -n "$input_dir" ] && [ "$confirmed" = true ] || usage
[ -d "$input_dir" ] || { echo "Diretório de backup não encontrado: $input_dir" >&2; exit 66; }
[ -f "$compose_file" ] || { echo "Compose não encontrado: $compose_file" >&2; exit 66; }
[ -z "$env_file" ] || [ -f "$env_file" ] || { echo "Arquivo de ambiente não encontrado: $env_file" >&2; exit 66; }
for file in studio-postgres.sql umami-postgres.sql nvs-mariadb.sql SHA256SUMS; do
  [ -f "$input_dir/$file" ] || { echo "Arquivo obrigatório ausente: $file" >&2; exit 65; }
done
command -v docker >/dev/null 2>&1 || { echo "Docker não está instalado." >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose não está instalado." >&2; exit 69; }
compose() {
  if [ -n "$env_file" ]; then docker compose --env-file "$env_file" -p "$project_name" -f "$compose_file" "$@"
  else docker compose -p "$project_name" -f "$compose_file" "$@"; fi
}
restart_writers() {
  if [ "$writers_stopped" = true ]; then
    compose start studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker || true
  fi
}
trap restart_writers EXIT HUP INT TERM
(cd "$input_dir" && shasum -a 256 -c SHA256SUMS)
for service in studio-postgres umami-postgres nvs-mariadb; do
  compose ps -q "$service" | grep -q . || { echo "Serviço indisponível: $service" >&2; exit 69; }
done
compose exec -T studio-postgres pg_isready -U studio -d studio
compose exec -T umami-postgres pg_isready -U umami -d umami
compose exec -T nvs-mariadb sh -ec 'exec mariadb-admin ping -h 127.0.0.1 -unvs -p"$MARIADB_PASSWORD" --silent'
writers_stopped=true
compose stop studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker
compose exec -T studio-postgres psql -v ON_ERROR_STOP=1 -U studio -d studio < "$input_dir/studio-postgres.sql"
compose exec -T umami-postgres psql -v ON_ERROR_STOP=1 -U umami -d umami < "$input_dir/umami-postgres.sql"
compose exec -T nvs-mariadb sh -ec 'exec mariadb -unvs -p"$MARIADB_PASSWORD" nvs' < "$input_dir/nvs-mariadb.sql"
compose start studio-web studio-worker studio-media-worker studio-tracking-worker umami nvs nvs-outbox-worker
writers_stopped=false
trap - EXIT HUP INT TERM
echo "Restauração concluída a partir de: $input_dir"
