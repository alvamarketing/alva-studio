---
no: tracking_coletor
status: feito
---

# Coletor de tracking interno — certificação

Revalidação independente executada em 2026-09-05 no branch
`codex/alva-studio-editor`. Não alterei código de produto, não fiz commit nem
push. Os critérios automatizados e documentais estão satisfeitos; as ressalvas
visuais estão registradas abaixo.

## Evidências automatizadas

- Suíte focada do coletor e superfícies relacionadas: **125 pass, 0 fail**.
  Cobriu backfill/provisionamento de `analytics_websites`, tracker na rota
  pública `/f`, `event_data` de formulário e VSL, UTMs, click IDs, referrer,
  lead emitido após a persistência da submissão, `dailyVisits`, retenção,
  CORS, PII, isolamento, CSP e `tracker.js`.
- Suíte completa: `node --test packages/studio/test/*.test.mjs` →
  **393 pass, 0 fail, 0 cancelados, 0 ignorados**.
- `git diff --check` → limpo.
- Inspeção confirmou a migração `012_analytics_websites.sql`: backfill de
  projetos ativos e trigger para provisionar projeto ativado, com
  `tracker_public_id` público de 32 caracteres.
- Inspeção confirmou que `/f/<empresa>/<projeto>/<formulario>` resolve o
  tracker do projeto e injeta `tracker.js`; o coletor persiste atribuição
  inicial na sessão e metadados permitidos em `analytics_event_data`; a
  submissão pública só chama `recordLead` depois que a transação de respostas
  retorna; o resumo usa `{ date, visits }`; a limpeza remove eventos, dados e
  sessões expirados.

Prova: coletor sem PII, isolado por projeto, 393 testes verdes

Esta linha registra a evidência automatizada exigida pelo contrato do grafo;
as capturas e ressalvas visuais abaixo completam o registro de homologação.

## Verificação visual

A seção exigida é **“Visitas nos últimos 7 dias”**, comparada com
`docs/wireframes/alva-studio-ui-reference.html` em desktop e em 375 px. As
capturas comparadas estão em:

- `.estado/screenshots/tracking-coletor-desktop.png`
- `.estado/screenshots/tracking-coletor-mobile-375.png`
- `.estado/screenshots/tracking-coletor-reference-desktop.png`
- `.estado/screenshots/tracking-coletor-reference-mobile-375.png`

Em desktop, o cartão mantém o título, proporção geral, sete barras, espaçamento,
funnel pills e ação “Abrir Analytics” no mesmo eixo visual da referência. Em
375 px, o cartão colapsa para uma coluna e preserva as sete barras e a jornada;
fica registrada a ressalva de que o botão de menu flutuante encosta no título
do cartão.

Os testes automatizados conferem as classes `.surface.analytics-card`,
`.chart`, `.chart i` e `.journey`, o título exato, o breakpoint móvel, os
estados do modelo, nomes acessíveis das barras e a ausência de novo token
hexadecimal em `styles.css`.

Desvios previstos pela Task 12, conferidos na comparação:

1. A legenda do produto não usa “Umami”; exibe “Coletor interno”, enquanto a
   referência ainda mostra “Umami · atualizado agora”.
2. Os estados de carregando, vazio e erro existem no produto para o contrato
   de dados, mas não aparecem na referência visual estática.
3. As barras recebem nomes acessíveis por `aria-label`/`title` sem alterar o
   desenho, portanto esses nomes não são visíveis na captura.

## Gate e ressalvas

- `vibe conferir tracking_coletor --antes` já foi executado antes deste arquivo
  existir e falhou como esperado; a entrada correspondente está em
  `.estado/.provas.jsonl`.
- `vibe conferir tracking_coletor` foi executado após este registro.
- A árvore compartilhada contém alterações de implementação e testes de outros
  agentes, preservadas nesta revalidação; não as reescrevi.
