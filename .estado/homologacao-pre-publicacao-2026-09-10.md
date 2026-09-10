---
no: homologacao_pre_publicacao_2026_09_10
status: pendente
atualizado_em: 2026-09-10
---

# Homologação pré-publicação — 2026-09-10

## Evidência local

Foram executados 109 testes focados locais, em dois grupos: 62 para certificação comercial, captura de landing, runtime/publicação de quiz, snapshot e coleta; 47 para save/reopen, conteúdo de projeto, formulário dinâmico, leads, HTTP de Analytics e provisionamento de tracking. Os grupos concluíram sem falhas. Quando necessário, os testes usaram PostgreSQL efêmero e clientes falsos para Vercel, Umami, NVS e demais provedores. Essa evidência confirma contratos locais e não homologa serviços externos.

Um probe separado usou os motores locais já ativos, PostgreSQL efêmero e credenciais carregadas somente no processo. Os quatro bindings novos (`preview` e `production`, para Umami e NVS) chegaram a `ready`. Um pageview local foi aceito pelo Umami e a leitura da API de métricas respondeu HTTP 200; a contagem não foi registrada. Um evento de lead entrou no NVS, foi deduplicado no outbox e ficou `delivered`; isso confirma somente a ingestão interna, pois não havia destinos externos configurados. O website temporário do Umami foi removido. O NVS não expõe remoção/desativação de propriedades: duas propriedades vazias e um evento local de teste permanecem apenas nos bancos dos motores locais. Nenhum compose foi parado, reiniciado ou resetado.

O pacote de imagem foi revisado em `.dockerignore`, `runtime/Dockerfile.studio` e `packages/studio/pnpm-lock.yaml`. As dependências foram reconstruídas sem cache a partir de `alva-studio-prod-deps-audit:20260910`; a imagem final `alva-studio-v1-ready:20260910` foi então validada com o smoke test sem `.env`, `.data`, `test` ou `jsdom`; o lockfile corresponde ao manifesto.

No último ajuste de UI, 20 testes focados passaram e a revisão Terra aprovou o comportamento de `+Nova seção` abrindo a aba Elementos; `quizCanvas` permanece ligado, com captura, retry/deduplicação, Enter e formulário visual preservados. A suíte completa passou com 989/989 testes, sem skip, em 94,9s.

A limpeza autorizada removeu os `.DS_Store` encontrados na raiz do checkout e
no worktree `commercial-runtime`, além do log temporário de verificação. O
backup divergente `packages/studio/.env.bak-20260908104123` foi movido para o
arquivo privado `~/Library/Application Support/Alva Studio/archive/2026-09-10/`
com permissões restritas; nenhum `.env` ativo, `.data`, vendor, banco ou outro
worktree foi removido.

O worktree passou a ignorar `.env`, variantes de backup, `.data` e
`.claude/launch.json`. O CI do Studio cobre `main` e `dev`; os workflows
publicadores legados upstream foram desabilitados com `if: false`, enquanto os
workflows de teste permanecem ativos. `VERCEL_MASTER_KEY` foi ligado ao
Compose, ao exemplo de ambiente e ao contrato de configuração. A consolidação
na `main` prepara o staging, sem declarar homologação externa nem autorizar
produção.

## Verificação no navegador

Com dados fictícios, foi criada uma conta; uma landing “Serviços” foi criada, teve o título alterado, salva e reaberta com persistência; um quiz em branco foi criado, recebeu o campo “Nome para contato”, que foi editado, salvo e reaberto com persistência. A correção da árvore que mascarava esse campo foi revisada por Terra e confirmada no navegador com o campo visível. A prévia explícita não executou formulários ou scripts. Publicação permaneceu desabilitada sem conexão Vercel. O servidor descartável na porta 4178 foi encerrado por cleanup com SIGINT; sua fixture foi removida. Os motores locais e os dados do usuário foram preservados.

Analytics abre a tela completa, mas a fonte ainda indica coletor legado e migração pendente. O cutover do Umami só ocorre depois que o gateway recebe a primeira visita pública (`packages/studio/server/index.mjs`, linha 621); esta observação não classifica o estado como defeito sem essa prova. Tracking mostra cinco destinos sem envios. Filtros de VSL ainda aparecem com a flag desligada, pendência de experiência.

## Bloqueios antes da publicação

O caminho ativo de criação de quiz agora liga `quizCanvas` e a captura foi confirmada nos testes focados e na suíte completa. A ramificação por resposta ainda não está conectada ao novo quiz: o schema/runtime possuem `branching.rules`, mas o editor compartilhado ainda não comprova configuração e preservação dessas regras.

O bloqueio concreto remanescente é conectar e validar a ramificação do quiz unificado, preservando a captura já confirmada.

- Executar uma visita pública em staging, submeter lead e confirmar a chegada no dashboard, no rastreamento e em Meta Test Events.
- Validar no navegador a criação, salvamento, reabertura e ramificação do quiz unificado; a captura já tem cobertura focada, mas segue sujeita à correção dos cinco testes da suíte completa.
- Homologar Vercel staging com domínio próprio e registrar a evidência externa.

## Hospedagem proposta

Para a arquitetura atual, manter Studio, bancos, motores e workers na VPS; usar Vercel para as publicações públicas. Vercel suporta a camada server-side das publicações, mas a validação de staging continua obrigatória antes de produção.

## Nomes públicos e proveniência

Os rótulos visíveis próprios do Studio usam “Analytics” e “Rastreamento”. Chaves, APIs, variáveis, rotas e o snapshot vendorado permanecem com seus identificadores técnicos. O snapshot NVS mantém a atribuição declarada em `runtime/nvs/vendor/VENDOR.md`. A autorização do autor foi informada diretamente pelo responsável pelo Alva Studio; isso está registrado nos avisos públicos em `packages/studio/public/third-party-licenses.html` e `packages/studio/public/third-party-notices.txt`, sem constituir comprovação de licença MIT. Os termos de redistribuição da licença não estão documentados no snapshot.

Este registro não conclui a certificação comercial V1, não autoriza produção e não substitui as homologações externas.
