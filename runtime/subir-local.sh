#!/usr/bin/env bash
# Sobe o Alva Studio na máquina com um comando: Studio, worker e Postgres. O
# endereço é https://alva.orb.local — domínio e certificado vêm do OrbStack, em que
# o Mac já confia, então não há proxy no meio nem aviso de certificado. Na primeira vez gera runtime/.env com segredos aleatórios — o arquivo
# fica fora do git e é reaproveitado nas próximas.
#
# Umami e NVS não sobem por padrão. Eles não são o Studio, e montar uma página não
# depende deles: peça com --analytics e --tracking quando o trabalho for esse.
#
# Uso: runtime/subir-local.sh              sobe (ou atualiza) em https://studio.localhost:8443
#      runtime/subir-local.sh --analytics  idem, com o Umami junto
#      runtime/subir-local.sh --tracking   idem, com o NVS junto
#      runtime/subir-local.sh --tunel      idem, e abre um endereço público de teste
#                                          (túnel da Cloudflare) que vira o PUBLIC_ORIGIN
#      runtime/subir-local.sh --parar      derruba os serviços, preservando os dados
set -euo pipefail

pasta="$(cd "$(dirname "$0")" && pwd)"
perfis=()
for argumento in "$@"; do
  [[ "$argumento" == "--analytics" ]] && perfis+=(--profile analytics)
  [[ "$argumento" == "--tracking" ]] && perfis+=(--profile tracking)
done
base=(docker compose --project-name alva-studio ${perfis[@]+"${perfis[@]}"} -f "$pasta/compose.yaml" -f "$pasta/compose.local.yaml")
# parar precisa enxergar todo perfil, senão Umami e NVS ficam de pé sem ninguém notar
todos=(docker compose --project-name alva-studio --profile analytics --profile tracking -f "$pasta/compose.yaml" -f "$pasta/compose.local.yaml" -f "$pasta/compose.tunel.yaml")
com_tunel=("${base[@]}" -f "$pasta/compose.tunel.yaml")
origem_local="https://alva.orb.local"

if [[ "${1:-}" == "--parar" ]]; then
  "${todos[@]}" down --remove-orphans
  exit 0
fi

# O Studio só aceita pedidos vindos da sua própria origem, e o cookie de sessão
# depende dela: trocar de endereço exige gravar a origem nova e recriar o Studio.
gravar_origem() {
  if grep -q '^PUBLIC_ORIGIN=' "$pasta/.env"; then
    sed -i '' "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=$1#" "$pasta/.env"
  else
    echo "PUBLIC_ORIGIN=$1" >> "$pasta/.env"
  fi
}

if [[ ! -f "$pasta/.env" ]]; then
  hex() { openssl rand -hex 32; }
  senha_studio="$(hex)"
  umask 077
  cat > "$pasta/.env" <<ENV
# Gerado por subir-local.sh para uso local. Não versionar.
STUDIO_POSTGRES_PASSWORD=$senha_studio
STUDIO_DATABASE_URL=postgres://studio:$senha_studio@studio-postgres:5432/studio
PUBLIC_ORIGIN=$origem_local
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

if [[ " $* " != *" --tunel "* ]]; then
  gravar_origem "$origem_local"
  "${base[@]}" up -d --build --wait --remove-orphans
  echo
  echo "Pronto: $origem_local"
  exit 0
fi

"${com_tunel[@]}" up -d --build --wait
echo "Esperando o endereço do túnel…"
endereco=""
for _ in $(seq 1 60); do
  endereco="$("${com_tunel[@]}" logs tunel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  [[ -n "$endereco" ]] && break
  sleep 1
done
if [[ -z "$endereco" ]]; then
  echo "O túnel não entregou um endereço em 60 segundos. Veja: docker logs alva-studio-tunel-1" >&2
  exit 1
fi
gravar_origem "$endereco"
"${com_tunel[@]}" up -d --wait
echo
echo "Pronto: $endereco"
echo "Enquanto o túnel estiver de pé, use só esse endereço — o studio.localhost deixa de autenticar."
