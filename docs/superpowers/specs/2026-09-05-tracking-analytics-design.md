# Tracking e Analytics no Alva Studio — desenho do nó `tracking_analytics`

## Objetivo

Dar a cada projeto uma medição própria — visitas, origem, UTMs, conversão por conteúdo e marcos da VSL — e transformar essa medição em otimização real de mídia no Facebook, Google, TikTok, LinkedIn e Taboola. O nó está pendente com as duas dependências (`leads_integracoes`, `vsl_player`) concluídas e bloqueia `cobranca_empresa`.

Duas decisões do dono orientam este desenho: o Umami não será um app separado apontado por URL, e a política de eventos deve ser a mais completa possível para otimizar mídia paga.

**A política da seção C foi aprovada pelo dono em 2026-09-05, com três limites fixados.** O canal de conversões envia hashes SHA-256 de e-mail e telefone normalizados mais os click IDs `fbp`, `fbc`, `gclid`, `ttclid` e `li_fat_id`, e nunca PII em claro. **IP e user agent não são enviados** — nem em claro nem de outra forma —, o que reduz de propósito o match quality em troca de risco menor. O consentimento é **opt-in por banner**; cada projeto declara a empresa cliente como controladora e a Alva como operadora, com URL de política de privacidade obrigatória antes da fase de conversões. Como a aprovação já existe, nenhuma fase está bloqueada por decisão pendente — e as fases 1 e 2 nunca dependeram dela, porque o coletor interno e os pixels no navegador não enviam identificador pessoal nenhum.

O nó foi dividido em três, já aplicados a `produto/grafo.yaml`: `tracking_coletor`, `tracking_pixels` e `tracking_conversoes`. `cobranca_empresa` passou a depender de `tracking_coletor`.

## A. Como ler "importar o Umami para dentro do projeto"

### Leitura (i) — vendorizar o código do Umami no monorepo

Trazer o Umami como está: Next.js, React, Prisma, o próprio autenticador, o próprio motor de migração e o próprio painel.

Prós: painel maduro pronto, tracker testado em produção, filtragem de bots e evolução externa que não custa nada.

Contras, medidos contra o servidor atual: `packages/studio` roda `node server/index.mjs` sem framework e sem build, com três dependências de runtime (`grapesjs`, `hls.js`, `pg`) e 46 arquivos de teste em `node --test`. O Umami adiciona um segundo runtime com build próprio e centenas de dependências transitivas. `server/index.mjs` é um `http.createServer` com fronteira pública escrita à mão (host, origem, `Sec-Fetch-Site`, CORS por projeto) — não há montagem de app Next dentro dele, então seriam dois processos e um proxy, quebrando o ciclo único de `startSaaS()`/`close()`. Pior: o Prisma passa a ser uma segunda autoridade de schema sobre o mesmo Postgres, ao lado do migrador com checksum de `server/db/postgres.mjs`, e o modelo `user`/`team`/`website` do Umami duplica `users`, `company_memberships` e `projects`. O isolamento do Studio é estrutural — chaves compostas `(company_id, project_id, id)` e `authorizedProject()` repetido em cada repositório — e não há como impor isso a consultas que o Umami emite por conta própria. O critério de aprovação do nó exige provar que "eventos pertencem ao projeto correto"; sobre um schema que não controlamos, essa prova fica cara.

### Leitura (ii) — coletor interno compatível com o modelo do Umami

Reimplementar o essencial no servidor Node puro que já existe: tabelas `website`/`session`/`event`/`event_data` com os mesmos nomes e semântica, um tracker leve servido de `public/`, um endpoint `POST /api/public/collect` e as telas de leitura no painel que já existe.

Prós: reaproveita o pool, o migrador com checksum, o padrão de isolamento por chave composta, o modelo de capacidades, a fronteira pública de `index.mjs`, o `SecretVault` e o worker de entrega. Nomes compatíveis mantêm a porta aberta para importar ou exportar dados do Umami depois. O custo incremental de dependências é zero.

Contras honestos: painel, agregações e filtragem de bot passam a ser nossos. É trabalho real, não trivial — mas é trabalho no mesmo estilo do que já está feito, e o Studio já tem `studio-dashboard.js` e a visão geral de projeto para receber os números.

### Recomendação

**Leitura (ii).** O ganho da (i) é um painel pronto; o custo é introduzir um segundo framework, um segundo motor de migração e um segundo modelo de identidade dentro de um produto cuja principal qualidade comprovada é o isolamento multiempresa verificado em teste. A troca não compensa. Compatibilidade de schema, não vendorização de código, é o que a decisão do dono realmente pede.

## B. Modelo de dados

Todas as tabelas carregam `company_id` e `project_id`, com `FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)`, como em `pages`, `forms` e `videos`. Toda leitura passa por um `AnalyticsRepository` que chama `authorizedProject()` antes da consulta, como `content-repository.mjs` e `video-repository.mjs`.

- `analytics_websites`: um site por projeto e ambiente. `tracker_public_id` opaco e único globalmente, no mesmo formato de `videos.public_id`. `UNIQUE (company_id, project_id, environment)`.
- `analytics_sessions`: `visitor_hash`, primeiro e último contato, hostname, navegador, sistema, dispositivo, tela, idioma, país/região/cidade derivados no servidor, domínio de referência, as cinco UTMs e os identificadores de clique observados.
- `analytics_events`: `event_at`, `event_type` (`pageview` ou `custom`), `url_path`, `url_query`, referência, `event_name` e `tracking_event_id`.
- `analytics_event_data`: pares chave/valor tipados por evento, no formato `event_data` do Umami.
- `analytics_daily_rollup`: agregação diária por site, rota, origem e evento.
- `analytics_consents`: consentimento por visitante e finalidade, com `granted_at`, `revoked_at` e evidência. Só existe se a seção C for aprovada.

O visitante é identificado sem cookie: `visitor_hash` é o SHA-256 de um sal do dia mais `website_id`, IP e user agent. O sal gira a cada 24 horas e o IP nunca é gravado. Isso mantém o analytics interno fora do território de dado pessoal e satisfaz o critério atual do nó sem negociação.

O endpoint público resolve `tracker_public_id` para empresa e projeto **no servidor**; o corpo enviado pelo navegador nunca carrega `companyId` nem `projectId`, exatamente como `getPublicVideo()` resolve pelo identificador público. Sessão nova a cada 30 minutos de inatividade.

Retenção: eventos e `event_data` por 90 dias, configurável por empresa; agregados diários por 25 meses; consentimentos pelo prazo legal de prova. A limpeza roda como um laço de fundo no mesmo padrão de `startWebhookWorker()`, em lotes, sem bloquear requisição.

### Eventos que já existem e ainda não vão a lugar nenhum

O controlador da VSL já calcula tudo: `public/vsl-player.js:26` emite `start`, `milestone`, `complete`, `cta_click` e `error` por `onEvent`, que tem no-op como padrão (linha 17) e nunca recebe um destino em `mountVslPlayer` (linha 123). Ligar esse callback ao tracker entrega `vsl_start`, `vsl_progress` (25/50/75), `vsl_complete`, `vsl_cta_click` e `vsl_error` com `publicId` e `versionNumber`, sem URL de mídia. No mesmo passo é preciso corrigir `server/vsl-public.mjs:43`, que fixa `milestones: [25, 50, 75, 100]` e descarta o valor configurado e versionado da VSL.

O formulário público emite `form_start` na primeira tela, `form_step` a cada avanço e `form_submit_attempt` no envio, a partir do runner de `server/dynamic-form.mjs`. Apenas identificador e tipo do elemento — nunca o valor respondido. O evento `lead` é emitido **pelo servidor**, depois que `submitPublishedForm` persiste a submissão, e usa o `tracking_event_id` que já existe em `form_submissions` como chave de deduplicação entre navegador e servidor.

## C. Otimização para plataformas de anúncio

São dois canais complementares, e a deduplicação entre eles é o `tracking_event_id`.

**Pixels no navegador, por projeto:** Meta Pixel, GA4 via gtag, TikTok Pixel, LinkedIn Insight Tag e Taboola. Configurados na tela de integrações do projeto e injetados pelo publisher em todas as rotas do snapshot, no `/f/...` e nunca dentro do player — a spec da VSL já fixou "sem pixel paralelo dentro do player", e essa decisão continua valendo.

**APIs de conversão no servidor:** Meta CAPI, Google Enhanced Conversions for Leads, TikTok Events API, LinkedIn Conversions API e Taboola S2S. Todas disparadas pelo worker que já existe — `webhook_deliveries` e `webhook-worker.mjs` já entregam fila durável, lease com `FOR UPDATE SKIP LOCKED`, backoff de 30s a 12h, seis tentativas, dead-letter e revalidação de destino contra rebinding. Uma segunda fila `conversion_deliveries` com o mesmo formato reaproveita o motor inteiro; o que muda é o payload e a credencial.

### O que "completo" significa nessas plataformas

Match quality alta não é mandar mais eventos: é mandar mais **identificadores por evento**, e eles vão hasheados.

- `em` = SHA-256 do e-mail em minúsculas e sem espaços nas pontas.
- `ph` = SHA-256 do telefone em E.164, só dígitos, sem `+`.
- `fn` / `ln` = SHA-256 do nome em minúsculas, sem acento.
- Identificadores de clique e navegador, que **não** são hasheados porque já são opacos: `fbp`, `fbc`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `ttp`, `li_fat_id` e o click id da Taboola. São capturados pelo tracker a partir da URL de entrada e do cookie de primeira parte.
- `event_id` = `tracking_event_id`, para o evento do servidor deduplicar contra o do pixel.
- `event_source_url` e `action_source: website`.
- `client_ip_address` e `client_user_agent` — **decisão do dono: não enviar.** As plataformas exigiriam esses dois em claro, e é justamente o item que mais eleva match quality; o dono optou por abrir mão dele. O canal server-side fica restrito a hashes e click IDs, e o payload nunca carrega IP nem user agent, nem em claro nem derivado. Testes de contrato devem falhar se qualquer um dos dois aparecer no corpo enviado.

Nada disso trafega em claro. O texto original do e-mail e do telefone nunca sai do banco: o hash é calculado no worker, no momento do envio, a partir da submissão já persistida.

### Mudança de política — aprovada em 2026-09-05

> **Regra anterior**, em `packages/studio/README.md` e no critério do nó original em `produto/grafo.yaml`:
> "Nome, e-mail, telefone e respostas abertas não devem ser enviados a Analytics ou logs."
>
> **Regra vigente:** o analytics interno permanece exatamente como estava — zero PII nas tabelas, nas URLs, nas UTMs e nos logs. Existe um canal **separado e explícito** de conversões de mídia que envia hashes SHA-256 de e-mail e telefone normalizados, mais os click IDs, apenas no servidor, apenas para submissões com consentimento publicitário opt-in registrado, nunca em texto claro, e **sem IP nem user agent**.

O texto do README já foi reescrito nesse sentido, e o critério migrou para os `passa_quando` dos três sub-nós. A aprovação era necessária porque hash não é anonimização: um SHA-256 de e-mail é dado pessoal pseudonimizado sob a LGPD — reversível por dicionário quando o universo de valores é conhecido —, e o artigo 12 só exclui do escopo o dado efetivamente anônimo. O que isso impõe ao desenho:

- É um **novo tratamento**, com nova finalidade (otimização publicitária) e novos destinatários. A base legal é o consentimento (art. 7º, I), coletado **opt-in por banner**, jamais presumido.
- Há **transferência internacional** (art. 33) para Meta, Google, TikTok, LinkedIn e Taboola, que precisa constar do aviso de privacidade de cada projeto.
- A Alva atua como **operadora** por conta da empresa cliente, que é a **controladora**. Cada projeto declara seu controlador e a URL da sua política de privacidade, e essa URL é **obrigatória** — sem ela, `tracking_conversoes` não envia nada para aquele projeto.
- Sem consentimento gravado, o evento ainda vai, mas sem qualquer identificador pessoal: só click ID e `event_id`. Revogar o consentimento interrompe o envio de hashes a partir da submissão seguinte.

## D. Credenciais, capacidades, superfícies e CSP

**Credenciais.** Tokens e access tokens das cinco plataformas vão para o `SecretVault` já existente, cifrados em AES-256-GCM. Há um bloqueio a resolver antes: `company_secrets` tem chave `(company_id, provider, secret_name, key_version)` e `ProjectIntegrationRepository.save()` grava `secret_name` fixo em `'access_token'`, então dois projetos da mesma empresa se sobrescrevem. Para cinco provedores por projeto isso é inviável — o endereçamento do cofre precisa incluir o projeto antes da fase 3. Configuração não sensível (pixel id, measurement id, advertiser id) fica em `project_integrations`, por provedor, como já ocorre com a Vercel.

**Capacidades.** `analytics.read` já existe em `server/domain/access.mjs:27`, mas só `analyst` a possui — proprietário e administrador não conseguem ler o próprio analytics. Corrigir: `analytics.read` para proprietário, administrador, editor e analista. Para escrever a configuração de pixels e conversões, reutilizar `integration.manage`, que já é a capacidade de proprietário e administrador para Vercel e webhook — não criar capacidade nova.

**Superfícies públicas novas.** `GET /tracker.js` entra no mapa estático de `index.mjs`, como `/vsl-player.js`. `POST /api/public/collect` precisa de um predicado próprio na fronteira de `index.mjs`, isento da checagem de origem e de `Sec-Fetch-Site` como já são `publicVsl` e `publicProjectSubmission`, com CORS restrito às origens de `content.publicationOrigins()` mais os domínios verificados, `OPTIONS` respondendo 204, e teto de corpo de 64 KB — não os 5 MB de `publicAnswers`. Precisa aceitar `text/plain`, porque é o que `navigator.sendBeacon` envia. O limitador de taxa **não pode** ser o de `auth.mjs:77`: aquele é por IP, tem teto global de 1024 entradas e seria esgotado por tráfego público legítimo em minutos.

**CSP da página da VSL.** Hoje é `default-src 'none'; script-src 'self'` e continua assim; só o `connect-src` ganha a origem do Studio, porque o embed em domínio do cliente posta cross-origin. Nenhum pixel de terceiro entra ali — a spec da VSL já fixou isso e a decisão continua valendo.

### CSP das páginas `/f/...` — decidida antes de o tracker existir

`renderDynamicForm` hoje devolve `Content-Type`, `Cache-Control` e `X-Frame-Options: SAMEORIGIN`, e **nenhum** `Content-Security-Policy`, servindo um `<script>` inline com o runner do formulário e um `<link>` de fonte do Google. Injetar `tracker.js` numa página sem CSP seria acrescentar superfície antes de fechar a que já está aberta. Por isso a CSP entra **na fase 1, junto com o tracker, e não na fase 2 com os pixels** — é pré-requisito, não consequência.

A política é montada por resposta:

- **Nonce por resposta.** Um nonce de 16 bytes aleatórios é gerado a cada render, aplicado ao `<script>` do runner e emitido em `script-src 'nonce-<valor>'`. Nada de `'unsafe-inline'`, nada de hash estático — o runner é template literal e muda com o conteúdo do formulário, então hash quebraria a cada edição. O `tracker.js` é servido de `'self'`, como `/vsl-player.js`.
- **Base fechada, sem pixel habilitado:** `default-src 'none'`; `script-src 'self' 'nonce-<valor>'`; `style-src 'self' 'unsafe-inline'` (o CSS já é inline e é gerado pelo servidor, não pelo usuário); `img-src 'self' data: https:` (mídia do formulário é URL HTTPS validada em `safeUrl`); `media-src https:`; `font-src https://fonts.gstatic.com`; `style-src` adiciona `https://fonts.googleapis.com`; `connect-src 'self'` mais a origem do Studio quando a página está em domínio próprio; `frame-src` só com as origens dos embeds de VSL e vídeo já presentes no schema; `form-action` com a origem da ação de submissão; `frame-ancestors 'self'`; `base-uri 'none'`.
- **Com pixel habilitado**, a allowlist cresce **apenas** com os domínios dos provedores ligados naquele projeto, um conjunto fixo e versionado no código — nunca um campo de texto livre e nunca curinga. Projeto sem pixel publica exatamente a base acima.
- **Ordem de carga:** o nonce libera o runner; o pixel só é inserido depois do consentimento, e a CSP já traz os domínios dele desde o primeiro byte, porque a política é imutável depois de enviada. Habilitar um provedor sem que seu domínio esteja na allowlist é um defeito de configuração que os testes precisam pegar.
- **Report-only primeiro.** A CSP entra como `Content-Security-Policy-Report-Only` no primeiro corte, com `report-uri` interno, e vira bloqueante depois de uma janela sem violação registrada. Isso evita derrubar formulários publicados de clientes por um domínio esquecido.

## E. Entrega, aceite e riscos

A divisão **já está aplicada** em `produto/grafo.yaml`: o nó `tracking_analytics` foi substituído por três, no mesmo formato dos demais (`id`, `estado`, `faz`, `depende`, `produz`, `passa_quando`), e `cobranca_empresa` passou a depender de `tracking_coletor` em vez do nó inteiro, para não ficar preso à cadeia de consentimento. Depois da divisão, `vibe proximo` libera `tracking_coletor` e `midia_cdn`.

### Como a prova é registrada

`vibe conferir` não reconhece `passa_quando.tipo: homologação` — a mesma limitação já anotada em `.estado/worker_webhook.md`. Os três sub-nós usam portanto `tipo: arquivo`, apontando para `.estado/<id>.md` com um `casa` que só fica verdadeiro depois que a homologação é registrada por escrito, exatamente como `worker_webhook` fez. A prova é **manual e humana** — o julgamento "não há dado pessoal e o evento pertence ao projeto correto" não é automatizável —, mas a frase que a registra é verificável e o `casa` exige a contagem de testes verdes junto. Como manda a regra 2 do projeto, quem constrói não é quem prova. O ciclo do vermelho antes do verde (`vibe conferir <id> --antes`) vale igual aqui.

**1. `tracking_coletor`** — depende de `leads_integracoes` e `vsl_player`, ambos feitos. Coletor interno compatível com o Umami, tracker, `/api/public/collect`, eventos de VSL e formulário, telas de leitura, retenção **e a CSP das páginas `/f/...`**, que é pré-requisito do tracker. Não depende da política da seção C: nada aqui sai do Studio.

Aceite testável: uma empresa não lê evento de outra por nenhum caminho, incluindo `tracker_public_id` forjado; `collect` recusa corpo acima de 64 KB, origem não publicada e `tracker_public_id` inexistente, e aceita `text/plain` do `sendBeacon`; o mesmo IP e user agent produzem `visitor_hash` diferente em dias diferentes; nenhuma coluna de `analytics_*` aceita valor de resposta de formulário; `vsl_progress` dispara uma vez por marco configurado, e o marco configurado — não o fixo de `vsl-public.mjs` — chega ao player; a resposta de `/f/...` traz CSP com nonce e sem `'unsafe-inline'` em `script-src`; a limpeza apaga eventos com mais de 90 dias sem tocar em agregados.

**2. `tracking_pixels`** — depende de `tracking_coletor`. Pixels por projeto, banner e registro de consentimento opt-in, allowlist de CSP por provedor habilitado, injeção no snapshot e no formulário público. Também não depende da seção C: pixel no navegador não recebe identificador pessoal do Studio.

Aceite testável: a CSP emitida contém exatamente os domínios dos provedores habilitados e nada além; projeto sem pixel configurado publica página com a base fechada; sem consentimento registrado, nenhum pixel de publicidade carrega; revogar consentimento para de carregar na visita seguinte; habilitar provedor cujo domínio não está na allowlist falha no teste, não em produção; a página da VSL continua sem qualquer script de terceiro.

**3. `tracking_conversoes`** — depende de `tracking_pixels`. Fila `conversion_deliveries` no worker existente, hashes, click IDs e deduplicação por `tracking_event_id`. A política já está aprovada; o que ainda bloqueia por projeto é a URL de política de privacidade e o endereçamento do cofre por projeto.

Aceite testável: o payload enviado nunca contém e-mail, telefone ou nome em claro, verificado sobre o corpo real da requisição; **o payload nunca contém IP nem user agent, em nenhum campo**; submissão sem consentimento publicitário vai sem `em`/`ph`; projeto sem URL de política de privacidade não envia conversão nenhuma; `event_id` do servidor é igual ao do pixel para a mesma submissão; falha da plataforma respeita o backoff e vira dead-letter na sexta tentativa sem duplicar conversão; o token de um projeto não é legível a partir de outro projeto da mesma empresa.

### Riscos

O maior continua sendo regulatório, mesmo com a política aprovada: enviar hash de e-mail sem consentimento válido gravado é exposição da empresa cliente e da Alva, e nenhuma qualidade de match compensa isso — a verificação do consentimento tem de ser server-side, no worker, nunca uma flag vinda do navegador. Abrir mão de IP e user agent reduz o match rate reportado pelas plataformas; é um custo aceito de propósito, e não deve ser revertido em silêncio por quem for implementar. O segundo risco é o endereçamento do cofre, que hoje não suporta cinco provedores por projeto e precisa ser corrigido antes da fase 3. O terceiro é volume: `analytics_events` cresce muito mais rápido que qualquer tabela atual do Studio, e sem particionamento ou rollup a consulta do painel degrada em meses. O quarto é bloqueador de anúncio e ITP, que reduzem a cobertura do pixel — é justamente o argumento a favor do canal servidor, não contra ele. O quinto é escopo: cinco plataformas em um nó é muito; se for preciso cortar, entregar Meta e Google primeiro e deixar TikTok, LinkedIn e Taboola para um quarto sub-nó.
