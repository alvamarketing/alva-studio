# O editor de landing para quem não sabe design

27/09/2026. Objetivo do dono: **alguém sem experiência clica, arrasta e tem um bom
resultado**. As regras abaixo saíram de uma pesquisa nos construtores líderes e na
literatura de UX, e foram julgadas pelo Jev (`jev-1.13.0`) com dois controles
propositalmente ruins — que tiraram 19 e 16, contra 74–88 das regras reais.

## O que os líderes fazem (fontes na pesquisa)

- Conteúdo numa área central de largura máxima, fundo de ponta a ponta (Webflow).
- Seções prontas antes dos blocos soltos (Squarespace, Elementor, Webflow).
- Colunas escolhidas por desenho, não por largura digitada (Elementor, Webflow Quick Stack).
- Espaçamento em escala P/M/G, valor livre escondido (Squarespace).
- Colunas empilham sozinhas no celular (Notion, Wix, Squarespace).
- Nielsen Norman: defaults fortes, revelação progressiva, restrições que previnem erro.

"Soltar ao lado vira coluna", como no Notion, não tem suporte no Puck 0.23 (o drop só
carrega zona e índice). O efeito vem de um bloco **Linha** em flex: soltar o segundo
bloco já divide 50/50.

## As regras, pela nota do Jev

| Nota | Regra | Decisão |
|---|---|---|
| 88 | Biblioteca começa por seções prontas | construir |
| 87 | Colunas por desenho (2 iguais, 1/3+2/3, 3 iguais) | construir |
| 86 | Espaçamento P/M/G; pixels só em "avançado" | construir |
| 85 | Blocos nascem centralizados numa seção de uma coluna | construir |
| 84 | Trocar o layout de uma seção mantendo o conteúdo | depois |
| 83 | Bloco novo nasce com exemplo bem escrito | construir |
| 82 | Fluxo/grade, sem posição livre por coordenada | já é assim |
| 81 | Cada bloco só entra onde funciona | já é assim (Campo) |
| 80 | Blocos pequenos dividem a linha em partes iguais | construir (Linha) |
| 80 | Celular empilha sozinho | já é assim |
| 79 | Área central com largura máxima | já é assim |
| 78 | Soltar ao lado divide 50/50 (ideia do dono) | construir (Linha) |
| 77 | Espaço entre blocos vem da seção | construir |
| 74 | Largura manual em "avançado" | construir |

**O que o Jev ensinou:** os comportamentos automáticos foram os menos previsíveis para o
iniciante (50/50 automático 0,46; espaço vindo da seção 0,37). A decisão foi manter o
automático — é ele que dá o bom resultado — e torná-lo visível: a Linha mostra onde soltar
ao lado antes do bloco cair.
