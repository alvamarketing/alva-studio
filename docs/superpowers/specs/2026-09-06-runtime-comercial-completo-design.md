# Alva Studio comercial completo — design

## Objetivo

Entregar o Alva Studio como a única interface para páginas, quizzes, VSLs,
analytics, tracking, conversões, cobrança e agentes. Umami 3.3.1 e NVS Core
0.3.10 rodam como motores internos gerenciados; o player VSL, a biblioteca e o
pipeline de mídia pertencem ao Studio.

## Arquitetura

- Coolify executa `studio-web`, `studio-worker`, `studio-media-worker`,
  PostgreSQL do Studio, Umami com PostgreSQL próprio e NVS PHP com MariaDB
  próprio. Os bancos e painéis administrativos não são públicos.
- Vercel hospeda somente snapshots de páginas e quizzes. Cada publicação leva
  um manifesto imutável com `publicationId`, `snapshotHash`, política e IDs
  públicos dos motores daquele projeto e ambiente.
- Cada `project + environment` possui um website Umami e uma propriedade NVS.
  O Studio provisiona, consulta e monitora ambos sem devolver credenciais ou
  identificadores administrativos ao navegador.
- Umami é a autoridade de pageviews, sessões, origens e UTMs. NVS é a
  autoridade de eventos comerciais, identidade, deduplicação e fan-out.
- R2 guarda mídia privada. Upload é multipart direto; FFmpeg/FFprobe rodam no
  worker; versões publicadas apontam para renditions HLS imutáveis.

## Regras de produto

- O cliente usa apenas o Studio. Não há link para painel Umami, NVS ou VTurb.
- NVS preserva o Core real 0.3.10 em sidecar PHP/MariaDB. O Viewer separado não
  entra no produto.
- A VSL é própria, usa progresso real e não promete DRM. YouTube/Vimeo ficam
  apenas como compatibilidade.
- Pixels publicitários carregam somente em produção e após opt-in. Um único
  `tracking_event_id` une navegador, lead persistido e conversão server-side.
- Produção, DNS, R2 e Asaas real continuam atrás de homologação explícita.
- O coletor Node atual vira arquivo histórico por 90 dias após o corte; não há
  dual-write permanente nem importação semântica para Umami.

## Critério de pronto

Um projeto novo deve provisionar os dois motores, publicar página e quiz na
Vercel, processar uma VSL enviada pelo Studio, registrar pageview no Umami,
lead/conversão no NVS, respeitar consentimento, exibir tudo no painel, aplicar
assinatura Asaas e aceitar rascunhos por MCP. Cada marco exige teste contra
serviços reais em containers, isolamento entre duas empresas, suíte completa,
revisão independente e verificação visual desktop/celular.
