---
no: motivo-da-falha
status: construido
---

# O motivo da falha na tela de Rastreamento

Critério 12 de `docs/plans/2026-09-27-rastreamento-criterios.md`: se a plataforma
recusa o evento por credencial errada, a tela mostra que o envio falhou e o motivo,
em vez de mostrá-lo como enviado.

## O que mudou

- A entrega que a plataforma recusou aparece como **Falhou** (antes "Encerrada",
  que se lê como "terminou") — na tabela, no filtro, na lista de conversões do
  projeto e na métrica ("Falharam").
- O motivo gravado na fila vira uma frase que diz o que conferir e onde, nomeando
  o destino. Código desconhecido não vaza para a tela.
- A jornada do evento deixou de afirmar duas coisas falsas: "destinos concluídos"
  listava também os que falharam, e "hashes gerados no servidor" aparecia mesmo sem
  consentimento, quando nenhum hash é gerado.

## O que a conferência na tela encontrou

A primeira captura, com um evento entregue à Meta e recusado (401) pelo Google Ads,
mostrou três defeitos que os testes não pegavam:

1. O Google Ads falhando dizia "confira o token do pixel" — o Google não tem pixel.
   A frase agora nomeia o destino e não fala de pixel.
2. A coluna de consentimento mostrava `pending` cru, enquanto a jornada dizia
   "Aguardando decisão". Um rótulo só para as duas.
3. No celular, a coluna da tela crescia até a largura mínima da tabela (560 px) e
   empurrava a jornada para fora da tela. Era `1fr` no lugar de `minmax(0, 1fr)`.

## Evidência

- Testes: `packages/studio/test/motivo-da-falha.test.mjs`, `test/tracking-view.test.mjs`.
  Suíte inteira: 1211 de 1211.
- Tela, com evento semeado no banco local (Meta entregue, Google Ads recusado com 401):
  `.estado/screenshots/motivo-da-falha-desktop.png` (1440 px),
  `.estado/screenshots/motivo-da-falha-mobile-390.png`,
  `.estado/screenshots/motivo-da-falha-jornada-mobile-390.png`.
- Seção do wireframe: o wireframe não tem seção para a tela de Rastreamento; os
  blocos seguem os tokens da "Biblioteca visual", sem cor, raio ou tamanho novo.

## O que falta para `feito`

Conferência por quem não construiu. E o critério só estará provado de ponta a ponta
quando uma recusa real da Meta — token errado de propósito — aparecer assim na tela.
