# Rastreamento — critérios de aprovação

27/09/2026. A régua que decide quando o rastreamento está pronto, e o estado real
de cada critério hoje.

**Pronta**, na definição do dono, é **utilizável: se fosse um produto, estaria 100%
funcional.** Feature pronta vira base para a próxima; feature pela metade obriga a
próxima a reabri-la.

---

## O que faz um critério ser bom

Quatro qualidades. Cada critério desta lista foi julgado contra elas pelo **Jev**
(TypeSafe), um juiz que não escreveu os critérios.

| Qualidade | Pergunta que o critério tem de responder |
|---|---|
| **Verificável** | Dá para decidir sim ou não com uma checagem concreta, sem opinião? |
| **Específico** | Diz a situação exata e o resultado esperado? |
| **Observável** | Descreve o que alguém usando o produto — ou a plataforma de anúncio — vê, e não um detalhe interno? |
| **Necessário** | Se falhar, a feature fica inutilizável ou não confiável? |

O Jev não escreve critério: ele julga. A régua e a decisão de reescrever ficam no
código, com pesos declarados (verificável 35%, específico 25%, observável 20%,
necessário 20%).

**Conferência do juiz.** Dois critérios propositalmente ruins foram misturados à
lista — "o rastreamento funciona bem" e "o código está limpo". Tiraram **23 e 21**;
os critérios reais ficaram entre **74 e 94**. O Jev reprova critério vago com
clareza, então dá para confiar nele nesta tarefa.

### O que o Jev ensinou

- **Critério que junta duas coisas esconde a importante.** "Mostra o pixel,
  nunca o token" misturava uma conveniência com uma exigência de segurança, e a
  nota fez a média das duas. Separados, cada um é julgado pelo que é.
- **Dizer onde olhar torna o critério verificável.** "O e-mail não é enviado"
  tirou 0,69; "o evento que chega à Meta não traz o campo `em`" tirou 0,89.
- **Garantia técnica fica observável quando aponta para a plataforma.**
  "Deduplicado pelo `event_id`" tirou 0,33 de observável; "no Gerenciador de
  Eventos, aparece recebido pelas duas fontes e contado uma vez" tirou 0,86.

Cinco critérios foram reescritos e passaram pelo Jev de novo. Todos melhoraram.

As notas vêm de `jev-1.13.0`, em 27/09/2026, numa chamada só para os dezesseis
critérios e os quatro julgamentos de cada um. O avaliador ainda não mora no
repositório; quando a próxima feature tiver critérios, ele entra como ferramenta,
em vez de ser reescrito.

---

## Os critérios, e onde cada um está

✅ cumprido e provado · ⚠️ pela metade · ❌ falta · ❓ não verificado

### Configurar

| # | Critério | Jev | Hoje |
|---|---|---|---|
| 1 | Na tela de Rastreamento, o dono do projeto informa o ID do pixel e o token da Meta e salva, sem nenhuma chamada técnica feita à mão. | 82 | ✅ tela conferida no navegador em 26/09 |
| 2 | Depois de salvar, a tela mostra o pixel como configurado, exibindo o ID do pixel. | 89 | ✅ |
| 3 | Nem a tela, nem a resposta de nenhuma rota do Studio, exibem o token de acesso depois de salvo. | 81 | ✅ teste compara a resposta inteira com o token |

### Chegar ao lugar certo

| # | Critério | Jev | Hoje |
|---|---|---|---|
| 4 | Uma pessoa que clica num anúncio da Meta e envia o formulário gera exatamente uma conversão no Gerenciador de Eventos da Meta. | 94 | ❌ nenhum evento real chegou à Meta ainda |
| 5 | Quando a pessoa veio de um anúncio da Meta, a conversão chega à Meta com o identificador do clique (`fbc`). | 86 | ✅ até o corpo enviado, pelo gateway real · ❌ dentro da Meta |
| 6 | Quem veio de um anúncio do Google chega ao Google com o `gclid`; quem veio do TikTok chega ao TikTok com o `ttclid`. | 86 | ✅ até o corpo enviado |
| 7 | O Google não recebe conversão de quem não veio de um anúncio do Google. | 86 | ❌ hoje recebe e recusa |
| 8 | A campanha, a origem e a mídia (UTM) do anúncio chegam junto com a conversão. | 85 | ❌ chegam em 0 de 25 cenários |

### Uma vez só

| # | Critério | Jev | Hoje |
|---|---|---|---|
| 9 | No Gerenciador de Eventos da Meta, um lead enviado pelo navegador e pelo servidor aparece como recebido pelas duas fontes e contado uma única vez. | 87 | ❓ depende do pixel do navegador na página, que está atrás de uma flag desligada (`PIXELS_ENABLED`) e nunca foi exercitado |
| 10 | Reenviar o formulário ou recarregar a página de obrigado não gera uma segunda conversão. | 89 | ✅ na fila (identidade por evento e destino) · ❓ dentro da Meta |

### Dizer a verdade

| # | Critério | Jev | Hoje |
|---|---|---|---|
| 11 | No detalhe de um evento na Meta, o IP e o navegador registrados são os do aparelho da pessoa que converteu, e não um endereço de servidor repetido em todos os eventos. | 89 | ✅ até o corpo enviado (commit `315d842`) · ❌ dentro da Meta |
| 12 | Se a Meta recusar o evento por credencial errada, a tela mostra que o envio falhou e o motivo, em vez de mostrá-lo como enviado. | 90 | ⚠️ mostra "Encerrada", não mostra o motivo |
| 13 | Uma conversão que chega à Meta sem IP e navegador da pessoa aparece na tela de qualidade da correspondência com o item "Endereço e navegador de quem converteu" marcado como faltando. | 86 | ✅ |
| 14 | Com o consentimento negado, o evento que chega à Meta não traz o campo de e-mail hasheado (`em`). | 84 | ✅ |

### Conferir

| # | Critério | Jev | Hoje |
|---|---|---|---|
| 15 | Com o modo de teste ligado, o dono vê o evento aparecer na aba Eventos de Teste da Meta, sem afetar os dados reais. | 83 | ❌ não existe |

Sobre o 15: o Jev deu **0,46 de necessidade** — a feature funciona sem ele. É
verdade: ele é o meio de conferir, não uma necessidade do cliente. Mas sem ele a
única forma de conferir é mandar evento real. *Decisão do dono: manter ou tirar.*

---

## O que falta para o rastreamento ficar pronto

Oito critérios estão cumpridos. Os que faltam, na ordem de trabalho:

1. **UTM até a conversão** — critério 8.
2. **O Google só recebe o que é dele** — critério 7.
3. **O motivo da falha na tela** — critério 12. Pequeno: o motivo já é gravado
   na fila, só não é mostrado.
4. **O pixel do navegador** — critério 9. É preciso descobrir primeiro se ele
   funciona: a flag está desligada e nada o exercitou. Se não funcionar, é o
   maior item desta lista.
5. **Modo de teste** — critério 15, se o dono mantiver.
6. **A prova na Meta de verdade** — critérios 4, 5, 9, 10 e 11. Exige um pixel e
   um token da Meta. Sem ela, esses critérios ficam "certos até o envio", que é
   exatamente o que a régua não aceita.

---

## Para as próximas features

A mesma régua vale para a VSL, a landing e o quiz. Antes de começar cada uma:
escrever os critérios no formato "situação → resultado, onde conferir",
passá-los pelo Jev com os dois controles, reescrever o que ele reprovar, e só
então construir.
