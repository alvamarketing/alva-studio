---
no: modo-de-teste
status: construido
---

# Modo de teste do rastreamento

Critério 15 de `docs/plans/2026-09-27-rastreamento-criterios.md`: com o modo de teste
ligado, o dono vê o evento na aba Eventos de Teste da Meta, sem afetar os dados reais.

## O que foi construído

- Campo opcional **Código de teste** na Meta e no TikTok, na tela de Rastreamento.
- Com o código, o servidor manda `test_event_code` no nível de cima do corpo, ao lado
  de `data`. Sem ele, o evento é de verdade.
- O destino em modo de teste aparece como **Modo de teste**, na cor de atenção — um
  "Enviando" verde faria entrega de teste parecer entrega de campanha.
- Apagar o código desliga o modo de teste sem pedir o token de novo: o campo vazio
  sobe como pedido de desligar, e o servidor remove o código da configuração.
- O código não é segredo (a plataforma o mostra às claras) e fica também na
  configuração pública, que é como a tela sabe que o modo está ligado.

## O que está confirmado e o que não está

- **Meta**: `test_event_code` no nível de cima do corpo — documentação oficial da
  Conversions API (parâmetros do corpo principal).
- **TikTok**: a documentação oficial confirma o código e que ele isola o evento dos
  dados reais, mas a posição no corpo só foi confirmada por fontes de terceiros; a
  referência da Events API v1.3 não carregou fora do navegador. Implementado no nível
  de cima, como a Meta. Conferir no primeiro teste real com TikTok.

## Evidência

- `packages/studio/test/modo-de-teste.test.mjs` — adaptadores, repositório com Postgres
  real (liga, sobrevive a outra correção, desliga sem perder o token, recusa código
  malformado) e tela. Os cinco testes falharam antes da implementação.
- Suíte inteira: 1226 de 1226.
- Tela: `.estado/screenshots/modo-de-teste-desktop.png`,
  `.estado/screenshots/modo-de-teste-mobile-390.png`. Sem seção própria no wireframe;
  só tokens existentes (a cor de atenção é a de "Nova tentativa").

## O que falta para `feito`

Conferência por quem não construiu, e o evento aparecendo de fato na aba Eventos de
Teste da Meta — que é a prova real dos critérios 4, 5, 9, 10 e 11.
