# SDD ledger — plan: docs/superpowers/plans/2026-09-06-runtime-comercial-completo.md

| Escopo | Interface/arquivo compartilhado | Verificação | Resultado |
| --- | --- | --- | --- |
| Task 1 → Task 2 | flags em `runtime-flags.mjs`; runtime só deve iniciar motores por configuração explícita | O Compose define as flags seguras desligadas e não anuncia provisionamento | Compatível: Task 2 cria infraestrutura, não integra motores. |
| Task 2 → Tasks 3–8 | serviços internos `umami` e `nvs`, bancos isolados e endpoints de saúde | NVS é base PHP honesta; Umami é 3.3.1 oficial; sem APIs de provisionamento/eventos | Compatível: contratos reais ficam para as próximas tasks. |
| Task 2 → Tasks 4–11 | PostgreSQL do Studio, migrations e backup/restore | Boot aplica migrations; runbook descreve backup e teste sem credenciais reais | Compatível: mudanças futuras são forward-only. |

Ruling: o Compose de desenvolvimento deve publicar somente `studio-web` em `127.0.0.1`; bancos e painéis permanecem na rede interna — a especificação exige painéis e dados privados, e Coolify faz o roteamento externo quando homologado — custo se errado: um operador local precisará usar `docker exec` para inspeção dos motores.

Ruling: a validação da composição será estática e por `docker build`/execuções isoladas, pois o daemon está disponível mas nenhum binário Docker Compose está instalado; nenhum container ativo será alterado — custo se errado: dependências de orquestração só serão verificadas quando Compose estiver disponível.

Task 2: fix round 1/5 (3 addressed, 0 open — referências de imagem agora têm tag e digest; relatório não declara gate completo; restore faz preflight e runbook recupera falha parcial; commits 3e6cb6f..3e6cb6f)
Task 2: partial (revisão de qualidade aprovada; aceite de Compose, persistência após restart e restore dos três bancos bloqueado pela ausência objetiva de `docker compose` neste host)

## Task 2
- Initial implementation: 404/404 tests, isolated image builds; Compose gate initially blocked by a broken plugin link.
- Controller installed official Docker Compose 5.5.1 and restored the CLI plugin link.
- Review round 1: P0 external host startup; P1 egress/Coolify network, MariaDB scope, restore ergonomics; P2 false readiness, fake webhook worker, amd64 digests. Fixed.
- Review round 2: P1 PUBLIC_ORIGIN unsafe fallback and Umami/NVS writers left active during restore. Fixed.
- Review round 3: P2 restore trap state around partial stop/start. Fixed.
- Independent Terra reviewer: approved.
- Real isolated stack `alva-runtime-task2`: eight services healthy; health endpoints verified; all three database probes persisted across restart; backup/mutate/restore returned all probes to `before`; temporary resources removed.
- Validation: focused 20/20 then runtime 6/6; full suite 406/406; Compose config/builds/shell/PHP/diff checks clean.
- Task 2: complete

## Task 3
- Initial implementation preserved the NVS Core 0.3.10 snapshot and added the Alva HMAC API, property-scoped secrets and destination outbox outside the vendor tree.
- Review round 1: blocked the raw vendor ingest and client, cross-tenant event lookup, partial migrations marked ready, missing worker, unbound AES-GCM, Taboola SSRF, broad vendor ignore exceptions, hard-coded delivery flag, incomplete delivery tests and mutable provenance.
- Fix round 1: public collection now uses an allowlisted Alva wrapper and rejects commercial conversions; migrations are checksummed/fail-closed; secrets use property/destination AAD; outbox has a continuous worker; Taboola uses a fixed host; vendor exceptions are narrow; source SHA and snapshot hash are recorded.
- Isolated PHP/MariaDB integration passed HMAC/replay, two-property isolation, ciphertext binding, deduplication, delivery-off stability, local delivery for Google/LinkedIn/Taboola, retry, SSRF prevention and safe public collection.
- Validation after fixes: full Studio suite 406/406; PHP lint, Compose config and `git diff --check` clean; isolated Docker resources removed.
- Independent re-review round 2: gateway, isolation, HMAC, AAD, worker, SSRF boundary, vendor hash and real container test approved; destination contracts blocked by obsolete/invalid Google, LinkedIn and Taboola payloads, and the manifest exclusion list still diverges from the snapshot recipe.
- Fix round 2: Google moved to Data Manager `events:ingest`; LinkedIn uses the current typed CAPI contract; Taboola uses the fixed S2S postback with an allowlisted click ID; request-capture assertions now cover all five destinations.
- Independent review round 3: approved with no P0/P1/P2; reviewer repeated the isolated NVS + MariaDB + worker integration successfully.
- Provenance: source commit `dd8a6fdf5f3d65d26d381f5a002d2ed8ac13b7f7`; exported snapshot recipe hash `911681d021c5c0b9126abeb3eea64decae8b4603eabb80801787f914c5669308`.
- Task 3: complete.

## Task 4
- Migration 013 creates project/environment/engine bindings, destination secrets and a provision queue with lease, retry, bounded backoff and dead-letter state; the legacy analytics tables remain separate.
- Project creation transactionally enqueues distinct preview and production identities for Umami and NVS.
- Studio APIs require `integration.manage`; public DTOs exclude remote references and credentials; ciphertext is bound to company/project/environment/engine or provider with AES-GCM AAD and a dedicated tracking key.
- A separate tracking worker provisions the pinned Umami 3.3.1 and Task 3 NVS APIs idempotently. Runtime flags and the worker default off and can be enabled explicitly.
- New preview/production publications require the bindings for exactly the enabled engines; existing snapshots remain readable while a binding is pending or degraded.
- Umami technical account bootstrap uses role `user`, removes only the known default seed, keeps secrets out of argv/logs and proves the pinned UUID create/reconcile behavior in disposable containers.
- Review rounds fixed disconnected runtime wiring, absent publication gate, unscoped secrets, incomplete provider validation, unsafe rollout defaults, partial-engine gating and bootstrap argv exposure.
- Validation: focused tests 19/19; full Studio suite exited successfully; real disposable Umami and NVS contracts passed; `git diff --check`, syntax and secret scans clean; independent final review approved with no findings.
- Task 4: complete.

## Task 5
- Fix round 1: 4/5 achados addressed; integridade UTM permaneceu aberta para revisão.
- Fix round 2: integridade UTM addressed com rankings independentes e sem tuplas fabricadas.
- Evidências finais: suíte Studio 425/425; E2E Umami 3.3.1; checks de sintaxe e diff, scan de segredos e cleanup de recursos temporários concluídos.
- Review final: Spec ✅; Quality Approved.
- Task 5: complete.

## Task 6
- A submissão confirmada enfileira `lead` na mesma transação e preserva o `tracking_event_id` opaco em retries; eventos VSL reutilizam um UUID persistente criado no navegador e validado pelo gateway.
- Contato é normalizado e convertido em SHA-256 somente no servidor. A outbox, Analytics, logs e painel não recebem respostas, IP, user-agent, propriedades remotas ou IDs de tracking.
- A outbox deduplica por propriedade, evento e destino, possui lease, retry, backoff e estado final; o painel Conversões expõe apenas evento, ambiente, estado, tentativa e erro sanitizado.
- Review round 1: corrigiu a ambiguidade de origem repetida e exigiu produtores financeiros reais ou uma fronteira explícita com a Task 9.
- Fix rounds 1–2: a origem passou a ser deduplicada no mesmo ambiente; produtores internos transacionais de `initiate_checkout` e `purchase` validam UUID, transação, valor e moeda, sem criar rota pública ou simular Asaas.
- Ruling: a Task 6 cria somente os produtores internos de `initiate_checkout` e `purchase`; a Task 9 deve ligá-los aos estados reais de checkout e webhook do Asaas. Nenhum evento financeiro público ou de produção é emitido antes dessa ligação — custo se errado: a Task 9 pode exigir ajuste no contrato dos produtores.
- Validação: integração descartável NVS 0.3.10 + MariaDB aprovada; suíte Studio 433/433; sintaxe, diff, arquivos sensíveis e cleanup limpos; prévia visual fictícia em 919×863 aprovada; revisão final Spec ✅ e Quality Approved.
- Task 6: complete.

## Ruling V1/V2 — 2026-09-06

A V1 prioriza páginas, quizzes, analytics, tracking, cobrança e agentes na ordem Tasks 6 → 7 → 9 → 10 → 11. Player próprio, upload, R2, FFmpeg e HLS foram movidos para V2 porque acrescentam custo operacional e são reversíveis sem bloquear a publicação atual; referências e eventos VSL já existentes permanecem preservados. O corte reduz o risco de interromper a entrega comercial enquanto a mídia própria é validada separadamente.

- Fix P1 VSL V2 (2026-09-06): runtime de mídia desligado agora remove navegação, filtros, métricas, contagens, itens e consultas VSL do painel; APIs autenticadas e rotas públicas não acessam nem servem vídeos. Testes focados 39/39.
- Compatibilidade de fixtures VSL (2026-09-06): testes legados agora optam explicitamente por `mediaPipeline=true`; default-off de produção preservado. Suíte ampliada 65/65.
- Fixtures legados adicionais VSL (2026-09-06): analytics HTTP passou a ativar mídia explicitamente; `pnpm test:studio` completo verde, 440/440.
- P1 DTO/editor VSL (2026-09-06): overview sanitizado no servidor e catálogos VSL condicionados ao runtime, preservando referências legadas. `pnpm test:studio` verde, 441/441.
- Ocultação de referências VSL legadas no editor (2026-09-06): referências preservadas no modelo/HTML e bloqueadas de mutação com mídia desligada; catálogo e edição restaurados com mídia ligada. Suíte completa 441/441.
