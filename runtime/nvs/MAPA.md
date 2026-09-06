# Runtime NVS

- `vendor/nvs-core/`: snapshot versionado e imutável do NVS Track Core; `VENDOR.md` declara a origem, versão, contrato, exclusões e hash reproduzível.
- `alva/`: extensão interna que autentica APIs, migra o schema e entrega eventos por outbox sem alterar o vendor.
  - `destinations/`: adaptadores dos destinos de conversão, com contrato comum e payloads sem PII, IP ou user-agent em claro.
- `public/`: gateway HTTP do runtime, endpoints de saúde e encaminhamento explícito para as superfícies públicas do Core.
- `tests/`: prova de integração PHP/MariaDB com duas propriedades, autenticação, cifra, deduplicação e retry.
- `healthcheck.php`: valida a resposta JSON de prontidão exposta pelo Core e pela extensão Alva.
