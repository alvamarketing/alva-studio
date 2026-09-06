# Task 5 — corte de Analytics para Umami

## Estado atual

Implementação em progresso, sem certificação e sem commit. O gateway começou a
substituir o token público opaco pela referência Umami decriptada somente na
rede interna. A flag continua desligada por padrão.

## Evidência confirmada

- A imagem pinada `Umami 3.3.1` foi iniciada em composição Docker descartável.
- O script oficial usa `data-website-id` e `data-host-url` e envia o envelope
  `{ type: "event", payload }` para `/api/send`.
- O teste focado `umami-gateway.test.mjs` cobre troca de token, PII e eventos
  fora da allowlist; estava verde na última execução focada.
- `encrypted_remote_reference` é decriptada com o AAD do binding; o browser não
  recebe ID remoto, token, painel ou credencial.

## Fronteira pendente

Esta Task ainda não está pronta: falta vincular token a publication/snapshot,
separar inequivocamente preview e produção nos snapshots, adaptar summary,
journey e events para agregados reais do Umami, compor a janela histórica de
90 dias, provar idempotência e executar a homologação E2E + suíte completa.
Nenhuma UI foi alterada: o painel existente não passou por nova verificação
visual porque o contrato de leitura ainda não foi concluído.
