---
no: tracking_coletor
status: feito
---

# Coletor Node histórico — certificação de linha de base

O coletor atual é uma implementação Node interna, compatível apenas com parte
do modelo de dados do Umami. Ele **não é Umami 3.3.1**, não provisiona o motor
real e não autoriza o produto a anunciá-lo como tal. Ele continua registrando
visitas e eventos até o corte homologado, para não interromper a medição atual.
Depois do corte para os motores reais, seus dados ficam disponíveis somente
para leitura por 90 dias; esse regime é planejado e depende da homologação do
corte.

O checkpoint de resgate é `4c5224a` (`wip(studio): preserva vsl pixels e
cobranca em andamento`). A linha de base resgatada foi **393/393 testes
aprovados**, antes da retomada do runtime comercial.

## Evidências automatizadas

- Suíte focada do coletor e superfícies relacionadas: **125 pass, 0 fail**.
  Cobriu backfill/provisionamento de `analytics_websites`, tracker na rota
  pública `/f`, `event_data` de formulário e VSL, UTMs, click IDs, referrer,
  lead emitido após a persistência da submissão, `dailyVisits`, retenção,
  CORS, PII, isolamento, CSP e `tracker.js`.
- Suíte completa da linha de base: `node --test packages/studio/test/*.test.mjs`
  → **393 pass, 0 fail, 0 cancelados, 0 ignorados**.
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

Esta linha registra somente a evidência do coletor histórico. A homologação de
Umami e NVS reais pertence aos nós `runtime_comercial`,
`provisionamento_motores`, `integracao_motores` e `homologacao_motores`.

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

1. A legenda do produto não usa “Umami”; exibe “Coletor interno”. A referência
   ainda mostra “Umami · atualizado agora”, que só será apropriado depois da
   homologação do motor real.
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
