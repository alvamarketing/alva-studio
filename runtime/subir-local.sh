#!/usr/bin/env bash
# Sobe o Alva Studio inteiro na máquina com um comando: Studio, workers, os três
# bancos, Umami, NVS e o proxy HTTPS local. Na primeira vez gera runtime/.env com
# segredos aleatórios — o arquivo fica fora do git e é reaproveitado nas próximas.
#
# Uso: runtime/subir-local.sh           sobe (ou atualiza) tudo
#      runtime/subir-local.sh --parar   derruba os serviços, preservando os dados
set -euo pipefail

pasta="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose --project-name alva-studio -f "$pasta/compose.yaml" -f "$pasta/compose.local.yaml")

if [[ "${1:-}" == "--parar" ]]; then
  "${compose[@]}" down
  exit 0
fi

if [[ ! -f "$pasta/.env" ]]; then
  hex() { openssl rand -hex 32; }
  senha_studio="$(hex)"
  umask 077
  cat > "$pasta/.env" <<ENV
# Gerado por subir-local.sh para uso local. Não versionar.
STUDIO_POSTGRES_PASSWORD=$senha_studio
STUDIO_DATABASE_URL=postgres://studio:$senha_studio@studio-postgres:5432/studio
PUBLIC_ORIGIN=https://studio.localhost:8443
UMAMI_POSTGRES_PASSWORD=$(hex)
UMAMI_APP_SECRET=$(hex)
UMAMI_USERNAME=alva-motor
UMAMI_PASSWORD=$(hex)
UMAMI_RUNTIME_ENABLED=false
NVS_RUNTIME_ENABLED=false
TRACKING_MASTER_KEY=$(hex)
VERCEL_MASTER_KEY=$(hex)
PUBLICATION_RUNTIME_HMAC_SECRET=$(hex)
PIXELS_ENABLED=false
TRACKING_PROVISION_ENABLED=false
NVS_MARIADB_PASSWORD=$(hex)
NVS_MARIADB_ROOT_PASSWORD=$(hex)
NVS_INTERNAL_HMAC_SECRET=$(hex)
NVS_PROPERTY_SECRETS_KEY=$(hex)
NVS_OUTBOX_DELIVERY_ENABLED=false
ASAAS_ENVIRONMENT=sandbox
ENV
  echo "runtime/.env criado com segredos novos."
fi

"${compose[@]}" up -d --build --wait
echo
echo "Pronto: https://studio.localhost:8443"
