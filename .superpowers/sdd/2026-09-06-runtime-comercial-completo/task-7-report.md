# Task 7 — runtime público de publicação (2026-09-06)

## Fatia integrada entregue

- `016_publication_runtime.sql` cria manifesto por empresa/projeto/ambiente/publicação, com snapshot, versão, origem, policy, providers, revogação e tabela de nonces consumidos.
- `PublicationRuntimeRepository` grava/consulta/revoga manifestos com escopo composto e reclama nonce uma única vez.
- `publication-runtime.mjs` valida manifesto público somente em produção, normaliza providers permitidos, assina/verifica HMAC com timestamp/nonce e rejeita replay; o segredo nunca aparece no payload.
- Loader acessível gera banner de consentimento, vincula consentimento a `publicationId + snapshotHash`, carrega Meta, GA4, TikTok, LinkedIn e Taboola somente após opt-in e marca a página para carregá-los uma única vez.

## Validação

- `node --test packages/studio/test/publication-runtime.test.mjs` — 4 pass, 0 fail.
- `node --check packages/studio/server/publication-runtime.mjs packages/studio/server/repositories/publication-runtime-repository.mjs` — passou.
- `git diff --check` — limpo.
- Teste PostgreSQL real comprova isolamento por projeto/ambiente, revogação e replay de nonce.

## Pendências reais para fechar Task 7

- Conectar `runtimeManifest` e os artefatos `/_alva/loader.js`, `/_alva/consent` e `/_alva/event` ao `PublicationSnapshotBuilder`/Publisher e às Functions da Vercel, preservando os testes existentes de manifesto/hash.
- Trocar o `ReplayStore` em memória pelo repositório PostgreSQL na fronteira HTTP e aplicar verificação de domínio/origem, versão e snapshot em cada chamada.
- Alimentar a policy publicada a partir de destinos cifrados sem expor tokens e estender a CSP de páginas; integrar o loader ao consentimento e ao outbox da Task 6 sem duplicar `tracking_event_id`.
- Criar tela Rastreamento e testes visuais desktop/mobile; homologar staging com publisher fake e depois com credencial de staging fornecida.

A entrega desta rodada é a base de dados e o núcleo criptográfico/loader testados; não declara a Task 7 completa enquanto as Functions, integração do snapshot e a tela não estiverem conectadas.

## Fix round 1 — fundação de segurança (2026-09-06)

- HMAC agora assina método, rota, publicação, ambiente, timestamp, nonce e SHA-256 UTF-8 do corpo exato, com comparação constante e nonce validado.
- `publication_id` tornou-se globalmente único; replay PostgreSQL permanece isolado por esse identificador global.
- Manifesto inclui `policyVersion`, origem/domínio canônicos e providers como objetos allowlisted com IDs públicos validados; tokens nunca entram no loader.
- A chave de consentimento inclui publicação, snapshot, policy, origem, domínio e ambiente. Loader oferece aceitar, recusar e revogar, e somente carrega providers habilitados após aceite.
- Claim de nonce limpa expirados dentro de transação antes do insert e possui índice de expiração.

## Validação da correção

- `node --test packages/studio/test/publication-runtime.test.mjs` — 4 pass, 0 fail.
- Cobertura inclui adulteração de método/rota/ambiente/corpo, expiração, concorrência PostgreSQL, unicidade entre projetos, seis dimensões de invalidação e ausência de provider não configurado.
- `node --check` dos módulos runtime/repositório e `git diff --check` — limpos.
