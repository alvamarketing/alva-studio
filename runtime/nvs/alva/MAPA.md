# Extensão interna Alva para NVS

- `bootstrap.php`: autenticação HMAC, cifra, migrações, isolamento por propriedade, outbox e API interna.
- `bin/`: comandos de inicialização do schema e processamento da outbox.
- `migrations/`: migrações versionadas e checksummed do schema Alva.
- `destinations/`: implementações do contrato de entrega de conversões por plataforma.
