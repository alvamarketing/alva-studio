---
no: cobranca_empresa
status: pendente
---

# Cobrança empresarial Asaas V1 — implementação local aprovada

Implementação local aprovada em revisão independente e pendente de homologação
no Asaas Sandbox. A migração 017
cria plano por ambiente, pedido com referência externa persistida antes do
egress, assinatura, entitlement, inbox idempotente e fila de revisão. O
checkout recorrente é hospedado e só recebe URL validada do host Asaas do
ambiente.

O webhook público em `/api/billing/webhook/asaas` aceita até 64 KB, exige
token de pelo menos 32 caracteres em comparação de tempo constante e deduplica
por ambiente/provedor/ID do evento; hash é somente auditoria. O worker separado
reconsulta pagamento e assinatura, vincula o customer da primeira confirmação
e só concede entitlement depois de validar ID, referência, valor, moeda BRL,
ambiente, cliente e assinatura. Falhas transitórias/órfãs usam retry com
backoff e limite; divergências, reembolsos e chargebacks seguem para
`billing_review_events`. Cancelamentos ficam em `cancel_at_period_end`,
preservando o período já pago.

A classificação de revisão cobre os estados Asaas `REFUNDED`,
`PARTIALLY_REFUNDED`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`,
`CHARGEBACK_REQUESTED`, `CHARGEBACK_DISPUTE` e
`AWAITING_CHARGEBACK_REVERSAL`, sem processar automaticamente o entitlement.

Gates de projeto, membros com convites pendentes e reserva de domínio usam lock
transacional e os limites 5/10/5. A publicação em produção consulta
entitlement somente com `BILLING_ENFORCEMENT=true`; a flag nasce desligada.

Evidência automatizada local atual: **61 testes focados verdes** para contrato,
PostgreSQL, HTTP, webhook, worker, flags e cartão da Empresa; a suíte completa
passou com **507/507**. A revisão independente aprovou o código e o contrato de
segurança. A homologação real do Asaas Sandbox e a inspeção visual independente
permanecem pendentes. Nenhum segredo ou egress real foi usado.
