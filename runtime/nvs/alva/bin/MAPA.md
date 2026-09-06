# Comandos da extensão NVS

- `migrate.php`: aplica o schema do Core e as migrações Alva forward-only.
- `dispatch-outbox.php`: processa uma entrega pendente de forma idempotente.
- `outbox-worker.php`: mantém o processamento contínuo da outbox no serviço isolado.
