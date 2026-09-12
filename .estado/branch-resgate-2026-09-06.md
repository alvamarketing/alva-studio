# Branch de resgate: avaliada, superada, pode ser arquivada

A branch `codex/alva-studio-resgate-2026-09-06` (`f85866c`, 10/09) carregava três
frentes que a main não tinha por nome de arquivo. Avaliadas uma a uma em 12/09, as
três já existem na main — reescritas com outro desenho, mais completo. **Não há o que
integrar.**

Este registro existe porque a conclusão não é óbvia: a busca por arquivo diz que falta
tudo, e a busca por funcionalidade diz que não falta nada. Sem isso escrito, alguém
refaz esta análise daqui a três meses e, pior, pode tentar a integração.

## Cobrança pela Asaas — superada

A branch traz `asaas-billing.mjs` e a migração `billing_company`, com as tabelas
`plans`, `billing_activation` e `billing_webhook_inbox`.

A main traz a migração `017_asaas_billing` e cinco módulos — `asaas-client`,
`billing-service`, `billing-policy`, `billing-webhook`, `billing-worker` — com
`billing_plans`, `billing_events` e `billing_review_events`. São sete arquivos de
teste contra dois. A `BillingService` já é construída no `index.mjs`: o que falta para
o checkout funcionar não é código, são as chaves `ASAAS_SANDBOX_API_KEY` e
`ASAAS_PRODUCTION_API_KEY` no ambiente.

## Pixels e políticas de tracking — superada

A branch traz `pixel-registry`, `pixel-repository` e a migração `tracking_pixels`, com
`project_tracking_policies`, `analytics_consents` e `tracking_proxy_secrets`.

A main resolve o mesmo problema com `publication_runtime_consents`,
`publication_runtime_manifests`, `publication_runtime_replays`, `tracking_bindings`,
`tracking_destinations` e `tracking_provision_jobs`, mais o gateway de consentimento
assinado por HMAC. Quinze arquivos de teste contra dois.

## Provedores de vídeo — superada em parte, contrária ao resto

A branch traz `media-source.mjs` e adaptadores de player para YouTube e Vimeo, com
colunas `provider_video_id` e `provider_config` na tabela `videos`.

A validação de URL do `media-source` já vive no `video-repository.mjs` da main — é a
mesma regra de HTTPS sem credenciais. O que sobra são os adaptadores de YouTube e
Vimeo, e esses vão contra a direção do produto: a VSL se hospeda na Cloudflare Stream
justamente para não depender de terceiros pagos.

## O que fazer com a branch

Nada precisa dela para o Studio funcionar. Se for apagada, este documento é o que
resta — e é o suficiente, porque o que ela tinha a main já tem melhor. Se for
mantida, que seja como arquivo histórico, não como pendência.
