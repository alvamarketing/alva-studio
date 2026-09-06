# Corte VSL V1→V2 — 2026-09-06

- V1 formalizada como páginas, quizzes, analytics, tracking, cobrança e agentes, na ordem Tasks 6 → 7 → 9 → 10 → 11.
- Task 8, player próprio, upload, R2, FFmpeg e HLS foram movidos para a V2. APIs, dados e referências VSL existentes permanecem preservados.
- O grafo marca `vsl_player`, `vsl_nos_editores` e `midia_cdn` como `fase: v2`; `tracking_coletor` não depende mais do player VSL. Nós de analytics/tracking/cobrança/agentes foram marcados como V1.
- O menu VSL agora só aparece quando `runtime.media === true` e a capacidade `video.read` existe. Com mídia desligada, a navegação e anúncios dependentes ficam inativos; com mídia ligada, o comportamento anterior é preservado.
- Teste focado: `node --test packages/studio/test/studio-dashboard.test.mjs` — 28 pass, 0 fail.
- `node --check packages/studio/public/app.js`, YAML do grafo e `git diff --check` passaram.
- `vibe conferir tracking_pixels` permanece bloqueado por pendência preexistente: `.estado/tracking_pixels.md` não existe. Nenhum estado foi inventado nesta mudança.

## Fix P1 — desligamento integral de mídia

- Com `MEDIA_PIPELINE_ENABLED=false`, o Studio oculta navegação, filtro de VSL e contagem VSL; o overview também remove itens `kind=video`, métrica VSL e publicações de vídeo do resumo.
- O catálogo de VSL não é consultado pelos editores de páginas/formulários. As rotas autenticadas `/api/projects/:id/videos*` e as rotas públicas `/v/*` e `/embed/v/*` respondem indisponibilidade estável sem acessar o repositório de vídeos.
- Com mídia habilitada, o catálogo, player e rotas preservam o comportamento anterior. A flag continua derivada do contrato `overview.runtime.media` no painel.
- Testes focados: `node --test packages/studio/test/studio-dashboard.test.mjs packages/studio/test/vsl-api.test.mjs packages/studio/test/vsl-public.test.mjs` — 39/39.
- Sintaxe e `git diff --check` passaram; tabelas, dados e APIs existentes foram preservados.

## Compatibilidade do fixture legado — 2026-09-06

- O default de mídia permanece desligado. Testes de contrato VSL que exercitam o comportamento legado agora ativam explicitamente `runtimeFlags.mediaPipeline=true`, sem alterar a semântica de produção.
- Suíte ampliada: `node --test packages/studio/test/project-api.test.mjs packages/studio/test/vsl-api.test.mjs packages/studio/test/vsl-public.test.mjs packages/studio/test/studio-dashboard.test.mjs packages/studio/test/runtime-flags.test.mjs` — 65/65.

## Fixtures legados adicionais — 2026-09-06

- O teste de página pública VSL no módulo de analytics também passou a declarar `runtimeFlags.mediaPipeline=true`; nenhum outro teste que cria VSL dependia implicitamente do default.
- Suíte completa `pnpm test:studio`: **440/440**, sem falhas.

## DTO e editores com mídia desligada — 2026-09-06

- `overviewForRuntime` agora remove no servidor `counts.videos`, `counts.publishedVideos` e conteúdo `kind=video` quando `runtime.media=false`; com true preserva o DTO.
- O catálogo VSL não aparece nos editores de landing/quizzes quando a mídia está desligada, e a consulta permanece bloqueada. Referências VSL já salvas continuam preservadas e voltam a ser editáveis quando a mídia é ligada.
- Suíte completa `pnpm test:studio`: **441/441**, sem falhas.

## Ocultação de referências legadas no editor — 2026-09-06

- Com `mediaEnabled=false`, referências VSL existentes permanecem no modelo original, mas são excluídas da árvore, canvas e inspetor do quiz; mutadores não conseguem selecioná-las ou alterá-las. A prévia da landing oculta os componentes somente no DOM do editor, sem gravar CSS no conteúdo.
- O salvamento continua serializando `current.steps`, `headerElements` e HTML originais, preservando referências legadas byte a byte; com mídia habilitada, catálogo, seleção, prévia e edição são restaurados.
- Suíte completa `pnpm test:studio`: **441/441**, sem falhas.
