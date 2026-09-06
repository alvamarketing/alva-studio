---
no: certificacao_comercial_v1
status: pendente
atualizado_em: 2026-09-06
---

# Certificação comercial V1

## Evidência local concluída

A matriz descartável `packages/studio/test/commercial-certification.test.mjs`
foi executada com PostgreSQL efêmero. Ela cria dois tenants e percorre criação,
provisão com clientes falsos, publicação falsa, visita, lead, conversão,
cobrança falsa e MCP. A execução confirma isolamento entre tenants, mantém as
flags comerciais desligadas por padrão e preserva a última publicação pronta
quando a publicação seguinte falha.

Os dois tenants percorrem página, quiz, prévia, submissão e checkout próprios.
As tentativas cruzadas de publicação, rota pública, outbox, cobrança e MCP são
recusadas ou retornam somente o escopo correto. Após uma submissão `pending` e
outra `denied`, a matriz lê o `payload` persistido em
`nvs_commercial_outbox`: `tracking_event_id` e `fbc` permanecem, enquanto nome,
e-mail, telefone, respostas e hashes — inclusive aninhados — não aparecem.

O banco efêmero da matriz também foi submetido a backup, mutação e restauração
reais de uma tabela descartável por `pg_dump` e `psql`. Além disso,
`runtime/backup-restore-local-test.sh` subiu somente Studio PostgreSQL, Umami
PostgreSQL e NVS MariaDB em um projeto Docker isolado, criou probes distintas,
validou `SHA256SUMS`, alterou as três e restaurou os valores originais com
`backup.sh` e `restore.sh --confirm-restore`. O ensaio confirmou que nenhum
writer que não estivesse ativo foi criado. Nenhum container existente foi
alterado. Não houve produção, DNS, Vercel, Asaas, credencial real, cobrança
real ou egress.

## Inventário de segredos

O inventário local é somente de nomes, localização e finalidade, em
`runtime/commercial-local-certification.mjs`. Entre os nomes tratados estão
`STUDIO_DATABASE_URL`, `TRACKING_MASTER_KEY`,
`ASAAS_SANDBOX_API_KEY` e `ASAAS_PRODUCTION_API_KEY`. Nenhum valor é registrado
neste arquivo, nos testes ou em logs.

## Fora do escopo da V1

VSL própria pertence à V2. Player próprio, upload, R2, HLS e processamento não
fazem parte da certificação comercial inicial. `MEDIA_PIPELINE_ENABLED` fica
desligada por padrão e não há anúncio de VSL ativa.

## Revisão visual independente — primeira passagem bloqueada

Em 2026-09-06, a revisão foi executada em uma instância efêmera do Studio com
conta, empresa, projeto, duas páginas e um quiz fictícios. O servidor usou a
porta local 4189 e um PostgreSQL descartável; nenhum container existente,
produção, DNS, Vercel, Asaas ou credencial real foi usado.

Foram conferidas as superfícies de login, início, projeto, páginas, quizzes,
histórico e configurações nos viewports 1440×900 e 390×844. As evidências estão
em `docs/wireframes/alva-v1-<view>-desktop.png` e
`docs/wireframes/alva-v1-<view>-mobile.png`, incluindo `login`, `home`,
`project`, `pages`, `quizzes`, `history`, `settings` e `company`.

Resultado objetivo: não houve overflow horizontal (`scrollWidth` igual à
largura do viewport) nem imagens quebradas nas superfícies capturadas. O
sidebar deslocado para fora da tela no celular estava fechado e corresponde ao
comportamento do drawer, não a overflow do documento. Com
`MEDIA_PIPELINE_ENABLED=false`, o item de menu, o filtro de conteúdo e o texto
de VSL permaneceram ocultos.

Foi encontrado um bloqueio: após abrir Configurações e clicar em “Empresa e
equipe”, `#tab-company` continua com `aria-selected="false"`, o painel
`#panel-company` permanece oculto e `#panel-account` continua aberto. Ao mesmo
tempo, `#panel-vercel` permanece visível enquanto a conta está selecionada,
fazendo o conteúdo Vercel aparecer junto da conta. A evidência visual está em
`docs/wireframes/alva-v1-settings-desktop.png`; o estado semântico foi
confirmado no DOM nos dois viewports. A revisão fica reprovada até a navegação
das abas de configurações ser corrigida e revisada novamente.

## Correção funcional de Configurações

Em 2026-09-06, a seleção das abas passou a operar no container da página de
Configurações. Minha conta, Empresa e equipe e Publicação · Vercel atualizam
`aria-selected`, o alvo do foco no teclado e exibem exclusivamente o painel
correspondente. O teste focado percorre as três abas e confirma que os dois
demais painéis ficam ocultos.

## Revisão visual independente pós-correção — aprovada

Em 2026-09-06, a revisão foi repetida em uma instância efêmera nova, com
PostgreSQL e servidor locais isolados, conta/empresa/projeto fictícios e sem
segredos. As abas Minha conta, Empresa e equipe e Publicação · Vercel foram
abertas em ambos os viewports. Em cada estado, o item ativo manteve
`aria-selected="true"`, somente seu painel ficou visível e os dois demais
ficaram ocultos. Não houve overflow horizontal nem imagens quebradas. Com
`MEDIA_PIPELINE_ENABLED=false`, o menu, o filtro e o texto de VSL continuaram
ocultos.

As 18 evidências visuais da revisão completa são:

- `docs/wireframes/alva-v1-login-desktop.png`
- `docs/wireframes/alva-v1-login-mobile.png`
- `docs/wireframes/alva-v1-home-desktop.png`
- `docs/wireframes/alva-v1-home-mobile.png`
- `docs/wireframes/alva-v1-project-desktop.png`
- `docs/wireframes/alva-v1-project-mobile.png`
- `docs/wireframes/alva-v1-pages-desktop.png`
- `docs/wireframes/alva-v1-pages-mobile.png`
- `docs/wireframes/alva-v1-quizzes-desktop.png`
- `docs/wireframes/alva-v1-quizzes-mobile.png`
- `docs/wireframes/alva-v1-history-desktop.png`
- `docs/wireframes/alva-v1-history-mobile.png`
- `docs/wireframes/alva-v1-settings-desktop.png` — Minha conta
- `docs/wireframes/alva-v1-settings-mobile.png` — Minha conta
- `docs/wireframes/alva-v1-company-desktop.png` — Empresa e equipe
- `docs/wireframes/alva-v1-company-mobile.png` — Empresa e equipe
- `docs/wireframes/alva-v1-vercel-desktop.png` — Publicação · Vercel
- `docs/wireframes/alva-v1-vercel-mobile.png` — Publicação · Vercel

Esta aprovação cobre a revisão visual local. Vercel staging, Asaas Sandbox e
a certificação comercial final continuam sujeitos às pendências externas.

## Fechamento local da V1

Em 2026-09-06, a suíte completa final pós-correções passou com **523/523**
testes. `git diff --check`, sintaxe dos scripts shell, configuração do Compose
e a varredura local de padrões de segredo também passaram sem achados. O
inventário de segredos e a revisão visual local estão concluídos; nenhum valor
sensível foi registrado.

## Bloqueios formais para concluir a certificação comercial V1

- Validar publicação em Vercel de staging com projeto e domínio de staging.
- Validar checkout e webhook no Asaas Sandbox, sem produção.

Produção continua aguardando autorização explícita. A certificação só será
marcada como concluída após as duas homologações externas serem executadas,
revisadas e registradas.
