---
no: tracking_conversoes
status: feito
---

# Tracking de conversões — certificação local (2026-09-06)

Prova: cinco adaptadores parametrizados em pending denied granted, uma chamada por estado, tracking_event_id preservado, payload sem PII ou hash em pending/denied, egress ausente somente com flag técnica ou provider desligado, 477 testes verdes

## Evidências

- A matriz parametrizada cobre Meta, Google, TikTok, LinkedIn e Taboola em
  `pending`, `denied` e `granted`, com uma chamada por estado e o mesmo
  `tracking_event_id` preservado.
- Eventos são persistidos no Studio, encaminhados ao NVS e só então enviados
  aos adaptadores habilitados. `pending` e `denied` ficam limitados à allowlist
  de evento, tempo, conteúdo, valor/moeda e IDs pseudônimos de atribuição;
  PII, IP, user-agent e hashes são recusados. Hashes só são normalizados no
  servidor em `granted`.
- LinkedIn e Taboola aceitam somente os aliases e nomes canônicos allowlisted;
  campos desconhecidos e objetos aninhados são recusados. Google recebe os
  quatro sinais de consentimento previstos.
- A validação usou adaptadores injetados, request capture e integração Docker
  descartável, sem egress e sem credenciais reais. O serviço NVS local não foi
  tratado como homologação externa; uma execução sem o serviço disponível
  retornou conexão recusada.

## Validação

- Suíte Node do Studio: **477 pass, 0 fail**.
- `php runtime/nvs/tests/consent-policy.php`: aprovado, incluindo aliases,
  canônicos e recusas.
- Integração Docker descartável do runtime NVS/MariaDB: aprovada com evento
  novo após recriação dos volumes descartáveis.

O nó é considerado feito para o escopo local/fake da Etapa 7. Egress real,
credenciais, staging externo e homologação do Asaas pertencem a etapas próprias.
