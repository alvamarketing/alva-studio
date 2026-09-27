# Entrada de leads, simulada de ponta a ponta

27/09/2026. Pedido do dono antes de qualquer conserto: simular a chegada de leads
por Facebook, Google, TikTok, direto, orgânico e uma variação extensa de UTM.

Duas frentes, porque cada uma responde uma coisa que a outra não alcança.

**Local, pelo gateway de verdade** — `test/entrada-de-leads.test.mjs`. 25
cenários, rodando o módulo de gateway publicado na Vercel, com os rewrites do
`vercel.json` da mesma publicação, nos dois passos da pessoa: carregar a página vinda do anúncio e
enviar o formulário. Postgres real, página publicada de verdade, destinos Meta,
TikTok e Google configurados. Lê o que chegou ao banco e o corpo que o adaptador
real montaria para cada plataforma.

**Na Vercel real** — projeto `alva-sonda-leads`. Uma função que registra os
cabeçalhos que a Vercel entrega, e outra que repassa a chamada com a mesma regra
do nosso gateway. Tráfego de cinco perfis de visitante. É a única forma de saber
o que a Vercel entrega de fato, e é disso que o conserto do IP depende.

---

## O que funciona

**O identificador de clique atravessa o caminho inteiro.** Pelo gateway real:

| Origem | Chega a |
|---|---|
| `fbclid` | Meta, como `fbc` no formato `fb.1.<ms>.<fbclid>` |
| `_fbp` (cookie do pixel) | Meta, como `fbp` |
| `ttclid` | TikTok |
| `gclid`, `gbraid`, `wbraid` | Google |

Direto e orgânico não carregam identificador nenhum, como devem. O fragmento da
URL (`#`) não é lido como atribuição. Um `fbclid` com caracteres estranhos chega
íntegro. O risco residual registrado na auditoria — nenhum teste levava a
corrente inteira até a fila — está fechado para esses sinais.

## O que está errado

### O IP e o navegador — confirmado na Vercel real

| | IP | Navegador |
|---|---|---|
| O gateway recebe | o da pessoa (`189.68.172.6`) | o real, diferente para cada um |
| O servidor enxerga | `98.81.200.226` — saída da Vercel, `iad1` | `node` |

Cinco visitantes diferentes, e o servidor vê o mesmo endereço e o mesmo navegador
para todos. Na simulação local, 25 leads de 25 navegadores diferentes chegariam à
Meta com **um IP e um navegador só**.

A Vercel entrega o IP de quem visita em três cabeçalhos coincidentes —
`x-forwarded-for`, `x-real-ip` e `x-vercel-forwarded-for` — e o navegador em
`user-agent`. **A informação existe no gateway; é a regra de repasse que a
descarta.** O conserto da fase A tem agora um alvo concreto.

### UTM não chega à conversão — 0 de 25

Campanha, origem, mídia, termo, conteúdo: nenhum chega ao payload de conversão,
em nenhum cenário. O cookie de atribuição só nasce quando há identificador de
clique; UTM sozinha não cria nada, e mesmo acompanhada ela não é gravada.

### O Google recusa todo lead que não veio do Google

Sem `gclid` e sem e-mail hasheado, o adaptador do Google recusa. Cada lead de
Facebook, TikTok, direto ou orgânico vira uma entrega morta para o Google, e a
tela de rastreamento mostraria o Google como quebrado, com taxa de entrega
baixa, quando o comportamento é o esperado.

### O e-mail não sai por padrão

Sem consentimento concedido, o servidor nem gera o hash do e-mail. É deliberado
— é a pessoa exercendo um direito —, mas o efeito prático é que, para a maior
parte dos leads, a correspondência depende só do identificador de clique.
Registrado como consequência de desenho, não como defeito.

---

## Limites deste teste

Dito para não parecer mais do que foi:

- **O referer não foi testado na Vercel.** Um erro no meu comando de envio grudou
  o cabeçalho de origem no user-agent. Não afeta a conclusão do IP, mas as
  variações de origem (Facebook, Instagram, Google) ficaram sem teste nessa
  rodada.
- **As UTMs no analytics não foram exercitadas.** A simulação cobriu o caminho
  da conversão; o coletor, que grava UTM na sessão de analytics, não foi chamado.
  As UTMs estranhas (600 caracteres, script, SQL, emoji) só foram testadas contra
  a conversão — onde elas não chegam de jeito nenhum.
- **Todo o tráfego da Vercel saiu de uma máquina só.** O que se prova é o que o
  servidor enxerga, não a diversidade de IPs de origem.
- **Nenhum evento chegou a uma plataforma de verdade.** Os corpos foram montados
  pelo adaptador real, mas não enviados: a entrega segue desligada, e não há
  pixel real configurado.

## O que isso muda na ordem

A fase A da auditoria continua em primeiro, agora com o alvo certo. Dois achados
novos pedem decisão do dono antes de entrar no plano:

1. **UTM na conversão.** Levar campanha e origem até o evento é o que permite
   separar, no painel do anúncio, qual criativo trouxe lead. Exige gravar UTM no
   cookie assinado do runtime, junto do identificador de clique.
2. **O Google e os leads que não são dele.** Ou a fila deixa de endereçar ao
   Google o evento que ele não tem como atribuir, ou a tela passa a distinguir
   "recusado por não ter como atribuir" de "falhou".

**Correção de 27/09, mais tarde.** Até o commit que a trouxe, esta frente rodava
`forwardRuntimeGatewayRequest`, uma segunda cópia do gateway escrita em Node que
se dizia "o mesmo gateway publicado". Não era: ela assinava a query junto com o
caminho, e o módulo publicado não. Os 25 cenários foram refeitos pelo módulo
publicado e continuam valendo; a cópia foi apagada.

