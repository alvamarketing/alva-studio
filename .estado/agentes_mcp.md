---
no: agentes_mcp
status: feito
---

# Agentes MCP V1 — checkpoint local

Prova: chave em hash por projeto, nenhum agente publica sem ação humana, 518 testes verdes

Em 2026-09-06 foi implementado o port do contrato MCP do IZI para
Node/PostgreSQL: chaves `alva_` com 32 bytes aleatórios e segredo exibido uma
vez, hash/prefixo/escopos/validade/último uso persistidos, auditoria por
`actor_agent_key_id`, limite atômico por chave e idempotência durável por
chave/projeto/operação. O endpoint `POST /mcp` aceita somente JSON-RPC 2.0 sem
batch e negocia `initialize`, `notifications/initialized`, `ping`,
`tools/list` e `tools/call`.

O catálogo fica fechado a consultar o projeto autorizado, listar páginas e
quizzes, consultar conteúdo e criar rascunhos de página ou quiz. Membership,
grant e projeto ativo são revalidados em cada chamada; o agente não escolhe ou
troca `company_id`/`project_id`. Publicação, cobrança, domínio, equipe,
tracking, analytics, mídia, créditos, modelos, WaveSpeed, Apps e Lab não são
expostos.

Prova local atual: **11 testes focados aprovados, 0 falhas** (10 de servidor e
1 de interface), cobrindo segredo
não persistido, revogação, expiração lógica, idempotência concorrente e retry
após falha intermediária, rate limit, limite concorrente de chaves, JSON-RPC,
Origin explícita, catálogo fechado, isolamento, APIs administrativas e rollback
de auditoria na criação e revogação. Não houve
egress, credencial real, produção, DNS, cobrança ou homologação externa.

## Verificação visual pós-correção — 2026-09-06

A revisão visual independente foi aprovada contra a estrutura e os tokens de
`docs/wireframes/alva-studio-ui-reference.html`. As capturas confirmam o
cartão “Conectar agentes” integrado ao painel do projeto, hierarquia de
seção, espaçamento, tipografia, controles e estado de chave revogada sem
exposição do segredo:

- Desktop: `docs/wireframes/alva-studio-mcp-desktop.png` — viewport/documento
  1440 px; cartão MCP com 679 px.
- Mobile: `docs/wireframes/alva-studio-mcp-mobile.png` — viewport/documento
  390 px; cartão MCP com 358 px.

Checkboxes medidos em 13×13 px nos dois viewports. Nenhum token aparece nas
capturas. A criação, listagem e revogação foram exercitadas localmente após a
correção do HTTP 500; a criação passou a retornar 201. A revisão independente
do contrato MCP foi aprovada. Depois de todas as correções, a suíte completa
final passou em **518/518**. Esta evidência local encerra a Etapa 10; a
certificação comercial integrada continua na Etapa 11.
