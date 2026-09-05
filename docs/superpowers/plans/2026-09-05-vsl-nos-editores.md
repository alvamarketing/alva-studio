# VSL nos editores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reutilizar uma VSL publicada como bloco visual nas landing pages e nas microlanding pages dos formulários dinâmicos, com prévia consistente e publicação protegida contra referências quebradas.

**Architecture:** Os dois editores armazenam apenas `{ type: 'vsl', publicId }` no próprio estado; a configuração da VSL continua existindo uma única vez no projeto. A prévia e a saída publicada usam sempre o iframe público absoluto `${PUBLIC_ORIGIN}/embed/v/<publicId>`, que carrega a versão publicada no player compartilhado. Um validador central resolve as referências antes do renderer síncrono e impede publicar quando a VSL não existe, pertence a outro projeto ou não tem versão publicada.

**Tech Stack:** JavaScript ESM, GrapesJS, DOM nativo, PostgreSQL, `node:test`, player MP4/HLS já existente.

**Spec:** `docs/superpowers/specs/2026-09-05-vsl-player-design.md` e `docs/superpowers/plans/2026-09-05-midia-vsl.md`

## Global Constraints

- A VSL pertence a um projeto e reutiliza uma URL HTTPS de MP4 ou HLS pronto.
- A configuração publicada é uma versão imutável; editar o rascunho não altera campanhas no ar.
- O player público usa `/v/<publicId>` e o embed usa `/embed/v/<publicId>`.
- A integração deve referenciar a VSL por `publicId`; nunca copiar sua configuração para o conteúdo consumidor.
- Uma publicação só pode incluir a versão publicada da VSL do mesmo `companyId` e `projectId`.
- Não adicionar upload, proxy, transcodificação, CDN, DRM, pixels ou analytics paralelo.

---

### Task 1: Contrato compartilhado da referência VSL

**Files:**
- Create: `packages/studio/server/vsl-reference.mjs`
- Test: `packages/studio/test/vsl-reference.test.mjs`
- Modify: `packages/studio/server/publication-snapshot.mjs`

**Interfaces:**
- Produces `normalizeVslReference(value) -> { type: 'vsl', publicId: string }`.
- Produces `resolvePublishedVsl({ database, companyId, projectId, publicId, publicOrigin }) -> { publicId, versionNumber, embedUrl }` or a 409/404 error.
- Produces `resolvePublishedVslReferences({ database, companyId, projectId, publicOrigin, references }) -> Map<publicId, { publicId, versionNumber, embedUrl }>`.

- [ ] Escrever testes para aceitar somente `type: 'vsl'` e `publicId` não vazio, rejeitar IDs internos/configuração embutida e exigir a VSL publicada no projeto correto.
- [ ] Rodar `node --test packages/studio/test/vsl-reference.test.mjs` e confirmar falha antes da implementação.
- [ ] Implementar o normalizador usando cópia defensiva e consultas com `companyId`, `projectId`, `publicId` e `published_version_id`; montar `embedUrl` como `${publicOrigin}/embed/v/${encodeURIComponent(publicId)}`.
- [ ] Fazer o snapshot resolver todas as referências antes de transformar uma página ou formulário em arquivo público.
- [ ] Rodar o teste focal e `git diff --check`.
- [ ] Commitar `test/feat: define referência de VSL nos editores`.

### Task 2: Bloco VSL no editor de landing pages

**Files:**
- Modify: `packages/studio/public/editor-shell.js`
- Modify: `packages/studio/public/editor-shell.css`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/templates.js`
- Test: `packages/studio/test/editor-controls.test.mjs`
- Test: `packages/studio/test/project-content.test.mjs`

**Interfaces:**
- Produces a block `data-alva-vsl` whose serialized state contains only `publicId`.
- The editor consumes the project-scoped `GET /projects/:projectId/videos`, shows only VSLs with published version and uses the public embed URL for preview; it never previews a draft.

- [ ] Escrever teste para inserir o bloco, serializar `publicId`, restaurar a seleção e não serializar `sourceUrl`, CTA ou versão.
- [ ] Rodar o teste focal e confirmar falha.
- [ ] Adicionar o bloco “VSL” à categoria de mídia e aos templates reutilizáveis, com ícone, rótulo e estado vazio orientando “Escolha uma VSL publicada”. Inserir a referência exige `page.write`; listar e selecionar VSLs exige `video.read`.
- [ ] Criar no inspetor um seletor somente com VSLs publicadas do projeto e uma prévia compacta em iframe usando a URL pública absoluta; esconder seleção quando `video.read` faltar.
- [ ] Ao editar o bloco, trocar a origem do iframe pela URL pública da versão publicada e remover o iframe ao trocar/remover o bloco; o editor não monta configuração de player nem acessa rascunhos.
- [ ] Garantir que a serialização persista somente `{ type: 'vsl', publicId }` e que uma referência removida fique visível como inválida até ser corrigida.
- [ ] Rodar testes focais, `node --test packages/studio/test/editor-controls.test.mjs packages/studio/test/project-content.test.mjs` e commitar `feat: add VSL block to landing page editor`.

### Task 3: Bloco VSL no editor de formulários dinâmicos

**Files:**
- Modify: `packages/studio/public/forms.js`
- Modify: `packages/studio/public/forms.css`
- Modify: `packages/studio/server/form-store.mjs`
- Test: `packages/studio/test/dynamic-form.test.mjs`
- Test: `packages/studio/test/forms-ui.test.mjs`

**Interfaces:**
- Extends the existing dynamic element schema with `type: 'vsl'`, `publicId`, `title`, `description`, `motion` and optional `advanceAfterCta`.
- The renderer receives a map of resolved public embed URLs only for preview/public rendering; it never stores the VSL configuration in the form schema.
- `renderDynamicForm(form, action, { vslEmbedUrls })` consumes that map and emits the absolute iframe URL for each VSL reference.

- [ ] Escrever testes de normalização, criação, renderização e migração de formulários contendo VSL por `publicId`.
- [ ] Rodar `node --test packages/studio/test/dynamic-form.test.mjs packages/studio/test/forms-ui.test.mjs` e confirmar falha.
- [ ] Adicionar “VSL” à lista de elementos informativos e ao menu “Adicionar conteúdo”, sem tratá-lo como pergunta obrigatória.
- [ ] Criar configuração simples: VSL publicada do projeto, título de apoio e movimento; remover campos técnicos de URL, poster e CTA da tela do formulário. A inserção exige `form.write`; listar e selecionar exige `video.read`.
- [ ] Renderizar um iframe responsivo com a URL pública absoluta resolvida, fallback acessível para VSL ausente e respeito a `prefers-reduced-motion`; o iframe usa o player único em `/embed/v/<publicId>`.
- [ ] Preservar VSL no topo fixo ou na tela dinâmica conforme o grupo em que o usuário inseriu o bloco.
- [ ] Rodar testes focais e commitar `feat: add VSL block to dynamic forms`.

### Task 4: Validação central da publicação

**Files:**
- Modify: `packages/studio/server/vsl-reference.mjs`
- Modify: `packages/studio/server/publication-snapshot.mjs`
- Modify: `packages/studio/server/repositories/content-repository.mjs`
- Test: `packages/studio/test/publication-snapshot.test.mjs`
- Test: `packages/studio/test/publication-integration.test.mjs`

**Interfaces:**
- `buildPublishableSnapshot()` remains the only gate used by project publication.
- A page/form containing VSL without published version fails with status 409 and a user-readable message.

- [ ] Escrever testes para VSL publicada válida, `publicId` inexistente, VSL de outra empresa/projeto, rascunho sem versão publicada e duas referências à mesma VSL.
- [ ] Rodar os testes de publicação e confirmar falha.
- [ ] Extrair referências dos estados de página e dos schemas de formulário antes de gerar o manifest; deduplicar consultas por `publicId`.
- [ ] Resolver de forma assíncrona `resolvePublishedVslReferences(...)` antes de chamar `renderDynamicForm(...)`, passando ao renderer apenas o mapa `publicId -> embedUrl`.
- [ ] Injetar na saída publicada somente `<iframe src="${PUBLIC_ORIGIN}/embed/v/<publicId>">` com URL absoluta e atributos acessíveis; a configuração permanece exclusivamente na versão publicada carregada pelo player.
- [ ] Fazer a publicação falhar atomically antes de criar deployment quando qualquer referência for inválida.
- [ ] Verificar que o HTML publicado aponta para `${PUBLIC_ORIGIN}/embed/v/<publicId>` com URL absoluta, sem rota relativa Vercel, IDs internos, tokens ou URL editável do rascunho.
- [ ] Rodar `node --test packages/studio/test/publication-snapshot.test.mjs packages/studio/test/publication-integration.test.mjs` e commitar `fix: validate VSL references before publication`.

### Task 5: UX, capacidades e verificação final

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/studio-shell.js`
- Modify: `packages/studio/public/app.js`
- Modify: `packages/studio/public/editor-shell.js`
- Modify: `packages/studio/public/forms.js`
- Test: `packages/studio/test/access.test.mjs`
- Test: `packages/studio/test/studio-dashboard.test.mjs`
- Test: `packages/studio/test/vsl-ui.test.mjs`

**Interfaces:**
- `video.read` controla listagem, seleção e prévia; `page.write` ou `form.write` controla a inserção e edição da referência no editor correspondente; `video.write` controla apenas CRUD da VSL; `deployment.publish` controla a publicação final.

- [ ] Escrever testes para editor sem `video.read`, editor com `video.read` sem `video.write`, usuário com `video.write` sem permissão no conteúdo consumidor, referência inválida e botão de publicação bloqueado com mensagem acionável.
- [ ] Rodar testes focais e confirmar falha.
- [ ] Exibir VSLs do projeto como opções visuais com nome, status “Publicada” e prévia; nunca mostrar URL longa ou JSON ao usuário.
- [ ] Mostrar no canvas uma prévia em escala normal, com estados “VSL não encontrada” e “publique a VSL antes de usar”; manter controles de edição no inspetor.
- [ ] Reutilizar os mesmos rótulos, ícones e eventos de teclado dos editores existentes; não criar um segundo player ou uma segunda tela de configuração. Se houver opção de avanço da tela após o CTA, ligar o evento `cta_click` do iframe à navegação existente; caso contrário, não expor esse campo nesta entrega.
- [ ] Rodar a suíte completa `node --test packages/studio/test/*.test.mjs`, revisar `git diff --check` e registrar o total final.
- [ ] Commitar `feat: finish VSL blocks for both editors`.

## Gate de homologação

Criar uma VSL MP4 e uma HLS no projeto de teste, publicar suas versões, usar cada uma em uma landing page e em uma microlanding page, visualizar no canvas e publicar um snapshot do projeto. Confirmar que a mesma VSL funciona por `publicId`, que editar o rascunho não muda o conteúdo publicado, que referências inexistentes bloqueiam a publicação e que nenhum dado de outra empresa/projeto aparece na lista, prévia ou publicação.
