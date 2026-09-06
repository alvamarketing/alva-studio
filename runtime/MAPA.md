# Runtime Docker/Coolify

- `compose.yaml`: oito serviços do runtime comercial, isolamento por portas, volumes persistentes e health checks.
- `Dockerfile.studio`: imagem Node do Studio, web e workers.
- `Dockerfile.nvs`: base PHP interna para a futura incorporação do NVS Core.
- `nvs/`: documento PHP mínimo de saúde com prontidão MariaDB, sem APIs comerciais antes da incorporação do Core.
- `backup.sh` e `restore.sh`: exportação e recuperação confirmada dos três bancos.
- `RUNBOOK.md`: operação, segredos, saúde, backup e limites da homologação.
- `.env.example`: nomes de variáveis sem valores reais.
