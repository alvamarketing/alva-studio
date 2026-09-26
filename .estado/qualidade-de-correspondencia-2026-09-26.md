---
no: qualidade-de-correspondencia
status: feito
---

# Qualidade da correspondência, acionável

## O que foi construído

Uma nota, por projeto, de quanto o Studio consegue identificar quem converteu —
e, principalmente, o que fazer com o que falta.

## A decisão que define o que isto é

**Não é a nota da Meta.** A Meta calcula a dela com dados que não temos e por
critérios que não publica. Chamar de "Event Match Quality" seria dar como medido
o que aqui é estimado, e um número apresentado como da plataforma seria cobrado
como se fosse.

O que dá para afirmar com honestidade é outra coisa, e é a que serve para agir:
quais sinais de identificação saíram daqui, e quais não saíram porque falta algo
que alguém pode resolver. A tela diz isso em voz alta, e um teste impede que o
texto volte a se apresentar como a nota da plataforma.

## Como a nota é composta

O peso segue o que as plataformas descrevem como determinante para casar a
conversão com a pessoa:

| Sinal | Peso | Por quê |
|---|---|---|
| Identificador do clique | 40 | É o que amarra a conversão ao anúncio; sem ele não há atribuição |
| E-mail | 25 | Casa a mesma pessoa entre celular e computador |
| Telefone | 15 | Soma correspondência junto com o e-mail |
| Identificador do navegador | 12 | Reforça a sessão, e só existe com o pixel na página |
| Endereço da página | 8 | Situa o evento |

**Consentimento negado não é falta.** Quando a pessoa nega, o servidor nem gera
os hashes de contato — e cobrar o e-mail nesse caso mandaria alguém tentar
consertar o que não está quebrado. Nesses eventos o contato sai do denominador e
a tela explica por quê.

## O buraco que apareceu no caminho

O `fbp` — o identificador que o pixel da Meta escreve no navegador — estava na
lista de coleta como se viesse na query string da URL. **Ele é cookie.**
Procurá-lo na URL garantia que viesse sempre vazio, então esse sinal nunca
chegou a nenhuma conversão.

Agora é lido do cabeçalho `Cookie`, com o nome exato `_fbp` e validado contra o
formato da Meta (`fb.<dígito>.<milissegundos>.<número>`) — o cabeçalho da página
publicada pode conter qualquer coisa que outro script tenha escrito.

E a correção fechou a porta pela qual o bug entrou: a cópia da lógica que é
publicada na Vercel deixou de ter a regex digitada à mão e passa a interpolar a
do Node. As duas são literalmente o mesmo texto, por construção — não por
disciplina de quem edita.

## O que falta ainda não ser possível medir

Dois campos que a Meta conta como forte sinal de correspondência não são
enviados: `client_ip_address` e `client_user_agent`. O Studio hoje
deliberadamente **não guarda** IP nem user-agent crus; o comentário no coletor
diz isso em voz alta. Enviá-los significa gravá-los na fila enquanto o evento
está em voo — é troca de postura de privacidade por atribuição, e a decisão é do
dono, não de quem implementa. A nota, portanto, mede o que o produto escolheu
enviar, não o máximo teórico.

## Evidência

- `.estado/screenshots/match-quality-desktop.png` — 1440×1600
- `.estado/screenshots/match-quality-mobile-390.png` — 390×1600

Capturas autenticadas, lendo a rota real, com quatro conversões semeadas no
banco local em estados diferentes (com e sem contato, com e sem clique). A nota
saiu 57% · Parcial, e as faltas vieram ordenadas por quantas conversões atingem.
Os dados semeados e o destino de demonstração foram removidos depois.

Seção do wireframe: ele não desenha a tela de Rastreamento, então vale a
"Biblioteca visual". O número grande usa o mesmo tratamento da faixa de métricas
do topo da tela; nenhuma cor, raio ou tamanho novo.

Suíte: **1151 testes, 0 falhas.**
