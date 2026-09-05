---
no: worker_webhook
status: feito
---
`vibe conferir worker_webhook` não consegue avaliar automaticamente porque o
`passa_quando.tipo: "homologação"` não é reconhecido pela versão atual do
vibe (mesma limitação já presente em `leads_integracoes` e
`tracking_analytics`). Verifiquei manualmente, com teste automatizado, cada
cláusula do `espera` declarado no grafo:

- "revalida o destino em cada tentativa": `attemptOnce` chama
  `resolveAndValidateDestination` (DNS + bloqueio de rede privada) a cada
  tentativa, nunca reaproveita uma checagem antiga —
  `test/webhook-worker.test.mjs` ("revalida o DNS a cada tentativa...").
- "não acessa rede privada": além das checagens de IPv4/IPv6 privados já
  existentes, fechei a janela de DNS rebinding entre a checagem e o envio
  (`pinnedFetch`, `node:http`/`node:https` com `Agent.lookup` fixado no
  endereço já validado) — `test/outbound-webhook.test.mjs` e
  `test/webhook-worker.test.mjs` ("destino resolve para rede privada...").
- "não duplica entregas confirmadas": fila e claim usam
  `FOR UPDATE SKIP LOCKED` com lease, e nenhuma atualização consegue
  reabrir uma entrega já `delivered` — `test/webhook-repository.test.mjs`.

Ressalvas:
- O worker roda em polling (`setInterval`, padrão 5s), não em push; para
  volume alto isso é suficiente, mas não é entrega instantânea.
- Backoff fixo (30s a 12h, 6 tentativas) embutido no código, não
  configurável por projeto.
- A auditoria por tentativa (`webhook_delivery_attempts`) existe no banco,
  mas não há tela/endpoint para consultá-la ainda — é dado, não é
  observabilidade de produto.
- `form_submissions.tracking_status` ficou órfão (não é mais escrito);
  mantive a coluna para não editar uma migração aplicada, mas ela não é
  mais a fonte de verdade — `webhook_deliveries.status` é.
- Suíte completa rodada localmente: 290/290 (`node --test test/*.test.mjs`).
