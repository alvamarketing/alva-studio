# Auditoria de realidade e rota de conclusão — Alva Studio

Data: 2026-09-06. Documento original de auditoria; não substitui evidência de homologação.
Base versionada: `eec18f651199308bdb4cdb5aa5c7504ebaa6afe5`, branch `codex/alva-studio-commercial-runtime`.

## Conclusão executiva

Há software e integrações aproveitáveis, mas a experiência comercial integrada não está pronta. O projeto não foi inteiramente escrito do zero: usa GrapesJS publicado, imagem oficial do Umami e NVS Core vendorado. A camada de produto cresceu com wrappers, editor próprio de quiz, renderizações paralelas e adaptações de serviços. A evidência de testes locais foi comunicada como conclusão mais ampla do que permite.

Não recomendo apagar o projeto nem iniciar outra arquitetura completa. Recomendo preservar a base, fechar um percurso real de ponta a ponta e limitar alterações a bloqueios desse percurso. A exigência do usuário de compor quizzes com o mesmo editor das páginas deve ser tratada como requisito explícito, não substituída silenciosamente pela existência de várias perguntas/telas.

## Escopo e limites

- Inspeção de código, Git, planos, registros, processos/containers, contagens e estados no PostgreSQL local e navegação do Studio em `127.0.0.1:4178`.
- Nenhuma alteração de código, configuração, credencial, conteúdo ou produção nesta auditoria; somente este registro.
- Alterações pré-existentes de navegação em `app.js`, `index.html`, `studio-dashboard.test.mjs` e um wireframe Analytics/Tracking não rastreado foram preservadas. Não estão certificadas por esta auditoria.
- Durante a auditoria, outra execução consolidou a navegação no commit `3194d54`. A contagem histórica abaixo permanece fixada em `eec18f6`; esta auditoria não criou nem revisou aquele commit. A navegação observada no navegador corresponde à sessão carregada durante a coleta.
- Testes não foram reexecutados: o número anterior de 528 aprovados é evidência histórica, não novo resultado.
- Git registra alterações e datas, não horas de execução nem custo de tokens. Não permite atribuir exatamente as sete horas relatadas pelo usuário.

## Estado observado no ambiente do usuário

O Studio estava rodando na porta 4178. Há containers Umami e NVS associados a ambientes Aurora, mas a existência desses processos não prova que o Studio esteja conectado a eles.

Consulta somente leitura ao banco `alva-studio-local`:

| Item | Estado observado |
|---|---|
| Páginas / quizzes / respostas | 2 / 1 / 0 |
| Bindings Umami/NVS | 4, todos `pending`, zero tentativas |
| Jobs de provisionamento | 4 `queued`, zero tentativas |
| Websites analíticos | preview e production com `cutover_at` nulo |
| Destinos de tracking / outbox comercial | 0 / 0 |
| Integrações de publicação / deployments | 0 / 0 |
| Assinaturas / chaves MCP | 0 / 0 |

No navegador, Analytics leva ao resumo com “Coletor legado · migração pendente”. Rastreamento abre a lista “Nenhuma conversão enviada”, sem a experiência de configuração de motores/destinos. A publicação solicita conexão Vercel e os botões de preview/produção ficam desabilitados. Esses fatos comprovam que o percurso comercial não está operante neste ambiente; não provam que os serviços correspondentes estejam ausentes no código.

## O que foi construído e o que falta

| Área | O que existe | O que falta para considerar entregue |
|---|---|---|
| Landing pages | GrapesJS 0.23.6, blocos, seleção, serialização, versões, shell e exportação | Corrigir restrições do wrapper; demonstrar editar → salvar → reabrir → publicar com o mesmo conteúdo e formulário operacional |
| Quiz | Editor próprio, topo e telas, elementos tipados, schema, versões, runtime público e respostas | Atender o requisito de composição no mesmo editor; eliminar divergência de prévia; demonstrar jornada completa |
| Umami | Imagem oficial, bootstrap, cliente, gateway, provisionamento e leitura de agregados | Conectar o ambiente do usuário, concluir provisionamento/cutover e apresentar página de Analytics utilizável |
| NVS/Tracking | Core existente, gateway HMAC, propriedades, outbox, destinos e consentimento | Processar jobs reais locais, configurar destinos pela interface e provar evento e resultado do processamento |
| Publicação | Snapshot por projeto, rotas e integração Vercel | Homologação em staging; conexão não configurada no ambiente observado |
| Asaas | Cliente, checkout recorrente, webhook/reconsulta, estados, limites e cancelamento | Homologação de checkout/webhook/cancelamento no Sandbox; não reconstruir |
| MCP | Endpoint e chaves limitadas por projeto, leitura e rascunhos | Demonstrar cliente MCP real conectado ao Studio criando e reabrindo um rascunho; não reconstruir |
| VSL | Player por URL, controles, CTA, referências, embeds e eventos | VSL própria completa não homologada; upload/R2/FFmpeg/HLS permanecem V2 |

## Evidências de arquitetura

- `packages/studio/package.json:16`: dependência de GrapesJS. `public/editor-shell.js:667`: inicialização do motor. O bundle servido vem de `node_modules`, não de uma reescrita do core (`server/index.mjs:360`).
- `runtime/Dockerfile.umami:1`: imagem oficial Umami 3.3.1 fixada por digest.
- `runtime/nvs/vendor/VENDOR.md`: NVS Core 0.3.10, origem, hash e separação das adaptações Alva.
- `public/forms.js:48`, `:540`, `:596`: elementos, editor e prévia próprios de quiz. `server/dynamic-form.mjs:106`: renderização pública separada.
- `public/editor-shell.js:488`: árvore da landing corta cada seção em oito elementos com `slice(0, 8)`. É uma restrição artificial do wrapper, não limitação do GrapesJS.
- `public/app.js:909`: painel analítico consome apenas o resumo. `:1493`: Rastreamento abre filtro de conversões. `server/project-api.mjs:405`: APIs de provisionamento/destinos já existem.
- `server/runtime-worker.mjs:59`: processamento depende da configuração de workers/flags. Defaults desligados são necessários para segurança, mas devem existir instalação e ativação local verificáveis.
- `server/repositories/content-repository.mjs:422`: landing recebe estado editável e HTML separados. Isso exige teste de equivalência do fluxo; não é prova de corrupção nos dados atuais.

## Por que os gates anteriores não bastaram

1. A matriz comercial usa PostgreSQL real, mas injeta clientes falsos para publicação, provisionamento e cobrança. Ela comprova contratos e isolamento, não a experiência completa com os serviços conectados (`test/commercial-certification.test.mjs:117`). Esses testes são úteis; a inferência de produto pronto é que estava errada.
2. `.estado/certificacao_comercial_v1.md` continua formalmente `pendente` e lista Vercel staging e Asaas Sandbox. O próprio documento limita o fechamento à validação local.
3. O plano marca tarefas de motores com checkboxes concluídos enquanto `produto/grafo.yaml` mantém runtime/provisionamento/integração pendentes. “Código implementado”, “testado isoladamente” e “operando no produto” precisam ser estados distintos e consistentes.
4. `.estado/wireframe_fidelity.md` declara aprovação ampla, mas referencia relatórios em `/tmp` e não arquiva ali as comparações exigidas pelo AGENTS. As revisões de overflow e navegação não substituem fidelidade visual e funcional de todos os módulos.
5. O ciclo anterior teve sucessivas rodadas de correções, revisões e suíte completa. Os escopos de implementação/revisão não convergiram cedo sobre uma mesma entrega visível, produzindo retrabalho.

## Histórico e VSL: destino do esforço

Até o checkpoint `eec18f6`, são 185 commits totais, 156 tocando `packages/studio`. O pacote Studio tem aproximadamente 34 mil linhas rastreadas, incluindo testes e outros arquivos; o core herdado tem aproximadamente 92 mil. Linhas não medem valor entregue nem representam tudo como código novo.

Há 40 commits distintos tocando o conjunto de arquivos VSL centrais, além de 54 assuntos contendo “VSL”. A janela observada vai de 2026-09-05 02:41:08 até 2026-09-06 13:01:40, horário local. Isso inclui schema, repositório de vídeos, player, controles, configuração, API, embeds, integração nos editores, proteção de referências e publicação. Quatro reversões relevantes aparecem na sequência (`17db316`, `61e5e52`, `d652654`, `6696364`). Não foi ausência de trabalho: foi trabalho fragmentado e retrabalho sem culminar na função que o usuário precisava usar. O histórico não permite confirmar nem repartir exatamente as sete horas relatadas.

Os 528 testes históricos incluem contratos de texto/regex/DOM, unidades de domínio, bancos PostgreSQL efêmeros e HTTP local. A suíte não é composta por 528 jornadas de usuário em navegador. Existem também testes separados com Umami/NVS reais em Docker; sua existência e execução isolada não demonstram o ambiente entregue configurado. Nenhum desses números autoriza chamar a V1 comercial de homologada.

## Rota curta recomendada

### Entrega 1 — Um único ambiente integrado utilizável

Reutilizar `runtime/compose.yaml`, clientes e workers existentes. Identificar qual instalação local será a canônica; reconciliar os containers existentes sem removê-los às cegas. Concluir bindings Umami/NVS nesse ambiente com destinos externos desligados. Provar uma visita real no Umami, uma resposta persistida no Studio e o mesmo evento no NVS com ID persistente. Exibir status e falhas reais no Studio. Isso fecha a integração central antes de acrescentar outras camadas.

Aceite: abrir uma página/quiz de teste, enviar dados fictícios, ver a visita em Analytics, a resposta em Leads e o evento em Rastreamento. A evidência precisa vir do ambiente entregue ao usuário, não somente de uma fixture efêmera.

### Entrega 2 — Um editor de composição e uma experiência publicada coerente

Preservar GrapesJS e corrigir o wrapper que restringe a landing. Para quiz, fazer primeiro uma prova delimitada de duas etapas com topo comum usando GrapesJS, reaproveitando validação, submissões e APIs já feitas. A prova deve salvar/reabrir e executar o quiz público. A equivalência entre componentes e schema tipado precisa ser demonstrada antes de converter o editor inteiro: o schema atual não representa automaticamente composição HTML arbitrária.

Se a prova exigir substituir persistência/runtime inteiros, registrar a incompatibilidade concreta e o custo antes de ampliar. Não vender o editor próprio atual como atendimento ao requisito de editor unificado. Não apagar dados ou manter duas representações canônicas independentes.

Aceite: mesma capacidade de selecionar, mover e estilizar elementos em página e etapa; topo compartilhado; prévia executável coerente com publicação; resposta salva. Remover o corte de oito itens da árvore, mantendo navegação completa.

### Entrega 3 — Interface copiada do contrato aprovado

Usar os dois HTMLs indicados pelo usuário como origem do layout/componentes, ligando dados e ações reais. Fechar Home/Projeto, páginas, quiz e configuração de Analytics/Tracking. A referência Analytics/Tracking foi confirmada pelo usuário após a auditoria e deve ser versionada junto ao contrato visual. Botão precisa abrir sua área operacional; nome e scroll para resumo não bastam.

Aceite: comparação do mesmo estado e viewport com o wireframe; testar também o destino de cada ação. Conteúdo dos clientes não é substituído pelos exemplos do wireframe.

### Entrega 4 — Homologação comercial

Publicar um projeto de staging com duas rotas e verificar leads/tracking. Homologar Asaas Sandbox pelo port existente e testar MCP com cliente real. Rodar a suíte completa uma vez no fechamento do conjunto e guardar evidências duráveis. Produção, cobrança real e DNS continuam fora desta execução até autorização específica.

## Regra de execução para evitar repetir o ciclo

- Um integrador principal, um implementador por bloco e revisão independente limitada ao percurso de aceite.
- Paralelizar somente frentes independentes; não distribuir o mesmo CSS/arquivo entre vários implementadores.
- Checkpoint utilizável e demonstrado ao fim de cada entrega; commit/push somente do conjunto revisado.
- Testes focados durante correções; suíte completa no fechamento ou diante de regressão que a justifique.
- Preservar isolamento, consentimento, segurança e idempotência existentes. Não aprofundar VSL, infraestrutura de mídia ou funções adicionais antes de fechar a V1.
- Não prometer data ou percentual de conclusão com base em quantidade de código/testes. O primeiro percurso integrado revelará o esforço restante com muito mais confiabilidade.

## Escopo confirmado pelo usuário após a auditoria

- Os dois wireframes `docs/wireframes/alva-studio-ui-reference.html` e `docs/wireframes/alva-studio-analytics-tracking-reference.html` foram elogiados e indicados como referência visual desejada.
- Quiz: mesmo editor completo de composição da landing page, sobre GrapesJS, topo compartilhado e ramificações por resposta. Sem sistema geral de pontuação.
- Gráficos: valores manuais e resultados calculados a partir das respostas do quiz. A correção imediata dos blocos da landing cobre valores manuais; vinculação aos resultados pertence à integração do quiz.
- Tracking V1: Meta, Google, TikTok, LinkedIn e Taboola, sem adiar parte dos destinos.
- Primeiro marco: V1 completa para testar com dados fictícios e serviços reais em ambiente de teste, antes de abrir para clientes/cobrança real.
- Reuso adicional avaliado no código real do Aurora em `/Users/taiancarvalho/Documents/Codex/2026-08-30/essa-minha-ag-ncia-quero-construir/aurora`: aproveitar `analytics/journey.mjs` e seus testes; adaptar `journey-read`, instalação e montagem do SVG ao isolamento empresa/projeto/ambiente do Studio. Preservar o outbox, consentimento e adaptadores já existentes no Studio. Não copiar o servidor inteiro nem substituir seu isolamento. Esta avaliação foi estática; não certifica o runtime integrado.
- Estimativa preliminar comunicada: 24–40 horas de trabalho efetivo, aproximadamente 3–5 dias focados; faixa de planejamento, não garantia. Reavaliar após o primeiro percurso integrado. Homologação dos cinco destinos depende de acessos e recursos de teste disponíveis nas contas.

## Definição do produto esclarecida pelo usuário em 2026-09-06

O Studio é um construtor de funis para agências: composição visual e medição no mesmo projeto. Landing e quiz compartilham o editor completo; a landing apresenta uma página contínua, enquanto o quiz apresenta etapas com respostas, ramificações e oferta final. Depoimentos, imagens, gráficos e vídeos incorporados são conteúdo de composição. O player próprio permanece adiado para V2, com mídia desligada por padrão.

O gráfico deve oferecer configuração compreensível: categorias e valores ou uma parte de um total. Exemplo: 30 de 50 corresponde a 60% preenchido e 40% restante. Valores também poderão derivar de respostas do quiz; isso não implica criar um sistema geral de pontuação. O conserto imediato de renderização não certifica esse editor de configuração nem a vinculação de cálculos.

O projeto reúne conteúdo, rotas, domínio, publicação e destinos de medição. Duplicar um projeto deve acelerar a reutilização do funil, mantendo o isolamento e exigindo identificação explícita dos destinos do novo cliente; nunca encaminhar seus eventos silenciosamente ao pixel de outro cliente.

O aceite central é um percurso executado no Studio: duplicar projeto → configurar destinos → montar landing/quiz → salvar e reabrir → publicar no ambiente de teste → responder → consultar visita no Analytics, lead salvo e estado de entrega no Rastreamento. Umami é a fonte de navegação; NVS processa eventos comerciais. A instrumentação dos eventos padrão é integrada, com consentimento e estados de falha visíveis. Código, flags ou testes isolados não substituem essa prova.

## Checkpoint de execução aprovado na conversa

O estado foi preservado. Em 2026-09-06, gráficos, árvore e controle de cor receberam correções focadas; o Chromium confirmou a proporção 60/40 do gráfico circular, persistência após salvar/reabrir, sincronização HEX/amostra com undo e rolagem da seleção da árvore. Após reload, confirmou Topo com 2 itens, Abertura com 8 elementos e Elementos soltos com 3; selecionar um gráfico abriu o inspector Gráfico circular com Concluído 30 e Restante 20. No bundle final, o arraste de P imediatamente depois de H1 entre cinco irmãos, undo, redo e salvar/recarregar/reabrir preservaram a ordem esperada. A revisão independente dos quatro achados foi aprovada. A suíte release foi concluída com 548/548 testes aprovados, 0 falhas e 0 skips em 43,217 s com Node 24.17.0; `/tmp/alva-editor-suite-release.exit` registra exit 0. A execução anterior com Node 26 travou em `analytics-repository`, foi interrompida e não é resultado válido. Isso é evidência automatizada e de fluxo editorial, não certificação V1. A tela inteira ainda aguarda evidência de screenshot arquivada e comparação responsiva; cálculos do quiz, wireframe completo, Analytics e o percurso comercial integrado continuam pendentes. Os contratos visuais aprovados continuam sendo [`docs/wireframes/alva-studio-ui-reference.html`](../docs/wireframes/alva-studio-ui-reference.html) e [`docs/wireframes/alva-studio-analytics-tracking-reference.html`](../docs/wireframes/alva-studio-analytics-tracking-reference.html). Este checkpoint não altera planos, grafo ou o estado de entrega de nenhuma etapa.

Ordem de execução aprovada:

1. Preservar o estado atual.
2. Fazer os gráficos funcionarem.
3. Fechar Nome + Valor + Adicionar.
4. Fechar árvore: seleção, drag e undo.
5. Ajustar o inspector ao wireframe.
6. Fechar CRUD e prévia da landing.
7. Compor quiz no mesmo GrapesJS.
8. Implementar ramificações, cálculos e oferta.
9. Fechar duplicação e isolamento de projetos.
10. Fechar Home, bibliotecas, histórico e configuração conforme o wireframe.
11. Fechar publicação, leads, CSV e webhook.
12. Conectar Umami, NVS e runtime.
13. Fechar Analytics completo.
14. Mapear o reuso de Aurora.
15. Fechar a UI de Tracking.
16. Configurar os cinco destinos com consentimento.
17. Portar Asaas e MCP existentes.
18. Certificar a V1.

## Atualização do inspector em fechamento — 2026-09-06

O Chromium confirmou o patch de níveis H1/H2/H3, tipografia, cor e alinhamento, ajustes de fundo, casas decimais e popover de movimento: H1 → H2 → desfazer funcionou; o painel alcançou o viewport mobile sem overflow; o ícone `star` foi desenhado na Prévia usando a fonte já existente. O fluxo abrir popover → selecionar `Flutuar` → salvar → reabrir preservou `data-alva-motion="float"`; Escape e segundo clique restauraram o foco. `/tmp/alva-inspector-review.md` foi aprovado pelo revisor Terra.

A suíte final `/tmp/alva-inspector-suite-release.log` concluiu com 550/550 testes, 0 falhas, 0 skips, 43.913,101 ms e exit 0. Isso é evidência automatizada e não certifica a Etapa 5 nem a V1. A comparação lado a lado com o wireframe completo continua bloqueada pela URL policy e pela ausência de screenshot arquivado; as pendências das Etapas 6–18 permanecem.

---

## Checkpoint delimitado — realidade do catálogo VSL e formulários (2026-09-06)

Este bloco é uma atualização localizada da auditoria. Preserva a conclusão executiva e não altera o diagnóstico de que a experiência comercial integrada permanece não homologada.

- A correção de usabilidade removeu a falsa classificação de nós `TEXT` como VSL em `createVslComponentType.isComponent`: a checagem agora exige `hasAttribute(...) === true`. O `alva-field` original foi preservado, sem inferência de labels ausentes.
- A edição de text nodes agora é segura e ao vivo; a FAQ permite editar o resumo `Pergunta` preservando a resposta; `Seção`, `Grupo` e `Duas colunas` exibem rótulos corretos.
- `normalizeForms`/`syncFormDelivery` são idempotentes e não criam histórico para no-op. O problema final de redo foi atribuído à restauração da seleção após undo, que gerava `remove/add` e truncava a coleção selecionada; `UM.skip` síncrono foi limitado aos dois handlers de `restoreTreeSelection`, sem pausa global nem espera assíncrona.
- O catálogo real GrapesJS com VSL/alva-field cobre 14 IDs e save/reopen/style. O caso `parentDIV` → botão/form cobre o controle negativo sem skip e o positivo com skip. A QA de navegador na cópia “Validação — blocos” preservou o original `aaa`, confirmou “Ver a oferta”, os labels “Seu nome”, “E-mail” e “WhatsApp”, e a FAQ “Como funciona a contratação?” com resposta preservada.
- A revisão independente `/tmp/alva-catalog-review.md` foi atualizada e aprovada funcionalmente após a QA limpa. A suíte release final, executada com Node 24.17.0, concluiu 553 testes, 553 aprovados, 0 falhas, 0 cancelados, 0 skips e 0 todo, em 50.592,41825 ms (~50,6 s); `/tmp/alva-catalog-suite-release.exit` registra exit 0 e o log está em `/tmp/alva-catalog-suite-release.log`.

Limites desta atualização: não certifica a Etapa 6 inteira nem a V1; não há captura local da landing com conteúdo (somente webhook externo), nem certificação de upload/publicação, E2E integral do catálogo ou QA de navegador para todos os 14 IDs. Screenshots lado a lado arquivadas e URL policy continuam pendentes. Cálculos do quiz, Analytics e demais etapas permanecem fora do escopo. As seções `Estrutura`, `Conteúdo` e `Biblioteca visual` foram preservadas, sem redesenho.

---

## Estado atual — captura de Landing e Leads (2026-09-06)

Esta seção atualiza somente o estado correspondente; o histórico e as conclusões anteriores deste documento permanecem identificados acima.

- O backend agora cobre UUID estável, snapshot por versão, `page_submissions`, outbox/webhook e resolução no mapa de conteúdos/gateway HTTP. A captura é independente dos pixels e demais destinos de tracking.
- Leads e CSV usam `sourceKind`, `sourceId`, `sourceVersionId` e `captureId`, com rótulos de campos históricos; nomes de conteúdo usam o valor atual quando a versão não tem nome. O frontend filtra origens no bloco existente **“Conteúdos do projeto”**, sem redesenho.
- O teste integrado banco + HTTP passou e quatro UUIDs permaneceram persistidos após salvar/reabrir. A suíte full com Node 24.17.0 concluiu 574 testes aprovados, 0 falhas e 0 skips em 42.602,97325 ms; log em `/tmp/alva-capture-suite-release.log` e exit 0. Esse run ocorreu antes dos últimos ajustes de acesso/modo Leads; depois deles, os testes focados passaram 6/6, o `node --check` passou e a QA manual confirmou o fluxo.
- A revisão independente `/tmp/alva-capture-final-review.md` aprovou o bloco e o status do webhook foi corrigido com consulta à fila. Isso não afirma idempotência de POST repetido pelo usuário.
- O servidor do Studio foi reiniciado na sessão 51020, as migrações aditivas 019/020 foram aplicadas e `/health/ready` respondeu 200. O banco local não foi reiniciado.
- A QA no navegador confirmou clique em LEADS → lista, título/origem, seleção de quiz, CSV e retorno para “Conteúdos do projeto”. O ambiente do usuário tem 0 leads; dados fictícios foram validados em banco descartável + HTTP.
- Publicação na Vercel e egress real não foram feitos. Quiz compartilhado e etapas 7–18 continuam pendentes. Não há certificação V1, produção externa ou comparação de screenshots arquivada.
- Pendência técnica para o deploy: `PublicationService.production` compara `preview.snapshotHash` com o hash de produção, mas os testes read-only confirmaram que a mesma fórmula com nonce HTML por ambiente gera hashes diferentes. É preciso separar a impressão de conteúdo comparável do `snapshotHash` de deploy antes da Vercel; o isolamento do `SnapshotHMAC` deve permanecer. Esta correção não foi feita neste bloco.
