# Mídia: modelo de dados e provedores externos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer a VSL aceitar YouTube e Vimeo além de MP4 e HLS, sem quebrar nenhuma VSL publicada, e deixar o schema pronto para o R2 que vem depois. Cobre dois nós: `midia_modelo_dados` (Tasks 1–3) e `player_provedores` (Tasks 4–9).

**Architecture:** o `createVslPlayerController` de `public/vsl-player.js:29-91` já é uma máquina de estado pura — recebe `loadedMetadata / play / pause / timeUpdate / ended` e emite `start | milestone | complete | cta_click | error`, sem tocar em `<video>`. Todo o acoplamento com o elemento está em `mountVslPlayer` (`:135-193`). O trabalho é extrair desse acoplamento uma interface de adaptador e escrever um adaptador por provedor, mantendo o controller intacto. No servidor, o que identifica o vídeo passa a ser o **ID do provedor**, não a URL: a URL é sempre reconstruída. A página pública continua sendo `/v/<publicId>` e `/embed/v/<publicId>` do próprio Studio — **o snapshot publicado não muda de forma**, porque `vsl-reference.mjs` já congela `publicId` e monta o `embedUrl` do Studio, não a URL do provedor.

**Tech Stack:** JavaScript ESM, Node.js 22, PostgreSQL, `node:test`, HTML/CSS/JS sem framework adicional.

**Spec:** `docs/superpowers/specs/2026-09-05-midia-provedores-e-r2-design.md`, seções 1, 2, 4 e 5; `produto/grafo.yaml`, nós `midia_modelo_dados` e `player_provedores`.

## Global Constraints

- **Este plano parte do estado que existirá depois do commit de `tracking_coletor`.** No momento da escrita o working tree tem esse nó em andamento, com `server/index.mjs`, `server/project-api.mjs`, `server/dynamic-form.mjs`, `public/vsl-player.js` e `server/publication-snapshot.mjs` modificados e não commitados. **Não comece nenhuma task antes de `tracking_coletor` estar commitado e verde.** Depois do commit, releia `public/vsl-player.js` e `server/vsl-public.mjs` antes de usar qualquer número de linha citado aqui — eles já se moveram uma vez durante a escrita desta spec.
- **Confira `packages/studio/server/db/migrations/` antes de criar o arquivo da migração.** No momento da escrita o maior número aplicado é `012_analytics_websites.sql`, então o próximo livre é **013**. `postgres.mjs:45` deriva a versão do prefixo numérico: dois arquivos com o mesmo prefixo colapsam na mesma versão e derrubam o boot com erro de checksum em toda inicialização. Se 013 tiver sido tomado, use o próximo livre e ajuste as referências deste plano.
- **Nunca edite uma migração já aplicada.** O checksum de `postgres.mjs:66-69` existe para parar exatamente isso.
- Nenhuma VSL existente pode quebrar. `mp4` e `hls` continuam funcionando com o mesmo comportamento, byte a byte, e os testes atuais de `vsl-*.test.mjs` continuam verdes sem edição.
- **Nenhuma URL colada pelo usuário é armazenada como endereço.** Para provedor, extrai-se o ID com regex ancorada e reconstrói-se a URL canônica no servidor. O que vai para o banco é o ID.
- **Nenhum host dinâmico entra na CSP sem passar por regex.** A tabela de provedores é estática no servidor e alimenta `server/content-security-policy.mjs` — não crie um segundo construtor de CSP.
- Isolamento por empresa e projeto não muda: toda leitura passa por `authorizedProject()` (`video-repository.mjs:141-158`) e a leitura pública continua exclusivamente em `getPublicVideo()`, que remove `companyId` e `projectId` do DTO.
- Panda e SmartPlayer **não** entram aqui. Panda é o nó seguinte, sem marcos; SmartPlayer está fora do corte.
- Toda produção segue RED → GREEN → REFACTOR. Quem implementa não faz a revisão de aceite.
- Suites com `postgresFixture(t)` exigem Docker; as puras não. O padrão é `const { connectionString } = await postgresFixture(t); const database = createDatabase({ connectionString }); t.after(() => database.close()); await migrate(database);` dentro de cada `test(...)`.
- Regra de fidelidade visual do `AGENTS.md`: tarefa de tela cita a seção do wireframe, reusa os tokens de `public/styles.css` e exige comparação em navegador com screenshot. Token novo é pergunta para o dono, não decisão de quem implementa.

---

### Task 1: Migração 013 — provedores, armazenamento e o backfill pendente de 009

**Files:**
- Create: `packages/studio/server/db/migrations/013_media_providers.sql`
- Test: `packages/studio/test/database-schema.test.mjs`

**Interfaces:**
- Altera `videos` e `video_versions`: `source_type` passa de `varchar(10)` para `varchar(20)` e o CHECK aceita `mp4 | hls | youtube | vimeo | panda | smartplayer | r2 | r2-hls`. **Alargue a coluna antes de trocar o CHECK** — `smartplayer` tem 11 caracteres e não cabe em `varchar(10)`.
- Acrescenta nas duas tabelas: `provider_video_id varchar(120)`, `provider_config jsonb NOT NULL DEFAULT '{}'::jsonb`.
- Acrescenta nas duas tabelas as colunas de armazenamento, já usadas pelo nó de R2: `storage_key varchar(400)`, `storage_bytes bigint`, `storage_content_type varchar(100)`, `storage_status varchar(20)` com CHECK em (`uploading`,`ready`,`failed`).
- CHECK de coerência: tipo de provedor exige `provider_video_id NOT NULL`; tipo `r2`/`r2-hls` exige `storage_key NOT NULL`.
- Backfill: `UPDATE videos SET published_lock_version = lock_version WHERE published_version_id IS NOT NULL AND published_lock_version IS NULL` — fecha o débito de `009_vsl_published_lock.sql:1`, que hoje faz `public/vsl-ui.js:3` mostrar VSL antiga como "em dia" mesmo depois de editada.

- [ ] **Step 1: Escrever os testes que falham**

  Em `database-schema.test.mjs`: inserir `source_type = 'youtube'` com `provider_video_id` funciona nas duas tabelas; inserir `'youtube'` **sem** `provider_video_id` é recusado pelo CHECK; inserir `'smartplayer'` não estoura o tamanho da coluna; `source_type` fora da lista continua recusado; `storage_status` fora da lista é recusado; e — o teste do backfill — subir um banco só com as migrações até 012, inserir um `videos` publicado com `published_lock_version` nulo, rodar `migrate()` até a 013 e provar que **nenhuma linha com `published_version_id` sobrou com `published_lock_version` nulo**.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/database-schema.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Escrever a migração. O trigger `video_versions_immutable` (`008_vsl_player.sql:72-74`) é `FOR EACH ROW` e não dispara em DDL, então `ALTER TABLE` em `video_versions` é seguro e **não** precisa de `DISABLE TRIGGER` — ao contrário da 003, não desligue nada.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/database-schema.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): schema de provedores de mídia e armazenamento`

**Pronto quando:** a suite passa, `migrate()` roda duas vezes seguidas sem erro de checksum, e um banco que só tinha até a 012 sobe até a 013 sem perder dado.

---

### Task 2: Origem por provedor — extração de ID, URL canônica e tabela de CSP

**Files:**
- Create: `packages/studio/server/media-source.mjs`
- Create: `packages/studio/test/media-source.test.mjs`

**Interfaces:**
- Produces: `parseMediaSource(input)` → `{ sourceType, providerVideoId, providerConfig, sourceUrl }` ou erro 400. Aceita `{ sourceType, sourceUrl }` e resolve o ID a partir da URL colada **ou** do ID puro.
- Produces: `PROVIDER_CSP` — mapa estático `{ youtube: { frame: [...], script: [...], connect: [...] }, vimeo: {...} }`. Sem host derivado de entrada do usuário nesta task.
- Produces: `providerEmbedUrl(sourceType, providerVideoId, providerConfig)` → URL canônica do embed do provedor, montada por template, nunca concatenando a string do usuário.
- YouTube: ID casa `^[A-Za-z0-9_-]{11}$`; aceita colar `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/embed/`; canônica `https://www.youtube.com/embed/<ID>?enablejsapi=1&origin=<studioOrigin>&autoplay=1&mute=1`.
- Vimeo: ID casa `^\d{6,12}$`; aceita colar `vimeo.com/<ID>` e `player.vimeo.com/video/<ID>`; canônica `https://player.vimeo.com/video/<ID>?autoplay=1&muted=1`.
- `mp4` e `hls` continuam pelo caminho de hoje: `providerVideoId` nulo e `sourceUrl` validada como HTTPS absoluta, sem credenciais, exatamente como `video-repository.mjs:18-31`.

- [ ] **Step 1: Escrever os testes que falham**

  Sem banco, no padrão de `webhook-worker.test.mjs`. Provar: as três formas de colar YouTube produzem o mesmo `providerVideoId`; ID de 10 e de 12 caracteres é recusado; `vimeo.com/12` é recusado e `vimeo.com/123456` é aceito; **uma URL de host arbitrário com um ID válido no path não vira provedor** (`https://evil.tld/embed/dQw4w9WgXcQ` é recusado); `javascript:` e `data:` são recusados em todos os tipos; a URL canônica devolvida nunca contém a query da URL colada; `mp4` e `hls` mantêm o comportamento atual, inclusive recusando `http:` e URL com credenciais.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/media-source.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Um objeto por provedor com `{ match, canonical, csp }`. Nada de regex montada em runtime a partir de entrada.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/media-source.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): normalizar origem de vídeo por provedor`

**Pronto quando:** a suite passa e nenhum caminho do arquivo devolve uma URL que contenha texto arbitrário do usuário.

---

### Task 3: Repositório e versão publicada aceitam provedor

**Files:**
- Modify: `packages/studio/server/repositories/video-repository.mjs`
- Test: `packages/studio/test/vsl-repository.test.mjs`
- Test: `packages/studio/test/vsl-api.test.mjs`

**Interfaces:**
- `normalizedInput()` passa a delegar a `parseMediaSource()` da Task 2 e a devolver também `providerVideoId` e `providerConfig`.
- `createVideo`, `updateVideo` e `duplicateVideo` gravam as colunas novas; `publishVideo` **copia** `provider_video_id` e `provider_config` para `video_versions`, como já faz com as demais.
- `record()` expõe `providerVideoId` e `providerConfig`; `getPublicVideo()` os expõe **sem** `companyId`, `projectId`, `storageKey` nem qualquer chave interna.
- Lock otimista, soft delete e `public_id` não mudam.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: criar VSL YouTube colando a URL do `watch?v=` e provar que o banco guardou o ID e a URL canônica; publicar e provar que a versão congelou `provider_video_id` e que editar o rascunho depois não altera a versão; `getPublicVideo()` de uma VSL YouTube devolve `sourceType`, `providerVideoId` e `providerConfig` e **não** devolve `companyId`, `projectId` nem `storageKey`; uma VSL `mp4` já existente continua com o mesmo DTO de antes, campo a campo; duplicar VSL de provedor preserva o ID e gera `public_id` novo.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-repository.test.mjs packages/studio/test/vsl-api.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Acrescentar as colunas ao INSERT, ao UPDATE e à cópia de versão. Não mexa em `authorizedProject()` nem no `scoped()`.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-repository.test.mjs packages/studio/test/vsl-api.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): persistir e publicar VSL de provedor externo`

**Pronto quando:** as duas suites passam e o DTO público de uma VSL `mp4` é idêntico ao de antes desta task.

---

### Task 4: Extrair o adaptador de mídia sem mudar o comportamento do player

**Files:**
- Create: `packages/studio/public/vsl-adapters.js`
- Modify: `packages/studio/public/vsl-player.js`
- Test: `packages/studio/test/vsl-runtime.test.mjs`

**Interfaces:**
- Produces: `createNativeAdapter({ container, config, on })` → `{ mount(), play(), pause(), seekTo(seconds), setMuted(bool), destroy() }`, chamando `on.metadata(duration)`, `on.time(seconds)`, `on.play()`, `on.pause()`, `on.ended()`, `on.error(message)`.
- Produces: `ADAPTERS` — mapa de `sourceType` para fábrica, com `mp4`, `hls`, `r2` e `r2-hls` apontando para `createNativeAdapter`. **Deixe as chaves `youtube` e `vimeo` declaradas no mapa desde já**, resolvidas por import, para que as Tasks 5 e 6 só criem os próprios arquivos e não voltem a editar este.
- `mountVslPlayer` passa a escolher o adaptador por `config.sourceType` e a repassar os eventos ao controller. **O `createVslPlayerController` não muda em nenhuma linha.**

- [ ] **Step 1: Escrever os testes que falham**

  Provar que `createNativeAdapter` traduz `loadedmetadata`, `timeupdate`, `play`, `pause`, `ended` e `error` do elemento nos seis callbacks; que `seekTo` e `setMuted` chegam ao elemento; que `destroy` pausa, limpa o `src` e esvazia o container; que `ADAPTERS.mp4 === ADAPTERS.hls`; e que `mountVslPlayer` com `sourceType` desconhecido mostra a mensagem de erro em vez de lançar. Reaproveite o `fakeVideo` que a suite já usa.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-runtime.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Mover o código de `<video>`, HLS, poster, legenda e autoplay para `createNativeAdapter`. `mountVslPlayer` fica com controles, CTA e render. Refactor puro: nenhum teste existente de `vsl-runtime.test.mjs` pode precisar de edição.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-runtime.test.mjs packages/studio/test/vsl-ui.test.mjs`

- [ ] **Step 5: Commit** — `refactor(studio): extrair adaptador de mídia do player de VSL`

**Pronto quando:** a suite passa **sem que nenhum teste anterior tenha sido alterado** — é isso que prova que o refactor não mudou comportamento.

---

### Task 5: Adaptador YouTube

**Files:**
- Create: `packages/studio/public/vsl-adapter-youtube.js`
- Create: `packages/studio/test/vsl-adapter-youtube.test.mjs`

**Interfaces:**
- Produces: `createYouTubeAdapter({ container, config, on, loadApi })` com a mesma superfície da Task 4. `loadApi` é injetável para o teste não tocar a rede.
- Cria o `<iframe>` a partir de `config.sourceUrl` (já canônica, vinda do servidor) e liga `onStateChange` para `PLAYING → on.play()`, `PAUSED → on.pause()`, `ENDED → on.ended()`.
- **Progresso é polling**, porque a IFrame API não emite evento de tempo: `setInterval` de 250 ms chamando `getCurrentTime()` e `getDuration()`, iniciado no play e parado no pause, no ended e no destroy.
- Declara `capabilities = { milestones: true, poster: false, captions: false, resume: true }` — é isso que a tela usa para dizer o que o provedor entrega.

- [ ] **Step 1: Escrever os testes que falham**

  Com uma API falsa injetada: `PLAYING` chama `on.play()` uma vez; o polling emite `on.time()` com o valor de `getCurrentTime()`; `destroy` limpa o intervalo — provar que nenhum `on.time` chega depois de `destroy`; `seekTo` chama `seekTo` da API; `setMuted(true)` chama `mute()`; falha ao carregar a API chama `on.error`. Provar também que `capabilities.poster` e `capabilities.captions` são `false`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-adapter-youtube.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-adapter-youtube.test.mjs packages/studio/test/vsl-runtime.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): adaptador de YouTube no player de VSL`

**Pronto quando:** a suite passa e nenhum `setInterval` sobrevive ao `destroy`.

---

### Task 6: Adaptador Vimeo

**Files:**
- Create: `packages/studio/public/vsl-adapter-vimeo.js`
- Create: `packages/studio/test/vsl-adapter-vimeo.test.mjs`

**Interfaces:**
- Produces: `createVimeoAdapter({ container, config, on, loadApi })`, mesma superfície.
- Usa `player.js` sobre `postMessage`: `play`, `pause`, `ended` e `timeupdate` são **push**, sem polling. `timeupdate` traz `seconds`, `duration` e `percent`.
- Declara `capabilities = { milestones: true, poster: false, captions: false, resume: true }`.

- [ ] **Step 1: Escrever os testes que falham**

  Com um `Player` falso: `timeupdate` chama `on.time()` com `seconds`, e **nenhum `setInterval` é criado** — a diferença de fidelidade em relação ao YouTube tem de estar provada em teste; `ended` chama `on.ended()` uma vez; `destroy` remove os listeners; falha de carregamento chama `on.error`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-adapter-vimeo.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-adapter-vimeo.test.mjs packages/studio/test/vsl-runtime.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): adaptador de Vimeo no player de VSL`

**Pronto quando:** a suite passa e o adaptador não usa temporizador.

---

### Task 7: Reconciliar os dois geradores de CSP e acrescentar os provedores

**Files:**
- Modify: `packages/studio/server/content-security-policy.mjs`
- Modify: `packages/studio/server/vsl-public.mjs`
- Test: `packages/studio/test/vsl-public.test.mjs`
- Test: `packages/studio/test/analytics-csp.test.mjs`

**O problema, antes da solução.** Hoje existem dois geradores independentes, e eles discordam em quatro pontos:

| | `vslContentSecurityPolicy` (`vsl-public.mjs:9-27`) | `formContentSecurityPolicy` (`content-security-policy.mjs:7-32`) |
| --- | --- | --- |
| `script-src` | `'self'`, **sem nonce** | `'self'` + `'nonce-…'` **obrigatório** |
| `frame-ancestors` | variável: `'none'` ou `https:` quando `embed` | fixo `'self'` |
| `form-action` / `base-uri` | **ausentes** | `form-action <origem>`; `base-uri 'none'` |
| `img-src` / `media-src` / `connect-src` | origens estreitas, derivadas do vídeo | largas: `data: https:` |

Nenhum dos dois é "o certo": a página de VSL não tem formulário e precisa ser emoldurável no `/embed`; a página de formulário precisa de nonce e não deve ser emoldurável por terceiro. O que sobra em comum é a montagem.

**Interfaces:**
- Produces: `buildContentSecurityPolicy({ nonce, scriptSrc, styleSrc, fontSrc, imgSrc, mediaSrc, connectSrc, frameSrc, formAction, frameAncestors, baseUri })` em `content-security-policy.mjs` — a base compartilhada. Regras: `default-src 'none'` sempre primeiro; **toda diretiva com valor nulo ou lista vazia é omitida**; `nonce` é opcional e, quando presente, entra em `script-src`; `frameAncestors` é **obrigatório e explícito** — a base não tem padrão, porque o padrão errado aqui é uma falha de segurança silenciosa; a ordem das diretivas é fixa, para a saída ser determinística e comparável byte a byte.
- `formContentSecurityPolicy` passa a ser um invólucro fino: monta suas listas e chama a base com `nonce`, `formAction`, `frameAncestors: "'self'"` e `baseUri: "'none'"`.
- `vslContentSecurityPolicy` passa a ser outro invólucro fino: chama a base **sem** `nonce`, **sem** `formAction`, **sem** `baseUri`, com `frameAncestors: embed ? 'https:' : "'none'"`, e agora também com `frameSrc` e `scriptSrc` do provedor, vindos de `PROVIDER_CSP` da Task 2.
- `renderVslPage()` monta o container do provedor sem `<video>` quando o tipo é de provedor, mantendo `.vsl-shell` e o `aspect-ratio` já validado.

**Fora de escopo, de propósito.** Acrescentar `base-uri` e `form-action` à página de VSL seria uma melhoria real, mas mudaria a política de páginas que já estão no ar. Esta task é refactor mais provedores; endurecer a página de VSL é decisão separada, com teste próprio. Não faça de carona.

- [ ] **Step 1: Escrever os testes que falham**

  Primeiro os testes de equivalência, que são o coração da task: a saída de `vslContentSecurityPolicy` para `mp4`, `hls`, com e sem `embed`, é **byte a byte idêntica à de hoje** (fixe as strings atuais como literais no teste, não as recalcule); a saída de `formContentSecurityPolicy` é byte a byte idêntica à de hoje para os mesmos parâmetros. Depois os testes novos: `youtube` acrescenta `https://www.youtube.com` em `frame-src` e **não** introduz `'unsafe-inline'` nem nonce em `script-src`; `vimeo` libera `player.vimeo.com` em `frame-src` e o host do `player.js` em `script-src`; um `sourceUrl` com `;`, espaço ou nova linha não consegue inserir diretiva; `buildContentSecurityPolicy` omite diretiva de lista vazia; e chamar a base **sem** `frameAncestors` lança, em vez de emitir política sem a diretiva.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-public.test.mjs packages/studio/test/analytics-csp.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Em duas etapas, nesta ordem, sem pular:
  1. **Extrair sem mudar saída.** Escrever `buildContentSecurityPolicy` e reescrever as duas funções existentes como invólucros que a chamam. Nesta etapa os testes de equivalência já têm de passar — a saída das duas não muda em nenhum byte. Se mudar, o invólucro está errado, não o teste.
  2. **Acrescentar o provedor.** Só então `vslContentSecurityPolicy` recebe `sourceType` e soma `frameSrc` e `scriptSrc` de `PROVIDER_CSP`. `mp4`, `hls`, `r2` e `r2-hls` não passam nenhuma origem de provedor, então continuam idênticos.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-public.test.mjs packages/studio/test/analytics-csp.test.mjs`

- [ ] **Step 5: Commit** — `refactor(studio): base única de CSP e diretivas por provedor`

**Pronto quando:** as duas suites passam, existe **um único** lugar que monta diretiva de CSP no servidor, e a política de `mp4` e a das páginas `/f/...` continuam idênticas às de antes da task.

---

### Task 8: Tela "Configure sua VSL" — seletor de origem e Prévia real

Implementa a seção **"Configure sua VSL"** de `docs/wireframes/alva-studio-ui-reference.html` (view `#view-vsl-config`). Consome as Tasks 2, 5, 6 e 7. Reproduza a seção como ela está — não reinterprete o layout.

**Files:**
- Modify: `packages/studio/public/index.html`
- Modify: `packages/studio/public/vsl-ui.js`
- Modify: `packages/studio/public/styles.css`
- Test: `packages/studio/test/vsl-ui.test.mjs`

**O que muda.** A tela atual é `#vsl-view`, em `packages/studio/public/index.html:215`. O dono decidiu (05/09/2026) que os três desvios em relação ao wireframe **entram no escopo desta task**, junto com as duas mudanças de origem. Cinco itens, então:

1. **Título.** O `h2` do formulário diz "Configurar VSL". O wireframe diz **"Configure sua VSL"**. Trocar, mantendo o `p` de apoio.
2. **Estrutura dos passos.** Hoje cada passo é `<fieldset><legend><span>N</span> Título</legend>`. O wireframe usa `section.vsl-step` contendo `div.vsl-step-title` com `span.vsl-step-number` (o chip numerado, 1 a 4) e um `div` com `<strong>` e `<small>`, seguido de `div.vsl-fields` com `div.field` (`label` + controle). Converter os quatro passos para essa marcação, preservando os `name` de todos os campos — `parseVslFormValues()` depende deles.
3. **Campo "Tipo", passo 1.** Hoje é `<select name="sourceType">` com `MP4` e `HLS`. O wireframe usa `div.vsl-choice` com botões — `HLS` (com `.active`), `MP4`, `YouTube`. Converter e estender com `Vimeo`. O campo "URL do vídeo" continua sendo o campo de origem: recebe a URL ou o ID colado e mostra o erro de validação da Task 2 quando não casar.
4. **Campo "Proporção", passo 2.** Hoje é `<select name="aspectRatio">`. O wireframe usa o mesmo `div.vsl-choice` do campo Tipo, com `16:9` (`.active`), `1:1` e `9:16`. Converter, reusando o componente do item 3 — é a mesma "opção visual" da Biblioteca visual, não um controle novo.
5. **Bloco "Prévia".** Hoje é um cartão de resumo em texto: `#vsl-preview-screen` com um `<img>` de poster, o ícone `play_circle`, um `<strong>` e **três** `<small>` (meta, reprodução e CTA). O wireframe é `div.vsl-screen` com `span.vsl-play` — e o texto do próprio wireframe define o critério: *"Assim o vídeo aparece para quem visitar sua página. A prévia atualiza conforme você configura."* Trocar o Tipo tem de fazer a Prévia mostrar o vídeo daquela fonte. **Prévia que não muda significa fonte que não funciona** — é este o aceite visual do nó.

**Tokens.** Use os de `packages/studio/public/styles.css` (bloco `:root`). O wireframe nomeia `--blue #286eea`, `--ink #101828`, `--line #e1e7ef`; o Studio já tem os equivalentes. **Não crie cor, raio, sombra, família ou tamanho novo** — se faltar token para `vsl-step-number` ou `vsl-choice`, é pergunta para o dono, não decisão de quem implementa.

**Interfaces:**
- Produces: `vslSourceModel({ sourceType, capabilities })` em `vsl-ui.js` → `{ opcoes: [{ id, rotulo, ativo }], aviso }`, onde `aviso` diz o que o provedor não entrega (YouTube e Vimeo: poster e legenda próprios não se aplicam).
- `parseVslFormValues()` passa a devolver `sourceType` vindo do `vsl-choice`, não do `select`.

- [ ] **Step 1: Escrever os testes que falham**

  Em `vsl-ui.test.mjs`: `vslSourceModel` marca exatamente uma opção como ativa e devolve as quatro; escolher `YouTube` produz o aviso de poster e legenda; `parseVslFormValues` lê o tipo do botão ativo; colar uma URL de YouTube inválida mostra a mensagem da Task 2 e não envia o formulário; a Prévia recebe a URL canônica quando o tipo é de provedor e o `<video>` quando é `mp4`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-ui.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-ui.test.mjs packages/studio/test/vsl-runtime.test.mjs`

- [ ] **Step 5: Verificação visual em navegador**

  Abrir a tela de VSL e a seção "Configure sua VSL" do wireframe lado a lado, no mesmo viewport, em desktop e em 375 px. Conferir item a item: o título "Configure sua VSL"; os quatro `section.vsl-step` com o chip `vsl-step-number` de 1 a 4; o `vsl-choice` do campo Tipo com quatro opções; o `vsl-choice` do campo Proporção com três; e o bloco Prévia. Trocar o Tipo entre MP4, YouTube e Vimeo com a tela aberta e confirmar que a Prévia muda em cada troca. Salvar o screenshot da comparação.

- [ ] **Step 6: Commit** — `feat(studio): seletor de origem e prévia por provedor na VSL`

**Pronto quando:** a suite passa, o screenshot existe, a Prévia muda a cada troca de origem, os cinco itens acima estão implementados e nenhum token novo foi criado.

---

### Task 9: Publicação continua válida com VSL de provedor

**Files:**
- Test: `packages/studio/test/vsl-reference.test.mjs`
- Test: `packages/studio/test/publication-snapshot.test.mjs`

**Interfaces:** nenhuma. Esta task **não muda código de publicação** — ela prova que não precisa mudar. `vsl-reference.mjs:45` monta `embedUrl` como `<origem do Studio>/embed/v/<publicId>`, independentemente do provedor, então o snapshot congela a chave lógica e o provedor fica invisível para a publicação. Se algum teste desta task exigir mudança em `vsl-reference.mjs` ou `publication-snapshot.mjs`, **pare e reporte**: significa que a premissa da spec está errada.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: publicar uma página que referencia uma VSL YouTube publicada gera HTML com `iframe src` apontando para `/embed/v/<publicId>` do Studio e **não** para `youtube.com`; referenciar uma VSL YouTube de outro projeto continua devolvendo 409; referenciar uma VSL de provedor ainda não publicada continua bloqueando a publicação; o hash do snapshot muda quando o `sourceType` da VSL muda e a VSL é republicada.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/vsl-reference.test.mjs packages/studio/test/publication-snapshot.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Provavelmente nada. Se os testes já passarem no RED, registre isso como resultado válido e siga.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/vsl-reference.test.mjs packages/studio/test/publication-snapshot.test.mjs`

- [ ] **Step 5: Commit** — `test(studio): cobrir publicação de VSL de provedor externo`

**Pronto quando:** as duas suites passam sem edição em `vsl-reference.mjs` nem em `publication-snapshot.mjs`.

---

### Task 10: Certificação dos dois nós

**Files:**
- Create: `.estado/midia_modelo_dados.md`
- Create: `.estado/player_provedores.md`

- [ ] **Step 1: Suite completa, uma única vez**

  Run: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`

- [ ] **Step 2: Revisão independente de aceite**

  Quem construiu não confere. Verificar: nenhuma migração aplicada foi editada; existe um único gerador de diretiva de CSP no servidor; nenhuma URL do usuário é armazenada como endereço; a CSP de `mp4` não mudou; o `createVslPlayerController` não foi alterado; nenhum teste anterior foi editado para passar.

- [ ] **Step 3: Verificação visual da Task 8**

  Regra "Regra de fidelidade visual" do `AGENTS.md`. Comparar a tela com a seção **"Configure sua VSL"** do wireframe, em desktop e em 375 px, e anexar o screenshot. Confirmar que nenhum token novo entrou em `public/styles.css`.

- [ ] **Step 4: Escrever as certificações**

  `.estado/midia_modelo_dados.md` e `.estado/player_provedores.md` com `status: feito`, ressalvas, a seção do wireframe conferida com o caminho do screenshot, a confirmação de que os cinco itens da Task 8 foram entregues, e a linha exigida pelo `passa_quando` de cada nó em `produto/grafo.yaml`. Rodar `vibe conferir midia_modelo_dados` e `vibe conferir player_provedores` e confirmar verde.

**Pronto quando:** a suite completa passa, as duas certificações existem e os dois `vibe conferir` estão verdes.

---

## Gate de homologação

Antes de marcar qualquer um dos dois nós como `feito`: subir o Studio com PostgreSQL real, criar uma VSL de cada tipo — MP4, HLS, YouTube e Vimeo — publicar as quatro, abrir `/v/<publicId>` e `/embed/v/<publicId>` de cada uma e confirmar autoplay mutado, progresso, CTA no tempo configurado e retomada. Confirmar no console do navegador que **nenhuma violação de CSP** aparece em nenhuma das quatro. Confirmar que uma VSL `mp4` criada antes deste plano continua tocando sem nenhuma edição.

## Ordem e paralelismo

- **Onda 1, três terminais:** Tasks 1, 2, 4 — arquivos disjuntos. A 2 e a 4 nem dependem do schema.
- **Onda 2, quatro terminais:** Task 3 (depende de 1 e 2), Task 5 (depende de 4), Task 6 (depende de 4), Task 7 (depende de 2).
- **Onda 3, dois terminais:** Task 8 (depende de 2, 5, 6, 7), Task 9 (depende de 3).
- **Onda 4:** Task 10, sozinha.

Sem colisão de arquivos em nenhuma onda: `public/vsl-player.js` e `public/vsl-adapters.js` só pela Task 4; os dois adaptadores de provedor são arquivos próprios e **não** reeditam o mapa, que a Task 4 já deixa completo; `server/vsl-public.mjs` e `server/content-security-policy.mjs` só pela Task 7; `server/repositories/video-repository.mjs` só pela Task 3; e todo o `public/` de tela — `index.html`, `vsl-ui.js`, `styles.css` — só pela Task 8, sozinha na sua onda com a Task 9, que é só de teste.
