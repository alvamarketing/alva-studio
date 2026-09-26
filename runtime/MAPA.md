# Runtime Docker/Coolify

- `subir-local.sh` e `compose.local.yaml`: o runtime inteiro na máquina com um comando — gera `.env` local com segredos aleatórios e põe um proxy HTTPS (Caddy) em `https://studio.localhost:8443`, no papel que o Coolify faz em produção.
- `compose.yaml`: serviços do runtime comercial — `studio-web`, `studio-worker` (papéis webhook, tracking e billing, cobrindo fila de webhook, provisionamento e entrega de conversões, e reconsulta de cobrança) e `studio-postgres` —, com somente o `studio-web` exposto por porta, volume persistente do banco e health checks.
- `Dockerfile.studio`: imagem Node do Studio, web e workers.
- `backup.sh` e `restore.sh`: exportação e recuperação confirmada do banco `studio-postgres`.
- `backup-restore-local-test.sh`: ensaio descartável do banco, com probe, checksum, mutação e restauração sem iniciar writers.
- `RUNBOOK.md`: operação, segredos, saúde, backup e limites da homologação.
- `.env.example`: nomes de variáveis sem valores reais, incluindo as chaves e tokens Asaas separados por sandbox/produção e a raiz HMAC de runtime derivada por publicação; pixels permanecem desligados por padrão.
- `commercial-local-certification.mjs`: ordem da matriz local, flags seguras e inventário de segredos apenas por nome, localização e finalidade.
- A flag `CONVERSIONS_ENABLED` também chega ao worker de tracking, mantendo a entrega de conversões desligada até opt-in literal.
