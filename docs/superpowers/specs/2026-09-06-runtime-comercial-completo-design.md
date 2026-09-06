# Alva Studio comercial completo — design

## Objetivo

Entregar o Alva Studio V1 como a única interface para páginas, quizzes, analytics, tracking, conversões, cobrança e agentes. A VSL própria pertence à V2. Umami 3.3.1 e NVS Core
0.3.10 rodam como motores internos gerenciados. Na V1, referências VSL existentes
são preservadas, sem player próprio, upload ou pipeline de mídia; esses componentes
pertencem à V2.

## Arquitetura

- Coolify executa `studio-web`, `studio-worker`, PostgreSQL do Studio, Umami com
  PostgreSQL próprio e NVS PHP com MariaDB próprio na V1. O `studio-media-worker`
  é reservado para a V2. Os bancos e painéis administrativos não são públicos.
- Vercel hospeda somente snapshots de páginas e quizzes. Cada publicação leva
  um manifesto imutável com `publicationId`, `snapshotHash`, política e IDs
  públicos dos motores daquele projeto e ambiente.
- Cada `project + environment` possui um website Umami e uma propriedade NVS.
  O Studio provisiona, consulta e monitora ambos sem devolver credenciais ou
  identificadores administrativos ao navegador.
- Umami é a autoridade de pageviews, sessões, origens e UTMs. NVS é a
  autoridade de eventos comerciais, identidade, deduplicação e fan-out.
- Na V1 não há upload próprio, R2, FFmpeg/FFprobe, player próprio ou HLS. A V2
  poderá adicionar armazenamento e renditions imutáveis sem alterar páginas/quizzes
  já publicados.

## Regras de produto

- O cliente usa apenas o Studio. Não há link para painel Umami, NVS ou VTurb.
- NVS preserva o Core real 0.3.10 em sidecar PHP/MariaDB. O Viewer separado não
  entra no produto.
- Referências e eventos VSL existentes continuam compatíveis, mas ficam fora da
  certificação V1. Player próprio, progresso e compatibilidade de mídia serão
  especificados na V2.
- Pixels publicitários carregam somente em produção e após opt-in. Um único
  `tracking_event_id` une navegador, lead persistido e conversão server-side.
- Produção, DNS, R2 e Asaas real continuam atrás de homologação explícita.
- O coletor Node atual vira arquivo histórico por 90 dias após o corte; não há
  dual-write permanente nem importação semântica para Umami.

## Corte V1/V2

A V1 não inclui player próprio, upload, armazenamento R2, transcodificação FFmpeg ou entrega HLS. Referências e eventos VSL já existentes permanecem compatíveis e documentados, mas não bloqueiam a certificação V1. Esses itens formam a V2.

## Política de consentimento para conversões

Eventos comerciais/NVS sempre podem ser emitidos nos estados `pending`,
`denied` e `granted`. `pending` e `denied` permitem somente evento,
`tracking_event_id`, tempo, conteúdo, valor/moeda e IDs pseudônimos de
atribuição aprovados: `fbc`, `fbp`, `gclid`, `gbraid`, `wbraid`, `ttclid` e
equivalentes explicitamente allowlisted. Não permitem PII direta nem hash.
`granted` permite hashes normalizados, gerados exclusivamente no servidor.
O browser nunca declara consentimento nem envia hash.

Cada adaptador recebe o estado e a allowlist já reduzida. O adaptador Google
mapeia o estado para `ad_user_data`, `ad_personalization`, `ad_storage` e
`analytics_storage`. A UI chama os click IDs de identificadores pseudônimos de
atribuição e explica o processamento limitado sem autorização para dados
pessoais diretos. Revogação ou invalidação afeta apenas eventos futuros e
nunca enriquece eventos retroativamente. A chave de consentimento é escopada
por projeto, domínio, ambiente, snapshot, publicação e `policyVersion` (V1 = `1`).
O gateway aceita o estado somente do manifesto server-side e recusa/ignora
estado ou hash forjado no browser; eventos são sempre persistidos e
deduplicados no Studio, encaminhados ao NVS e enviados aos adaptadores
externos habilitados nos três estados. Somente flags técnicas ou providers
desabilitados bloqueiam egress.

## Critério de pronto

Na V1, um projeto novo deve provisionar os dois motores, publicar página e quiz na
Vercel, registrar pageview no Umami,
lead/conversão no NVS, respeitar consentimento, exibir tudo no painel, aplicar
assinatura Asaas e aceitar rascunhos por MCP. Eventos VSL existentes ficam fora da certificação V1. Cada marco exige teste contra
serviços reais em containers, isolamento entre duas empresas, suíte completa,
revisão independente e verificação visual desktop/celular. O gate de conversões
exige teste parametrizado dos cinco adaptadores em `pending`, `denied` e
`granted`, com uma chamada por estado, `tracking_event_id` preservado, sem
PII/hash em pending/denied e egress ausente somente quando flag técnica ou
provider estiver desligado.

## MCP por projeto

O Studio expõe `POST /mcp` apenas por JSON-RPC 2.0 e autentica uma chave
`alva_` de 32 bytes aleatórios. A chave pertence a uma empresa e a um projeto;
o servidor guarda somente SHA-256, prefixo, escopos, validade, último uso e
auditoria. A criação ou revogação da chave e seu registro compartilham uma
transação. A interface autenticada cria, lista e revoga chaves por projeto, e
o segredo aparece somente na resposta de criação.

O protocolo aceita `initialize`, `notifications/initialized`, `ping`,
`tools/list` e `tools/call`, negocia versões compatíveis e limita corpo/rate
limit sem aceitar batch. Cada chamada revalida usuário ativo, membership e
grant do projeto; identificadores do agente não podem mudar o escopo. As seis
ferramentas fechadas são: consultar projeto, listar páginas, listar quizzes,
consultar uma página/quiz e criar rascunho de página/quiz. Criação usa
idempotência persistida por chave, projeto e operação: claim, criação e vínculo
do recurso compartilham uma única transação; repetir o mesmo pedido retorna o
recurso original e payload diferente falha.

Não há ferramentas para publicação, cobrança, domínio, equipe, tracking,
analytics, mídia, créditos, modelos, WaveSpeed, Apps ou Lab. Falhas de uma
ferramenta são devolvidas como `result.isError`; protocolo, autenticação e
método HTTP usam respostas JSON-RPC/401/403/405 coerentes. A auditoria usa
`actor_agent_key_id`, sem segredo ou PII.


### Allowlist canônica de atribuição

Meta aceita `fbc`/`fbp`; Google aceita `gclid`/`gbraid`/`wbraid`; TikTok aceita `ttclid`; LinkedIn mapeia `li_fat_id` para `linkedin_tracking_uuid`; Taboola mapeia `tblci` para `taboola_click_id`. Campos desconhecidos são recusados. Click IDs são pseudônimos permitidos em pending/denied. Google mapeia os quatro sinais para denied nesses estados e para granted em granted, sem ads_data_redaction.
