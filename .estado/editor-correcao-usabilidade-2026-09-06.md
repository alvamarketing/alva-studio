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
