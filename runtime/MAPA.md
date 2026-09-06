# Runtime Docker/Coolify

- `compose.yaml`: nove serviços do runtime comercial, incluindo o worker contínuo da outbox NVS, isolamento por portas, volumes persistentes e health checks.
- `Dockerfile.studio`: imagem Node do Studio, web e workers.
- `Dockerfile.nvs`: imagem PHP do NVS Core vendorado e da extensão interna Alva.
- `nvs/`: snapshot imutável do NVS Core, extensão Alva, migrações forward-only, endpoints internos e testes reais de integração PHP/MariaDB.
- `backup.sh` e `restore.sh`: exportação e recuperação confirmada dos três bancos.
- `RUNBOOK.md`: operação, segredos, saúde, backup e limites da homologação.
- `.env.example`: nomes de variáveis sem valores reais.
