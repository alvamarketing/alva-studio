---
tipo: checkpoint
status: aprovado-com-pendencias
data: 2026-09-06
---

# Checkpoint de correção de usabilidade do editor

Este registro consolida a revisão do wireframe Landing e as correções de editor realizadas em 2026-09-06. É um checkpoint de execução; não é certificação V1.

## Contrato do wireframe Landing

- **Estrutura:** árvore lateral completa para seções e elementos, seleção sincronizada com o canvas, rolagem até o elemento e reordenação entre irmãos. Gráficos aparecem como item atômico; seus `small`, `i` e demais partes internas não viram itens separados.
- **Conteúdo:** inspector contextual do elemento selecionado, com edição de texto, mídia, estilo, movimento e ações de ordem. O fluxo deve preservar seleção, undo e redo.
- **Biblioteca visual:** área lateral de adicionar elementos, com blocos visuais e a mesma linguagem editorial da árvore. A árvore e a Biblioteca fazem parte da mesma experiência de Landing.
- **Padrão de opções Nome/Valor:** gráficos editáveis por linhas compreensíveis de nome e valor, com adicionar/remover e validação. A proporção é calculada a partir dos valores; não depende de sintaxe textual `Nome: valor`.

## Evidências observadas

- No Chromium, o gráfico circular com `30` e `20` mostrou **Concluído 30 / Restante 20**, isto é, 60%/40%. Editar Nome/Valor removeu uma fatia, salvar e reabrir preservou o atributo e os stops calculados, e a prévia manteve o resultado.
- No Chromium, alterar `#203a32` para `#286eea` sincronizou amostra e HEX e o undo restaurou o estado.
- Selecionar um item na árvore rolou o canvas até mostrar o título correspondente.
- A sequência de listeners DOM da árvore foi coberta por 10/10 testes, incluindo `DataTransfer` protegido, target `span`, cálculo por `clientY`, `canMove`, undo/redo, itens atômicos de gráfico e gráficos irmãos após `main` representados em `Elementos soltos` sem reparenting, com as seções reais preservadas e populadas simultaneamente. Após reload no Chromium, a árvore mostrou Topo com 2 itens, Abertura com 8 itens e Elementos soltos com 3; selecionar um gráfico abriu o inspector `Gráfico circular` com `Concluído 30` e `Restante 20`. No bundle final, o arraste de P imediatamente depois de H1 entre cinco irmãos produziu `H1,P,DIV,DIV,A`; undo restaurou `P,H1,DIV,DIV,A`, redo restaurou a ordem movida, e salvar/recarregar/reabrir preservou a ordem.

## Limites deste checkpoint

- Não cobre os cálculos do quiz nem a vinculação de resultados do quiz aos gráficos.
- Não comprova igualdade visual completa com o wireframe nem a experiência completa de Analytics V1.
- A revisão independente `/tmp/alva-editor-sol-review.md` foi aprovada após os quatro achados e o ajuste do slot vazio de `Elementos soltos`. A suíte release foi executada com Node 24.17.0: 548 testes, 548 aprovados, 0 falhas, 0 skips em 43,217 s; `/tmp/alva-editor-suite-release.exit` registra exit 0. Uma execução anterior com Node 26 travou em `analytics-repository`, foi interrompida e não é resultado válido. A suíte release valida o conjunto automatizado e não equivale à certificação V1.
- Para certificar a tela inteira, ainda é necessária evidência de screenshot arquivada e comparação responsiva nos viewports exigidos pelo `AGENTS.md`. As capturas do Chromium usadas nesta revisão permanecem no histórico da ferramenta; nenhum caminho de screenshot é inventado aqui.

## Próximos bloqueios

- Arquivar screenshots e comparação responsiva da tela inteira.
- Fechar cálculos e vinculação do quiz aos gráficos.
- Completar a experiência de Analytics V1 e o percurso integrado de publicação, visita, lead e entrega.

## Motivo da escalada de revisão

A revisão final foi escalada porque uma rodada estática não detectou regressões na ordem de drag, normalização de CSS, ancoragem de inserção e grupo sintético. Esses quatro achados foram corrigidos, revisados e confirmados no bundle final; a homologação de arraste no Chromium agora cobre o fluxo de cinco irmãos descrito acima.

## Revisão independente posterior

`/tmp/alva-editor-sol-review.md` reprovou a integração no estado intermediário por quatro achados, todos posteriormente corrigidos e aprovados:

- o índice de drag “depois” desloca um irmão adjacente além do alvo;
- a normalização pode sobrescrever CSS personalizado válido de gráficos;
- a inserção de blocos pode ancorar em um gráfico descendente quando o selecionado é um contêiner externo;
- `Elementos soltos` usa o wrapper como item selecionável, duplicando seleção e deixando a linha sintética sem ativação válida.

Esses pontos foram corrigidos por Terra/Aurora e a revisão independente foi aprovada. A certificação V1 permanece pendente.

## Auditoria read-only do wireframe Analytics/Tracking

O arquivo não rastreado `docs/wireframes/alva-studio-analytics-tracking-reference.html` foi auditado sem edição. Ele contém somente dados fictícios visíveis, como contagens, IDs truncados e nomes de exemplo; não há credenciais, tokens ou valores secretos. Não há `fetch`, XHR, WebSocket, `sendBeacon`, armazenamento local, cookies, formulários ou endpoints mutantes. O único script alterna telas/abas, abre o menu mobile e atualiza detalhes estáticos de eventos. O arquivo é adequado para versionamento intencional como contrato de wireframe, sujeito às pendências de implementação de Analytics V1.

## Fontes do checkpoint

- `/tmp/alva-editor-review.md`
- `/tmp/alva-tree-fix.md`
- `/tmp/alva-chart-fix.md`
- `/tmp/alva-color-fix.md`

## Checkpoint de fechamento do inspector

- O inspector recebeu níveis H1/H2/H3, tipografia, cor, alinhamento, ajustes de fundo, controle de casas decimais e popover de movimento. O Chromium confirmou H1 → H2 → desfazer, painel acessível no mobile sem overflow e ícone `star` desenhado na Prévia com a fonte já existente.
- O popover aberto → `Flutuar` gravou `data-alva-motion="float"`; salvar, reabrir, Escape e segundo clique restauraram o foco conforme esperado. `/tmp/alva-inspector-review.md` foi aprovado pelo revisor Terra.
- A suíte final de fechamento (`/tmp/alva-inspector-suite-release.log`) concluiu com 550/550 testes, 0 falhas, 0 skips, 43.913,101 ms e exit 0 (`/tmp/alva-inspector-suite-release.exit`). Isso é evidência automatizada, não certificação V1.
- Este checkpoint não certifica a Etapa 5 nem a V1. A comparação lado a lado com o wireframe completo permanece bloqueada por URL policy e pela ausência de caminho arquivado para screenshot. Preservam-se as pendências das Etapas 6–18.

---

## Checkpoint delimitado — correções do catálogo Landing e formulários (2026-09-06)

Este bloco registra somente o estado observado nesta rodada; não substitui os checkpoints anteriores nem certifica a Etapa 6 ou a V1.

- O texto de botão e os labels desapareciam porque `createVslComponentType.isComponent` usava `optional getAttribute !== null`, confundindo nós `TEXT` com VSL (`undefined !== null`). A correção usa `hasAttribute(...) === true`; `alva-field` original foi mantido e não se inferiram labels perdidos.
- `setComponentText` passou a tratar text nodes com segurança e a edição ao vivo. O resumo `Pergunta` da FAQ ficou editável com a resposta preservada. Os contêineres `Seção`, `Grupo` e `Duas colunas` exibem os rótulos corretos.
- `normalizeForms` e `syncFormDelivery` ficaram idempotentes e evitam histórico no-op.
- A causa distinta do Undo final foi isolada: a seleção restaurada após undo gerava `remove/add` na coleção selecionada (`trackSelection: true`), truncando o redo. A correção usa `UM.skip` síncrono somente para `restoreTreeSelection` nos dois handlers, sem `global pause` nem `await`.
- Sol foi escalado depois de Terra; as hipóteses anteriores não resolveram o runtime. O trace local público sem conteúdo confirmou a causa; o trace temporário foi removido.
- O teste do catálogo real GrapesJS com VSL/alva-field cobre 14 IDs, save/reopen/style. O teste com `parentDIV` e filho botão/form comprova o controle negativo sem skip e o positivo com skip.
- QA no navegador, na cópia “Validação — blocos”, preservou o original `aaa`: botão “Ver a oferta”, formulário novo com labels “Seu nome”, “E-mail” e “WhatsApp”, e FAQ “Como funciona a contratação?” com resposta preservada.
- CUA limpa: formulários: excluir → 4, desfazer → 5, salvar, refazer → 4; botão novo `delete → undo presente → save → redo ausente → undo/save`.
- A revisão independente `/tmp/alva-catalog-review.md` foi atualizada e aprovada funcionalmente após a QA limpa. A suíte release final, executada com Node 24.17.0, concluiu 553 testes, 553 aprovados, 0 falhas, 0 cancelados, 0 skips e 0 todo, em 50.592,41825 ms (~50,6 s); `/tmp/alva-catalog-suite-release.exit` registra exit 0 e o log está em `/tmp/alva-catalog-suite-release.log`.

Pendências mantidas: não há certificação da Etapa 6 inteira nem da V1; a captura local da landing está ausente (há somente webhook externo); upload/publicação, E2E integral do catálogo e QA de navegador para todos os 14 IDs não estão certificados; screenshots lado a lado arquivadas e URL policy continuam pendentes; cálculos do quiz, Analytics e demais itens das etapas seguintes continuam pendentes. As seções do wireframe permanecem `Estrutura`, `Conteúdo` e `Biblioteca visual`, sem redesenho.

---

## Checkpoint delimitado — captura de Landing e Leads (2026-09-06)

- Backend implementa UUID estável e snapshot por versão para capturas, `page_submissions`, outbox/webhook e resolução pelo mapa de conteúdos/gateway HTTP. A captura permanece independente de pixels e destinos de tracking.
- Leads e CSV unificam quizzes e capturas de landing por `sourceKind`, `sourceId`, `sourceVersionId` e `captureId`, preservando rótulos de campos históricos; nomes de conteúdo usam o valor atual quando a versão não tem nome.
- O frontend usa o bloco existente **“Conteúdos do projeto”**, com filtro por origem/captura e sem novo layout ou token.
- O teste integrado de banco + HTTP passou e quatro UUIDs permaneceram persistidos após salvar/reabrir. A suíte full com Node 24.17.0 concluiu 574 testes aprovados, 0 falhas e 0 skips em 42.602,97325 ms; log em `/tmp/alva-capture-suite-release.log` e exit 0. Esse run ocorreu antes dos últimos ajustes de acesso/modo Leads; depois deles, os testes focados passaram 6/6, o `node --check` passou e a QA manual confirmou o fluxo.
- A revisão independente `/tmp/alva-capture-final-review.md` aprovou o bloco e o status do webhook foi corrigido com consulta à fila. A evidência não afirma idempotência de POST repetido pelo usuário.
- O servidor do Studio foi reiniciado na sessão 51020, as migrações aditivas 019/020 foram aplicadas e `/health/ready` respondeu 200; o banco local não foi reiniciado.
- A QA no navegador confirmou LEADS → lista, título/origem, seleção de quiz, CSV e retorno para “Conteúdos do projeto”. O ambiente do usuário tem 0 leads; os dados fictícios foram validados em banco descartável + HTTP.
- Publicação na Vercel, egress real, quiz compartilhado e etapas 7–18 continuam fora do fechamento. Não há certificação V1, produção externa ou comparação de screenshots arquivada.
- Pendência técnica para o deploy: `PublicationService.production` compara `preview.snapshotHash` com o hash de produção, mas os testes read-only confirmaram que a mesma fórmula com nonce HTML por ambiente gera hashes diferentes. É preciso separar a impressão de conteúdo comparável do `snapshotHash` de deploy antes da Vercel; o isolamento do `SnapshotHMAC` deve permanecer. Esta correção não foi feita neste bloco.
