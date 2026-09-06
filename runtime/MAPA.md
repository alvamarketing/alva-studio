# Runtime Docker/Coolify

- `compose.yaml`: dez serviços do runtime comercial, incluindo workers de webhook, provisionamento de tracking e outbox NVS, isolamento por portas, volumes persistentes e health checks.
- `Dockerfile.studio`: imagem Node do Studio, web e workers.
- `Dockerfile.umami` e `umami-bootstrap.mjs`: imagem Umami pinada e bootstrap idempotente da credencial técnica antes do servidor aceitar conexões.
- `Dockerfile.nvs`: imagem PHP do NVS Core vendorado e da extensão interna Alva.
- `nvs/`: snapshot imutável do NVS Core, extensão Alva, migrações forward-only, endpoints internos e testes reais de integração PHP/MariaDB.
- `backup.sh` e `restore.sh`: exportação e recuperação confirmada dos três bancos.
- `RUNBOOK.md`: operação, segredos, saúde, backup e limites da homologação.
- `.env.example`: nomes de variáveis sem valores reais, incluindo a raiz HMAC de runtime derivada por publicação; pixels permanecem desligados por padrão.
- `umami-contract-test.sh`: teste Docker reproduzível do bootstrap e do contrato de ID estável do Umami 3.3.1.
- `umami-e2e-test.sh`: homologação Docker descartável do gateway Umami, cutover por ambiente e ausência de escrita legada.
- A flag `NVS_RUNTIME_ENABLED` também chega ao worker de tracking, mantendo a outbox comercial desligada até opt-in literal.
