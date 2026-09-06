---
no: tracking_pixels
status: feito
---

# Tracking pixels — certificação local (2026-09-06)

Prova: pixel só após consentimento, CSP com nonce e allowlist por projeto, 477 testes verdes

## Evidências

- A matriz DOM parametrizada comprova que Meta, GA4, TikTok, LinkedIn e Taboola
  preparam seus bootstraps e carregam uma única vez somente em `granted`.
  `pending` e `denied` não anexam SDK nem emitem pixel browser.
- A policy server-side escopa consentimento por projeto, domínio, ambiente,
  snapshot, publicação e `policyVersion`; mudança de escopo invalida a decisão
  anterior. Preview não aceita consentimento.
- A CSP separa `script-src` e `connect-src` por provider, usa nonce para o
  bootstrap e mantém a allowlist fechada; o Compose mantém `PIXELS_ENABLED`
  desligado por padrão.
- A validação foi local/fake com request capture, sem egress e sem credenciais
  reais. Não houve publicação real de staging, DNS ou revisão visual.

## Validação

- Suíte Node do Studio: **477 pass, 0 fail**.
- `php runtime/nvs/tests/consent-policy.php`: aprovado.
- Integração Docker descartável do runtime NVS/MariaDB: aprovada após recriação
  dos volumes descartáveis.

O nó é considerado feito para o escopo local/fake da Etapa 7. Homologação
externa e revisão visual permanecem pendentes para a etapa apropriada.
