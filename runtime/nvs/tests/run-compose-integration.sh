#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
project_name=${1:-alva-nvs-task3-test}
env_file=${2:?informe um arquivo de ambiente descartável para o Compose isolado}

cleanup() {
  docker compose --env-file "$env_file" --project-name "$project_name" -f "$root_dir/runtime/compose.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose --env-file "$env_file" --project-name "$project_name" -f "$root_dir/runtime/compose.yaml" up -d --build --wait
docker compose --env-file "$env_file" --project-name "$project_name" -f "$root_dir/runtime/compose.yaml" exec -T nvs php /app/tests/integration.php
