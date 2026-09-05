# Mídia: provedores externos e hospedagem em R2 — design

Sucessor de [`2026-09-05-vsl-player-design.md`](2026-09-05-vsl-player-design.md), que fechou o corte "URL HTTPS de MP4 ou HLS pronto" e deixou upload, transcodificação e CDN fora. O nó `midia_cdn` avança agora em duas frentes independentes: **(A)** adaptadores de provedores externos no player e **(B)** hospedagem própria em Cloudflare R2. Nenhuma das duas substitui a outra — o cliente que já paga YouTube ou VTurb continua nesse caminho; o que não quer depender de terceiro passa a ter R2.

Esta spec não contém código de produção. Ela fixa contratos, fronteiras e critérios.

---

## 1. Modelo de dados

Hoje `source_type` é `varchar(10) CHECK (source_type IN ('mp4','hls'))` em `008_vsl_player.sql:8` (videos) e `:41` (video_versions).

Migração `012_media_providers.sql` precisa:

> **Numeração:** `010_webhook_deliveries.sql` e `011_analytics_collector.sql` já existem (nós `worker_webhook` e `tracking_analytics`, em andamento por outros agentes). Confira o diretório antes de criar o arquivo: `postgres.mjs:45` deriva a versão do prefixo numérico, então **dois arquivos com o mesmo prefixo colapsam na mesma versão** e o segundo derruba o boot com erro de checksum em toda inicialização.

- **Alargar a coluna antes do CHECK.** `smartplayer` tem 11 caracteres e não cabe em `varchar(10)`. Sem isso a migração passa e o primeiro insert falha. Novo domínio: `mp4 | hls | youtube | vimeo | panda | smartplayer | r2 | r2-hls`. Trocar o CHECK em `video_versions` é seguro: o trigger `video_versions_immutable` (`008:72-74`) é `FOR EACH ROW` e não dispara em DDL.
- **Separar identidade de endereço.** Para provedor, o que identifica o vídeo é o ID, não a URL. Colunas novas em **ambas** as tabelas: `provider_video_id varchar(120)`, `provider_config jsonb NOT NULL DEFAULT '{}'` (host `vz-XXXX` do Panda, `playerKey` do SmartPlayer). `source_url` continua `NOT NULL` e passa a guardar a **URL canônica reconstruída** pelo servidor — nunca a string colada pelo dono.
- **Colunas de armazenamento** (só usadas quando `source_type` começa com `r2`): `storage_key varchar(400)`, `storage_bytes bigint`, `storage_content_type varchar(100)`, `storage_status varchar(20) CHECK (storage_status IN ('uploading','ready','failed'))`.
- **Backfill do débito de 009.** `009_vsl_published_lock.sql:1` adicionou `published_lock_version` sem backfill: toda VSL publicada antes dele está NULL e, como `vsl-ui.js:3` guarda por `!== null`, aparece como "em dia" mesmo depois de editada. A 012 fecha isso com `UPDATE videos SET published_lock_version = lock_version WHERE published_version_id IS NOT NULL AND published_lock_version IS NULL`. O critério de aceite da fase 0 cobra exatamente isso.
- **CHECK de coerência**, para o banco recusar estado impossível: `provider_video_id IS NOT NULL` quando o tipo é de provedor; `storage_key IS NOT NULL` quando o tipo é `r2*`.

### Snapshots publicados continuam imutáveis

`video_versions` copia todas as colunas novas, como já faz com as atuais (`video-repository.mjs:242-250`). Uma regra é inegociável:

> **O snapshot nunca congela URL pré-assinada nem token.** Ele congela a chave lógica — `(source_type, provider_video_id, provider_config)` ou `storage_key` — e o render resolve o endereço público estável na hora. Uma versão imutável com URL expirável é uma versão que quebra sozinha em sete dias.

Para R2 isso significa que o objeto é servido por domínio público estável do bucket, não por link assinado. Ler é público; escrever é sempre assinado.

---

## 2. Adaptador de player

O contrato já existe e está limpo: `createVslPlayerController` (`vsl-player.js:29-91`) não toca em `<video>` em lugar nenhum. Ele recebe `loadedMetadata / play / pause / timeUpdate / ended / setMuted / resumeTime / ctaClick / setError` e emite `start | milestone | complete | cta_click | error`. O acoplamento com o elemento está todo em `mountVslPlayer` (`:135-193`).

O trabalho é extrair desse acoplamento uma interface de adaptador e reimplementá-la por provedor. Superfície mínima:

| Adaptador chama o controller | Controller ↔ adaptador |
| --- | --- |
| `onMetadata(duration)`, `onTime(s)`, `onPlay`, `onPause`, `onEnded`, `onError` | `mount()`, `play()`, `pause()`, `seekTo(s)`, `setMuted(bool)`, `destroy()` |

`native` (mp4, hls, r2, r2-hls) é o adaptador de hoje, extraído sem mudança de comportamento. Os outros entram um a um.

### O que cada provedor entrega — e o que não entrega

**YouTube** — `youtube.com/embed/<ID>?enablejsapi=1&origin=<origem>&autoplay=1&mute=1`, IFrame API, `onStateChange` para PLAYING/PAUSED/ENDED. **Não há evento de tempo**: progresso sai de polling `getCurrentTime()/getDuration()`. Consequências que precisam estar na tela, não só aqui: os marcos 25/50/75 têm a granularidade do polling; com a aba em segundo plano o navegador estrangula o timer e os marcos chegam atrasados ou em bloco. Poster próprio, legenda VTT própria e remoção de marca d'água **não existem** — quem manda na moldura é o YouTube.

**Vimeo** — `player.vimeo.com/video/<ID>?autoplay=1&muted=1` com `player.js`. Fidelidade melhor que YouTube: `play`, `timeupdate` (traz `percent`) e `ended` chegam por push via `postMessage`, sem polling. Poster e legenda continuam sendo os do Vimeo. Requer carregar um script de terceiro — entra na CSP.

**Panda Video — embed com início e fim, sem marcos (decisão do dono, 05/09/2026).** `player-vz-XXXX.tv.pandavideo.com.br/embed/?v=<ID>`, com `PandaPlayer.onEvent` e `panda_timeupdate`. O host varia por tenant, então **o host é derivado do ID e validado, nunca colado livre** — ele entra na CSP. O catálogo completo de eventos não foi confirmado contra uma conta real, e a spec não promete o que não foi visto: no primeiro corte o adaptador Panda entrega **`start` e `complete` apenas**. Os marcos 25/50/75/100 ficam para `player_panda_marcos`, depois que houver conta de teste e o catálogo estiver registrado por escrito. Até lá o adaptador declara `milestones: []` e a tela diz que este provedor não reporta progresso parcial.

**SmartPlayer (VTurb) está fora do primeiro corte** (decisão do dono, 05/09/2026). Ver §8.

### CSP por provedor

`vslContentSecurityPolicy` (`vsl-public.mjs:9-27`) hoje deriva origens de `new URL(x).origin`, o que já a torna imune a injeção de diretiva. Ela já ganhou um parâmetro `studioOrigin` pelo nó `tracking_analytics`; passa a receber também `provider` e a somar `frame-src`, `script-src` e `connect-src` **a partir de uma tabela estática no servidor**, jamais de string do usuário. `default-src 'none'` continua. O único host dinâmico é o do Panda, e só depois de casar a regex do subdomínio `vz-`.

> **Reaproveitar, não duplicar.** O nó `tracking_analytics` acabou de criar `server/content-security-policy.mjs`, cujo `formContentSecurityPolicy` já monta diretivas com `frameOrigins`, `pixelDomains` e nonce. A tabela de provedores deve alimentar esse módulo, não um segundo construtor de CSP dentro de `vsl-public.mjs`. Dois geradores de CSP no mesmo produto divergem em semanas — e é a CSP que segura o SmartPlayer fora do documento do CTA.

### Embed responsivo

Sem mudança de contrato: `aspect_ratio` já é validado por `^(\d{1,4}):(\d{1,4})$` (`video-repository.mjs:45-50`) e aplicado em `.vsl-shell`. O iframe do provedor ocupa `width:100%;height:100%` dentro dessa moldura.

---

## 3. Cloudflare R2

### Fluxo de upload

1. `POST /api/projects/:id/videos/uploads` — exige `video.write`; recebe nome, tamanho e content-type **declarados**; devolve `uploadId` e uma **URL pré-assinada S3 de `PUT`** com validade de 5 minutos.
2. O navegador faz `PUT` direto no R2. O servidor nunca intermedia bytes.
3. `POST /api/projects/:id/videos/uploads/:uploadId/complete` — o servidor faz `HEAD` no objeto e confere **tamanho e content-type reais**. Só então `storage_status='ready'` e o `videos` é criado ou atualizado.

O passo 3 não é burocracia: o corpo do `PUT` é do navegador, então o content-type declarado no passo 1 não vale nada. O `HEAD` é o que transforma declaração em fato.

### Credencial: bucket da Alva, guardada no cofre global (decisão do dono, 05/09/2026)

O Studio hospeda num bucket **da Alva**, com prefixo por empresa e projeto e repasse de custo ao cliente. O cliente **não abre conta Cloudflare**.

**As credenciais do R2 não ficam em variável de ambiente.** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, a conta e o bucket vivem em `global_secrets` com `scope='r2'`, gravados **write-only** pelo painel de plataforma — o campo aceita escrita, nunca devolve o valor, e a tela mostra apenas "configurado em ‹data›" com um botão "Substituir". Tudo isso está especificado em [`2026-09-05-superadmin-global-design.md`](2026-09-05-superadmin-global-design.md), que **já existe** no repositório: o schema de `global_secrets`, o envelope KEK/DEK, e os cartões "Bucket R2 da Alva" e "Chaves do R2" da aba *Armazenamento*.

Isto **revoga** a decisão anterior desta spec, que punha as quatro variáveis no ambiente. O argumento antigo — "o cofre guarda segredo de tenant e este não é de tenant" — estava certo sobre `company_secrets` e errado sobre o problema: faltava um cofre de plataforma, e `global_secrets` é exatamente ele. Ganho concreto: trocar a chave do R2 deixa de exigir deploy.

**Consequência nas dependências.** `midia_r2_upload` **passa a depender de `plataforma_superadmin`** — sem R2 configurado no painel, o upload responde que o armazenamento ainda não foi configurado, em vez de falhar na chamada à Cloudflare. Ele continua **não** dependendo de `cofre_por_projeto`: o cofre por projeto só é exigido pela conta própria do cliente, em `midia_r2_conta_cliente`.

**Reconciliado em 05/09/2026.** A spec do superadmin admitia "o ambiente como fallback de boot" para essas quatro variáveis; a frase foi corrigida lá. Nas duas specs vale a mesma regra: `global_secrets` é a única fonte de verdade para o R2, sem fallback de ambiente nem para o arranque, e no `.env` ficam apenas `DATABASE_URL` e a KEK.

### `cofre_por_projeto`: a migração, em concreto

Hoje `company_secrets` (`001_saas_foundation.sql:330-341`) é `UNIQUE (company_id, provider, secret_name, key_version)`; `publication-repository.mjs:97` grava com `DO UPDATE SET encrypted_value` e `:119-125` lê **só por `company_id`**. Conectar um segundo projeto sobrescreve a credencial do primeiro em silêncio — o defeito já visto na Vercel.

Migração `013_secrets_por_projeto.sql` (ver a nota de numeração na §1):

1. `ADD COLUMN project_id uuid`, **nullable de propósito**, mais `FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)` — composta, como o resto do schema, para o banco recusar segredo de projeto de outra empresa. Com `project_id` nulo a FK composta é satisfeita, então a coluna nullable não enfraquece o isolamento.
2. **Semântica de `NULL`:** `project_id IS NULL` passa a significar "segredo da empresa, herdado por projeto que não tenha o seu". A leitura vira duas etapas — procura `project_id = $2`, cai para `IS NULL` se não achar. É isso que mantém compatibilidade sem tornar a coluna obrigatória.
3. **Trocar a unicidade por dois índices parciais**, porque `UNIQUE` trata `NULL` como distinto e deixaria duplicar a linha de empresa:
   - `UNIQUE (company_id, project_id, provider, secret_name, key_version) WHERE project_id IS NOT NULL`
   - `UNIQUE (company_id, provider, secret_name, key_version) WHERE project_id IS NULL`
   - `DROP` do `UNIQUE` antigo e do índice `company_secrets_active` (`001:341`), recriado com `project_id`.
4. **Destino do segredo único que já existe.** Ele não registra qual projeto o gravou, então não há como inferir o dono — e adivinhar seria pior que copiar. O backfill faz **fan-out**: para cada linha de `provider='vercel'` com `project_id IS NULL`, insere uma cópia para cada `project_integrations` da mesma empresa e provedor. Todos os projetos ficam com a credencial que já usavam de fato — o estado de hoje, preservado — e a partir daí divergem sem se sobrescrever.
5. **Depois do fan-out, apagar a linha de empresa de `provider='vercel'`.** Se ela ficar como fallback, um projeto novo herda a credencial de outro cliente, que é exatamente o defeito que a migração existe para fechar. `project_id IS NULL` fica reservado a segredos genuinamente de empresa.
6. Oportunidade adjacente, opcional no mesmo nó: gravar novos segredos como `key_version = 2` com AAD `company_id|project_id|secret_name` no GCM, e fazer o `decrypt` finalmente ler o `keyVersion` que `publication-repository.mjs:23` já grava e nunca consulta. Rotação é a via — não há reencriptação em massa.

### Fases do armazenamento

**MP4 progressivo primeiro.** É o que já toca no adaptador `native` sem nenhuma peça nova.
**HLS depois**, em `midia_r2_hls`: worker ffmpeg fora do processo HTTP, escrevendo `.m3u8` e segmentos num prefixo irmão e só então promovendo `source_type` de `r2` para `r2-hls`. Até o worker existir, arquivo grande é MP4 progressivo com aviso na tela.

### Retenção, limites e custo

- Cotas **aprovadas pelo dono (05/09/2026) e configuráveis**, não constantes de código: **2 GB por arquivo** e **50 GB por empresa**. Ficam em configuração do servidor com esses valores como padrão, para subir um cliente sem migração nem deploy.
- **Medição de consumo por empresa entra no dia 1** (decisão do dono, 05/09/2026), não depois. `storage_bytes` já é coluna de `videos` na migração 012, então o agregado por empresa é uma soma — não exige tabela nova. O superadmin lê esse agregado na sua tela de gestão de empresas; a cota o usa como freio. Medir depois seria descobrir o custo pela fatura.
- Objeto de VSL excluída fica **30 dias** e depois é varrido — **exceto** se estiver referenciado por alguma `video_versions` publicada. Apagar objeto de versão publicada transformaria a imutabilidade da versão em mentira.
- Custo (levantamento de 05/09/2026, egress não cobrado): 50 GB + 500 GB ≈ **US$ 0,60/mês**; 200 GB + 2 TB ≈ **US$ 2,85**; 1 TB + 10 TB ≈ **US$ 15,21**. O armazenamento não é o risco desta frente — o risco é operacional: worker, retenção e cota.

---

## 4. Tela: o que o wireframe já resolve

Conforme a regra de fidelidade visual do `AGENTS.md`, as seções implementadas são citadas pelo título exato em `docs/wireframes/alva-studio-ui-reference.html`. Descrição bloco a bloco, para reproduzir sem interpretar.

### Seção "Configure sua VSL" (view `#view-vsl-config`) — é aqui que provedor e R2 entram

`main.vsl-config` contém `div.vsl-config-head` e `div.vsl-config-grid`. O grid tem duas colunas: `div.vsl-steps` à esquerda e `aside.vsl-preview` à direita.

Cabeçalho `.vsl-config-head`: `div.eyebrow` "PROJETO · VSL"; `h1` "Configure sua VSL"; `p.helper` "Preencha o essencial em quatro passos e veja como o vídeo ficará."; `button.button.primary` "Salvar VSL".

`.vsl-steps` tem quatro `section.vsl-step` (a primeira com `.active`). Cada uma abre com `div.vsl-step-title` — `span.vsl-step-number` mais um `div` com `<strong>` e `<small>` — seguido de `div.vsl-fields` com `div.field` (`label` + controle):

1. **Vídeo** · "Nome, endereço e tipo do vídeo"
   - "Nome do vídeo" → `input.control`
   - "URL do vídeo" → `input.control`, exemplo `https://cdn.exemplo.com/video.m3u8`
   - "Tipo" → `div.vsl-choice` com três `button`: `HLS` (`.active`), `MP4`, `YouTube`
2. **Visual** · "Escolha a capa e o formato"
   - "Imagem de capa (poster)" → `button.button.dashed` "+ Escolher imagem"
   - "Cor dos controles" → `div.swatch` com `<i>` e o texto `#286EEA`
   - "Proporção" → `div.vsl-choice`: `16:9` (`.active`), `1:1`, `9:16`
3. **Reprodução** · "Defina como o vídeo começa e continua"
   - "Começar sozinho, sem som" → `div.toggle`
   - "Retomar de onde parou" → `div.toggle`
   - `details.vsl-advanced` com `summary` "Opções avançadas" e `p` "Legenda VTT e configurações técnicas do HLS."
4. **CTA** · "Convide a pessoa para o próximo passo"
   - "Texto do botão" → `input.control`; "Destino" → `input.control`; "Mostrar depois de" → `input.control` (`03:00`)

`aside.vsl-preview`: `h2` "Prévia"; `div.vsl-screen` com `span.vsl-play.material-symbols-outlined` = `play_arrow`; `small` "Assim o vídeo aparece para quem visitar sua página. A prévia atualiza conforme você configura."; `button.button.primary` "Salvar e continuar" com `width:100%`.

**Onde provedor e R2 encaixam — o wireframe já resolveu.**
- O seletor de provedor **é** o `div.vsl-choice` do campo "Tipo", passo 1. Ele **já traz `YouTube`** ao lado de `HLS` e `MP4`. Acrescentar `Vimeo`, `Panda` e `Enviar arquivo` é ampliar uma lista existente, não criar componente.
- O envio para o R2 reusa o padrão do passo 2, "Imagem de capa (poster)": `button.button.dashed` com rótulo iniciado por `+`. Mesmo gesto, já aprovado.
- "URL do vídeo" continua sendo o campo de origem: recebe o ID ou a URL colada para provedor, e passa a exibir o nome do arquivo enviado no caso do R2 — mesmo `input.control`.

**Critério visual de que a fonte funciona: o bloco "Prévia".** O texto do wireframe é explícito — "Assim o vídeo aparece para quem visitar sua página. A prévia atualiza conforme você configura." Portanto, trocar o Tipo para YouTube, Vimeo ou Panda, ou concluir um envio R2, tem de fazer `div.vsl-screen` mostrar o vídeo daquela fonte. Prévia que não muda significa fonte que não funciona. Não há critério visual alternativo.

### Seções "VSL de lançamento" e "Estrutura da VSL" (view `#view-vsl`) — o que NÃO muda

`div.project-layout` com `aside.project-sidebar` (nav VSL / Páginas / Quizzes) e `main.project-main`:
- `.project-heading`: `div.eyebrow` "PROJETO · VSL"; `h1` "VSL de lançamento"; `div.domain-pill` com ícone `movie` e o texto "Roteiro em edição"; `button.button.primary` "+ Nova etapa".
- `section.surface`: `.surface-head` com `h2` "Estrutura da VSL" e `button.button` "Prévia"; `p.helper` "Organize a narrativa em etapas claras para revisar, gravar e publicar."; `div.stage-list` com quatro `div.stage-row`, cada um `span.stage-number` + `div` (`strong` + `small` com a faixa de tempo) + `span.status-pill`.

Essa tela é **roteiro e etapas**. Ela não menciona upload, provedor nem armazenamento, e **nada nesta spec a altera**. Provedor e R2 vivem exclusivamente em "Configure sua VSL".

### Ausências verificadas — não invente o que falta

Conferido no arquivo do wireframe:
- A palavra **"armazenamento" não aparece** (zero ocorrências).
- **Não existe barra de progresso de upload.** A única `class="progress"` do arquivo é o medidor de etapa do quiz na microlanding (`div.progress` + `<i>` + `<small>25%</small>`) — outra tela, outra função.
- A única ocorrência de `upload` é o glifo `cloud_upload` no item de navegação "Publicação".

Logo, **o estado do envio precisa caber nos componentes que já existem na seção "Biblioteca visual"**: `button.button.dashed`, `div.field` com `label`, `p.helper` e `span.status-pill` — o mesmo pill de "Revisada / Em edição / Rascunho" usado na Estrutura da VSL. Nada de cor, raio, sombra, família ou tamanho novo. **Barra de progresso, percentual numérico e área de arrastar-e-soltar são elementos novos e precisam de aprovação do dono antes de entrar.** Enquanto não houver aprovação, o envio comunica estado por `status-pill`: `Enviando`, `Pronto`, `Falhou`.

O `.estado/<id>.md` do nó de tela precisa nomear a seção conferida e o caminho do screenshot da comparação lado a lado, em desktop e celular, como exige o `AGENTS.md`.

---

## 5. Segurança

- **Validação por provedor, por ID.** Nunca aceitar URL livre. Extrair o ID com regex ancorada e **reconstruir** a URL canônica: YouTube `^[A-Za-z0-9_-]{11}$`; Vimeo `^\d{6,12}$`; Panda ID mais host `vz-` derivado e validado; SmartPlayer `playerKey` alfanumérico. O que vai para o banco é o ID; a URL é sempre derivada.
- **SSRF.** Toda chamada de saída nova — oEmbed, `HEAD` do objeto, API do R2 — reutiliza `resolveAndValidateDestination` (`outbound-webhook.mjs:82-87`) e `pinnedFetch` (`:100-115`), que fixa a conexão no IP já validado e fecha a janela de DNS rebinding entre a checagem e o envio (`:98-99`). Nenhum `fetch` cru novo no servidor.
- **Isolamento.** A chave do objeto é sempre `c/<companyId>/p/<projectId>/v/<uuid>.<ext>`, derivada do contexto da sessão — nunca de caminho enviado pelo cliente. A pré-assinatura só é emitida para essa chave. `getPublicVideo` (`video-repository.mjs:284-298`) continua a única leitura pública e continua removendo `companyId` e `projectId` do DTO.
- **CSP.** Tabela de hosts estática no servidor; o único host dinâmico (Panda) passa pela regex antes de entrar na diretiva.

---

## 6. Nós propostos para o grafo

Texto para o dono aplicar em `produto/grafo.yaml` — **não editado aqui**, outro agente está no arquivo. `midia_cdn` sai e vira estes nós.

### Antes: o formato de `passa_quando` foi verificado, não presumido

Copiei `produto/` para um diretório temporário, escrevi nós de teste e rodei `vibe conferir` nessa cópia. Resultado:

- **`tipo: tela` é reconhecido.** O CLI aceita o nó e cobra `--base-url` ou `base_url` em `produto/config.yaml`. Exige `rota` (string) e `contem_testid` (lista não vazia), **não** `espera` — e casa por `data-testid`, nunca por texto visível. O custo é precisar de um servidor de pé para conferir.
- **`tipo: homologação` NÃO é reconhecido:** `tipo desconhecido ou ausente: "homologação"`. Os únicos tipos válidos são `comando`, `arquivo` e `tela` (`vibe-starter/src/esquema/index.js:220`). **Isso atinge o grafo atual**: `vsl_player`, `vsl_nos_editores`, `publicacao_por_projeto`, `midia_cdn`, `leads_integracoes`, `tracking_analytics`, `cobranca_empresa`, `agentes_mcp` e `worker_webhook` usam `homologação` e **nunca poderão ser conferidos**. Corrigir isso é trabalho separado desta spec, mas precisa entrar na fila.
- **`espera` tem formato fechado:** `ESPERA_REGEX = /^(exit \d+|contem: .+)$/` (`esquema/index.js:9`). Prosa livre é rejeitada — foi o que derrubou `fundacao_saas` no teste (`campo 'espera' invalido`). Todo `espera` abaixo é `exit 0` ou `contem: <texto>`.
- **`tipo: arquivo` exige `caminho` + `casa`** (regex que prova o conteúdo); só existir o arquivo não conta como prova.

Os quatro nós abaixo passaram na validação de forma do `vibe conferir` (nenhum erro `FORMA_*`); falharam apenas no vermelho esperado, por os testes ainda não existirem. O diretório temporário foi apagado e `produto/` não foi tocado.

```yaml
  - id: midia_modelo_dados
    estado: pendente
    faz: Migrar o schema de VSL para aceitar provedores externos e objetos hospedados
    depende:
      - vsl_nos_editores
    produz: Migracao 012 com source_type ampliado, colunas de provedor e de armazenamento, e backfill de published_lock_version
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/database-schema.test.mjs packages/studio/test/vsl-repository.test.mjs
      espera: exit 0

  - id: player_provedores
    estado: pendente
    faz: Extrair o adaptador de midia do player e implementar YouTube e Vimeo
    depende:
      - midia_modelo_dados
    produz: Contrato unico de eventos com adaptadores native, youtube e vimeo, e CSP por provedor
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/vsl-runtime.test.mjs packages/studio/test/vsl-public.test.mjs
      espera: exit 0

  - id: player_panda_embed
    estado: pendente
    faz: Adicionar Panda Video como embed com inicio e fim, declarando que nao ha marcos
    depende:
      - player_provedores
    produz: Adaptador Panda com host vz- derivado do ID, CSP propria e milestones vazio
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/vsl-public.test.mjs
      espera: exit 0

  - id: midia_r2_upload
    estado: pendente
    faz: Hospedar MP4 no bucket da Alva no R2 com upload direto do navegador
    depende:
      - midia_modelo_dados
      - plataforma_superadmin
    produz: Biblioteca por empresa e projeto com URL pre-assinada, HEAD de confirmacao e cotas configuraveis
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/media-r2.test.mjs
      espera: exit 0

  - id: midia_r2_biblioteca
    estado: pendente
    faz: Entregar a tela da biblioteca de midia do projeto
    depende:
      - midia_r2_upload
    produz: Tela com envio, cota restante e lista de objetos do projeto
    passa_quando:
      tipo: tela
      rota: /projetos/{projectId}/midia
      contem_testid:
        - midia-upload-campo
        - midia-cota-restante
        - midia-lista-objetos

  - id: cofre_por_projeto
    estado: pendente
    faz: Dar escopo de projeto ao cofre de segredos, hoje chaveado so por empresa
    depende:
      - publicacao_por_projeto
    produz: company_secrets com project_id, indices unicos parciais e fan-out do segredo Vercel existente
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/publication-service.test.mjs packages/studio/test/database-schema.test.mjs
      espera: exit 0

  - id: midia_r2_conta_cliente
    estado: pendente
    faz: Permitir que o cliente conecte a propria conta R2 em vez do bucket da Alva
    depende:
      - cofre_por_projeto
      - midia_r2_upload
    produz: Credencial R2 por projeto no cofre, com fallback para o bucket da plataforma
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/media-r2.test.mjs
      espera: exit 0

  - id: midia_r2_hls
    estado: pendente
    faz: Converter os MP4 do R2 em HLS por worker ffmpeg fora do processo HTTP
    depende:
      - midia_r2_upload
    produz: Playlist e segmentos em prefixo irmao, com promocao de r2 para r2-hls so apos sucesso
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/media-hls-worker.test.mjs
      espera: exit 0
```

---

## 7. Fases, critérios de aceite e riscos

| Fase | Nó | Critério de aceite testável |
| --- | --- | --- |
| 0 | `midia_modelo_dados` | `source_type` aceita os oito valores; o `varchar` comporta `smartplayer`; o CHECK de coerência recusa provedor sem ID e `r2` sem `storage_key`; **e o teste prova que nenhuma linha com `published_version_id` fica com `published_lock_version` nulo depois da migração** — é o débito de `009_vsl_published_lock.sql:1`, que hoje faz `vsl-ui.js:3` mostrar VSL antiga como "em dia" mesmo depois de editada. |
| 1 | `player_provedores` | Um teste por adaptador prova que o mesmo controller emite `start`, os quatro marcos, `complete` e `cta_click` em `native`, `youtube` e `vimeo`; a CSP de cada provedor sai da tabela estática e não contém host vindo de entrada do usuário. |
| 2 | `player_panda_embed` | Panda emite `start` e `complete` e **nada mais**; o adaptador declara `milestones: []`; o host `vz-` entra na CSP só depois de casar a regex; nenhum teste afirma marcos. |
| 3 | `midia_r2_upload` + `midia_r2_biblioteca` | As credenciais vêm de `global_secrets`, nunca do ambiente, e sem R2 configurado o upload responde "armazenamento ainda não configurado"; `complete` recusa objeto cujo `HEAD` divirja do tamanho ou do content-type declarados; a chave assinada nasce do contexto da sessão, nunca de caminho do cliente; a cota de empresa bloqueia o envio seguinte; excluir VSL não apaga objeto referenciado por versão publicada; a tela mostra cota restante. |
| 4 | `cofre_por_projeto` + `midia_r2_conta_cliente` | Dois projetos da mesma empresa mantêm credenciais distintas; conectar o segundo não altera o primeiro; o fan-out preserva o acesso de todos os projetos Vercel já conectados; nenhuma linha de `provider='vercel'` sobra com `project_id IS NULL`. |
| 5 | `midia_r2_hls` | Falha do worker deixa o vídeo servível como `r2`; nunca há estado intermediário publicável. |

**Riscos.**
1. **Fidelidade de marcos — decidido, não em aberto.** O Analytics **distingue marcos por adaptador** (decisão do dono, 05/09/2026): o evento carrega o adaptador que o produziu, e a tela diz o que cada provedor entrega. Isso importa porque YouTube só reporta progresso por polling — estrangulado em aba de fundo — e Panda não reporta marco nenhum neste corte. Sem essa distinção, um relatório somaria dados de fidelidade diferente e mentiria. `tracking_coletor` precisa aceitar o campo do adaptador desde o primeiro evento.
2. **Cofre sem escopo de projeto.** Já causou o defeito da Vercel. A decisão de usar o bucket da Alva, com credencial em `global_secrets`, tira esse bloqueio do caminho crítico do R2 — mas o defeito continua de pé para a Vercel até `cofre_por_projeto` sair, e passa a existir uma dependência nova e real de `plataforma_superadmin`.
3. **Worker ffmpeg é infraestrutura nova.** Fila, retentativa e limpeza de parciais são o custo real do HLS — maior que a conta do R2. Por isso é o último nó, e não parte do `midia_r2_upload`.
4. **Duas regex divergentes de VSL no HTML** (`vsl-reference.mjs:64` e `editor-shell.js:236`) continuam de pé e já quebram HTML aninhado. Provedores multiplicam o marcador `data-alva-vsl`; unificar antes da fase 1 evita pagar o conserto várias vezes. *(A revisão pediu trocar a citação para `:235`; conferi o arquivo e `:235` é `const source = String(html ?? '')` — a regex está mesmo em `:236`. Mantido.)*
5. **O catálogo de eventos do Panda está sem responsável.** Nenhuma pessoa foi designada para rodar o teste em conta real, então `player_panda_marcos` não tem data. Isso é aceito: Panda entra sem marcos, como o dono decidiu, e a tela declara isso. O risco é a ausência virar esquecimento e alguém prometer marcos de Panda numa venda.

---

## 8. Fora do primeiro corte

**SmartPlayer (VTurb)** — retirado do escopo inicial por decisão do dono (05/09/2026). Quando voltar, o ponto de atenção é o modo de integração: o fabricante recomenda custom element mais `<script>` no mesmo documento, e existe também um modo iframe. O modo recomendado é o que dói: `/v/<publicId>` roda hoje sob `default-src 'none'; script-src 'self'` (`vsl-public.mjs:19-20`), no mesmo documento que desenha o CTA e lê a chave de retomada do `localStorage`. Admitir script de terceiro ali entrega a ele o CTA, a retomada e o DOM. Duas saídas, a decidir no nó: preferir o modo iframe, ou conter o modo JS em `/embed/v/<publicId>`, num documento dedicado sem CTA e sem retomada.

```yaml
  - id: player_smartplayer
    estado: pendente
    faz: Avaliar e integrar SmartPlayer (VTurb) sem expor o documento do CTA a script de terceiro
    depende:
      - player_provedores
    produz: Adaptador SmartPlayer em modo iframe, ou modo JS contido em documento dedicado
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/vsl-public.test.mjs
      espera: exit 0

  - id: player_panda_marcos
    estado: pendente
    faz: Ligar os marcos 25/50/75/100 do Panda depois de registrar o catalogo de eventos em conta real
    depende:
      - player_panda_embed
    produz: Marcos do Panda equiparados aos do adaptador native, com catalogo documentado
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/vsl-runtime.test.mjs
      espera: exit 0
```
