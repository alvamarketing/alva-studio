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
