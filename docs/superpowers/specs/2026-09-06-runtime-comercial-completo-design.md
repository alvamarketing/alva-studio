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

## Critério de pronto

Na V1, um projeto novo deve provisionar os dois motores, publicar página e quiz na
Vercel, registrar pageview no Umami,
lead/conversão no NVS, respeitar consentimento, exibir tudo no painel, aplicar
assinatura Asaas e aceitar rascunhos por MCP. Eventos VSL existentes ficam fora da certificação V1. Cada marco exige teste contra
serviços reais em containers, isolamento entre duas empresas, suíte completa,
revisão independente e verificação visual desktop/celular.
