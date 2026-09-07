# Quiz shared editor implementation plan

**Goal:** preservar o schema semântico do quiz e adicionar snapshots opcionais de canvas por topo/tela no mesmo editor GrapesJS da Landing.

1. Normalizar `headerCanvas` e `steps[].canvas` no JSONB existente, mantendo IDs, choices, required e campos avançados legados; derivar schema do canvas no servidor.
2. Extrair primitives browser-safe do renderer para seed/render sem duplicar HTML, bloqueando scripts e VSL quando a flag estiver desligada.
3. Integrar `createFriendlyEditor` em `forms.js`: uma instância por topo/tela, persistência antes de trocar, árvore `Topo fixo`/`Tela`/`+ Elemento`/`+ Nova tela`, e operações de duplicar/reordenar/excluir.
4. Cobrir legado, reabertura, publicação/resposta, escopos `form.write`, read-only e IDs regenerados na duplicação.

## Andamento 7 — canvas GrapesJS compartilhado (2026-09-07)

O incremento está em andamento. No backend, `server/form-store.mjs`/`server/quiz-canvas.mjs` normalizam e derivam campos de `headerCanvas` e `steps[].canvas`, enquanto `server/dynamic-form.mjs` reutiliza o renderer browser-safe e executa as telas do canvas. No frontend, `public/forms.js`, `public/editor-shell.js`, `public/editor-workspace.js` e `public/quiz-canvas-seed.js` reaproveitam `createFriendlyEditor`, a árvore Topo fixo/Tela e snapshots GrapesJS; a persistência mantém os originais e a cópia usada pela QA do root é apenas uma cópia de trabalho.

As correções verificadas nesta rodada incluem isolamento de telas `.screen.step`, cabeçalho/progresso estável, coleta de `select[multiple]`, validação de grupo `data-quiz-required` aceitando uma opção, e exposição explícita HTTP de `/quiz-canvas-seed.js` e `/quiz-elements.js`. O VSL permanece desligado no caminho do quiz. Os testes focados atuais são 18 de `dynamic-form`, 14 de servidor/rotas e 5 de lifecycle; ainda não houve suíte completa, revisão final, certificação de browser ou commit.

Os helpers de branching e cálculos do bloco 8 ainda não estão integrados. Os quatro motores/containers permanecem ativos no ambiente de desenvolvimento, mas o Studio ainda não está conectado a eles. O próximo incremento deve continuar reversível e cobrir salvar/reabrir uma etapa GrapesJS antes de ampliar a navegação.

## Checkpoint de QA do andamento 7 — 2026-09-07

O browser confirmou uma cópia de trabalho do original preservado: formulário **“Validação — quiz compartilhado”**, ID `3ae986b6-edd1-48f1-a66d-f93517ad76a9`. A etapa “Como prefere conversar?” manteve as opções WhatsApp, Ligação e E-mail, com os ícones chat, phone e mail, após salvar e reabrir pela árvore.

A prévia autenticada abriu o dialog real, permitiu avançar/voltar preservando um telefone fictício e concluiu localmente sem lead; o painel permaneceu com 0 respostas. A fonte local e a sequência do head GrapesJS foram corrigidas. O caminho de vídeo incorporado simples ainda está em implementação.

A suíte registrada em `/tmp/alva-quiz-shared-editor-suite-final.log` concluiu 632/632, 0 falhas e 0 skips em 59.349 ms antes do último ajuste de markup inicial das escolhas; o delta posterior do inspector passou 7/7. Os helpers 8 de branching/cálculos ainda não estão integrados e os motores permanecem desligados do Studio. Este checkpoint não conclui o andamento 7 nem certifica V1.

## Fechamento funcional do andamento 7 — 2026-09-07

O ajuste P1 de título padrão prefixado ao CSS ocorre no carregamento sem PUT; o lifecycle focado passou 9/9. A QA no browser confirmou a pergunta em linha inteira no canvas após reload, sem marcar alteração apenas ao abrir. O fluxo preservou a cópia **“Validação — quiz compartilhado”** e seus IDs, salvou/reabriu as escolhas pela árvore, abriu a prévia autenticada, permitiu voltar e avançar e concluiu sem lead; o painel permaneceu com 0 respostas. O GET real da fonte CORS respondeu 200 e `/health/ready` respondeu 200.

A revisão independente `/tmp/alva-quiz-embed-review.md` aprovou o vídeo incorporado: `about:blank` vazio, HTTPS editável salvo/reaberto, `javascript:` recusado, VSL separado e CSP mantendo `connect-src 'none'`/`form-action 'none'`. A suíte final do conjunto presente no momento foi executada com `pnpm exec node --test --test-concurrency=4 test/*.test.mjs`; concluiu 637/637, 0 falhas e 0 skips em 57.168,614375 ms, com log em `/tmp/alva-quiz-shared-editor-suite-closure.log`. O ajuste do snapshot byte-a-byte refletiu somente a regra CSS de 48 bytes `.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}`; o bloco 8 permanece escopo separado e não integrado ao Studio.

Este é um checkpoint funcional pronto para commit. A certificação visual exata continua pendente: a comparação desktop/mobile com o wireframe segue limitada pela superfície do browser, e o screenshot de 841 px não prova mobile. O bloco 8 não está integrado, a V1 não está concluída e este registro não declara a etapa 7 visualmente certificada.
