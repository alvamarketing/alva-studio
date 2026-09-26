---
no: analytics-origem-do-painel
status: feito
---

# Origem dos dados no painel de visitas

Conferido em 2026-09-26, na `main`, contra o Studio local em
`https://alva.orb.local` (OrbStack, imagem reconstruída, migrações até a 023),
autenticado com a conta do dono e com o projeto real aberto.

## O defeito

O painel dizia **"Coletor legado · migração pendente"**, e o rodapé da tela de
Analytics dizia **"medidos pelo coletor legado · migração pendente"**. Os dois
ramificavam num campo `summary.source` que a API de resumo nunca devolveu —
ele existia quando havia dois coletores e o resumo precisava dizer qual tinha
respondido.

Com um coletor só, o ramo verdadeiro nunca acontecia. O painel caía no outro
lado e escrevia **"Origem dos dados indisponível"** com o gráfico preenchido
logo ao lado. A tela anunciava ao dono do projeto uma migração já encerrada e
uma falha que não existia.

## Seção do wireframe conferida

Referência: `docs/wireframes/alva-studio-ui-reference.html`, seção
**"Visitas nos últimos 7 dias"** (elemento `r0169`, com o slot de origem em
`r0170`).

O wireframe escreve naquele slot `Umami · atualizado agora`, em
`font-size:8px;color:var(--muted)`. A forma é o contrato: nome da origem,
separador `·`, frescor. O nome mudou porque o Umami saiu e quem mede é o
Studio; a forma ficou.

Medido na tela implementada, com o painel renderizado:

- texto: `Analytics do Studio · atualizado agora`
- `font-size`: `8px`
- `color`: `rgb(174, 184, 199)`, que é exatamente o token `--alva-muted`
  (`#aeb8c7`) — nenhum valor novo foi criado

## Evidência

- `.estado/screenshots/analytics-origem-visitas-7-dias-desktop.png` — 1440×900
- `.estado/screenshots/analytics-origem-visitas-7-dias-mobile-390.png` — 390×844
- `.estado/screenshots/analytics-origem-wireframe-visitas-7-dias-desktop.png` —
  a mesma seção no wireframe, para comparar bloco a bloco

As três capturas saíram do Chrome sem cabeça pelo protocolo de depuração, com o
cookie de sessão injetado, e não de um render forçado: é a tela como o dono a vê.

## O que ficou de fora

O projeto conferido não tem visita nos últimos 7 dias, então o gráfico aparece
com as barras no mínimo enquanto o rótulo diz "atualizado agora" — a fase é
`ready` porque existe jornada, não porque existe visita. Isso é comportamento
anterior a esta correção e não foi alterado aqui; o estado vazio do painel
merece desenho próprio.

O wireframe ainda escreve **"Aurora · Umami + NVS"** na linha "Analytics +
Tracking" da seção "Estrutura do projeto". Nome no contrato visual é decisão do
dono, não de quem implementa, então não foi tocado.
