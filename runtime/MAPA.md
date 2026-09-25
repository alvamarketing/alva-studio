# Runtime Docker/Coolify

- `subir-local.sh` e `compose.local.yaml`: o runtime inteiro na máquina com um comando — gera `.env` local com segredos aleatórios e põe um proxy HTTPS (Caddy) em `https://studio.localhost:8443`, no papel que o Coolify faz em produção.
- `compose.yaml`: serviços do runtime comercial, incluindo workers de webhook, cobrança, provisionamento de tracking e outbox NVS, isolamento por portas, volumes persistentes e health checks.
- `Dockerfile.studio`: imagem Node do Studio, web e workers.
- `Dockerfile.nvs`: imagem PHP do NVS Core vendorado e da extensão interna Alva.
- `nvs/`: snapshot imutável do NVS Core, extensão Alva, migrações forward-only, endpoints internos e testes reais de integração PHP/MariaDB.
- `backup.sh` e `restore.sh`: exportação e recuperação confirmada dos três bancos.
- `backup-restore-local-test.sh`: ensaio descartável dos três bancos, com probes, checksums, mutação e restauração sem iniciar writers.
- `RUNBOOK.md`: operação, segredos, saúde, backup e limites da homologação.
- `.env.example`: nomes de variáveis sem valores reais, incluindo as chaves e tokens Asaas separados por sandbox/produção e a raiz HMAC de runtime derivada por publicação; pixels permanecem desligados por padrão.
- `commercial-local-certification.mjs`: ordem da matriz local, flags seguras e inventário de segredos apenas por nome, localização e finalidade.
- A flag `NVS_RUNTIME_ENABLED` também chega ao worker de tracking, mantendo a outbox comercial desligada até opt-in literal.
