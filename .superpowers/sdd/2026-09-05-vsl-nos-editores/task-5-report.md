# Relatório da Task 5 — UX, capacidades e verificação final

## Implementação

- Os inspetores dos dois editores apresentam VSLs publicadas como opções visuais com ícone, nome e status `Publicada`. A referência continua persistindo somente como `publicId`.
- `video.read` governa a carga do catálogo e a prévia; `page.write` e `form.write` governam seleção, inserção e edição no conteúdo consumidor; `video.write` permanece restrito ao CRUD da VSL; `deployment.publish` bloqueia publicação sem permissão.
- O canvas usa o iframe público compartilhado em proporção 16:9, sem um segundo player ou uma configuração paralela. Referências inválidas exibem `VSL não encontrada. Publique a VSL antes de usar.`; referências vazias orientam `Escolha uma VSL publicada.`.
- Controles de publicação exibem ajuda acionável, mantêm rótulos e ícones acessíveis e ficam desabilitados para papéis sem `deployment.publish`. Inspetores somente leitura desabilitam os campos e ações de edição.
- A revisão de acessibilidade adiciona a opção `Remover seleção`/`Nenhuma VSL` nos dois editores, radios com `aria-checked`, foco roving e setas de navegação. Sem `page.write`, a landing oculta o catálogo e bloqueia inserção, arraste, atalhos de exclusão, reordenação, duplicação e edição inline; a publicação da VSL continua independente de `video.write`.
- A prévia de VSL no formulário usa um container não interativo e um botão separado de `Editar`, deixando o iframe e seus controles acessíveis ao teclado sem aninhamento inválido.
- O campo de avanço após CTA não foi exposto, pois esta entrega não altera a navegação existente do formulário.

## TDD e validação

1. RED — os testes novos falharam por exportações ausentes e publicação ainda liberada sem capacidade.
2. GREEN focal — testes de acesso, editores, dashboard, formulários e VSL passaram.
3. Suíte serial completa — `node --test packages/studio/test/*.test.mjs`: **251 testes, 251 passaram**.
4. Sintaxe — `node --check` nos módulos JavaScript alterados: sem erros.
5. Higiene — `git diff --check`: sem erros.

A homologação visual com mídia real MP4/HLS e publicação em um projeto conectado permanece limitada ao ambiente sem credenciais de projeto e destino de publicação. A verificação automatizada cobre isolamento, referência pública, estados de erro, permissões, teclado e proporção do canvas.
