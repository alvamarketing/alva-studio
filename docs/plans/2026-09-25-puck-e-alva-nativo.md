# Puck no editor e o runtime em casa — plano

**Goal:** trocar o GrapesJS pelo Puck como host do editor de landing page e de quiz, e
absorver Umami e NVS para dentro do Node como Alva Analytics e Alva Tracking, de modo que
o Studio rode em uma linguagem, com quatro containers no dia a dia em vez de onze.

1. Catálogo de elementos como dono do HTML, consumido pelo Puck — landing e quiz no mesmo
   catálogo, como manda a spec do catálogo e da jornada.
2. Editor de páginas migrado do GrapesJS para o Puck, com o runtime publicado intacto.
3. Quiz como jornada sobre o mesmo catálogo, sem editor próprio.
4. Alva Analytics: o coletor que já existe passa a ser o único, e o Umami sai.
5. Alva Tracking: o envio para destinos de conversão nasce em Node, e o NVS sai.

**Spec:** `docs/specs/2026-09-12-catalogo-e-jornada-design.md`. Este plano mantém o
princípio dela — um catálogo, dois hosts — e troca o host de GrapesJS para Puck.

---

## Por que agora, e com que evidência

Em 25/09/2026 o mesmo bloco — formulário de captura com "dividir em etapas" — foi montado
nos dois motores para comparar. O resultado final ficou igual; o caminho, não:

| | Puck | GrapesJS tipado |
|---|---|---|
| linhas para declarar o bloco | 73 | 77 |
| tentativas até funcionar | 1 | 4 |
| painel de propriedades | nasce dos campos declarados | montado e estilizado à mão |
| peso no navegador | 532 KB | 1.128 KB |
| infraestrutura | `node_modules` + build | nenhuma |

Os quatro tropeços do GrapesJS: painéis vêm desligados; `addType` depois do `init` deixa o
componente sem resolver; trait sem `changeProp` grava em atributo e o campo vem vazio; o
tema escuro da folha torna os rótulos ilegíveis sobre fundo claro. Nenhum é documentado de
forma óbvia, e nenhum é o último — o histórico deste repositório é uma sequência deles.

O GrapesJS não é incapaz. O que ele cobra é uma rodada de adivinhação por funcionalidade,
e cada rodada dessas é uma sessão que não virou produto.

## O que este plano não muda

**O runtime publicado continua em JavaScript puro.** `tracker.js`, `quiz-runtime.js` e
`vsl-player.js` somam 567 linhas e viajam dentro da página que sobe na Vercel, na máquina
de quem visita. React ali significaria mandar framework para alguém que só quer ver a
oferta: página mais lenta, Core Web Vitals pior, conversão menor. O Puck fica do lado do
editor; o que é publicado sai como HTML e JS sem framework.

**O servidor não é tocado.** Os 62 módulos, as 47 tabelas e as 22 migrações não sabem qual
editor está na frente. A troca cabe nas 3.844 linhas de editor.

**O Puck AI não entra.** Ele é do Puck Cloud, pago — custo dos tokens mais 20%, ou US$ 199
por mês. O dado do Puck é JSON declarativo de blocos, que é exatamente o que um modelo
gera bem: a geração por IA chama a API direto, pagando só o token.

---

## Fase 1 — O catálogo e o editor

### 1.1 Catálogo de elementos

`packages/studio/public/catalogo-elementos.js` passa a ser o dono do HTML, no formato que a
spec define: `id`, `nome`, `icone`, `grupo`, `campos`, `render`. Sem DOM de editor e sem
estado.

A diferença em relação à spec é o consumo: onde ela dizia "o editor de páginas consome esse
`render` como bloco do GrapesJS", passa a ser "como `component` do Puck". A conversão é
direta — `campos` vira `fields`, `render` vira `render` — porque o Puck foi desenhado em
cima desse mesmo formato.

**Prova:** cada elemento tem teste afirmando que o HTML gerado carrega a classe do sistema e
nenhum estilo inline de cor ou tamanho. Revisão visual contra a seção "Biblioteca visual" do
wireframe, em 1440×900 e 390×844, com screenshot anexado.

### 1.2 Puck no lugar do GrapesJS

Entra React e um bundler, confinados ao editor. O `index.html` passa a carregar um bundle
em vez de `editor-shell.js`; o allowlist de assets do servidor ganha a pasta de saída do
build; o resto do front continua como está.

Saem `editor-shell.js` (2.993 linhas), `studio-sdk-editor.js` e a dependência `grapesjs`.
Entra o host do Puck, que não escreve markup de elemento — só consome o catálogo.

**Prova:** abrir uma landing existente no editor novo e publicar; o HTML publicado tem de
sair equivalente ao de hoje, sem framework e sem classe estranha. Teste de que o allowlist
serve o bundle e que nenhum arquivo de editor antigo continua referenciado.

### 1.3 Migração das páginas que já existem

As páginas guardam projeto do GrapesJS em `editor_state`. O Puck guarda JSON de blocos.
São formatos diferentes e a conversão não é automática.

Caminho: ler o HTML publicado de cada página e mapear as seções conhecidas para blocos do
catálogo; o que não mapear vira um bloco `HTML bruto`, que preserva o conteúdo sem fingir
que entendeu. Nenhuma página perde conteúdo; algumas ficam menos editáveis até serem
refeitas.

**Prova:** teste com as páginas reais do banco de desenvolvimento, afirmando que o HTML
publicado antes e depois da migração é equivalente.

### 1.4 A Jornada do quiz

O quiz deixa de ser página com marca e passa a ser o que a spec descreve: uma máquina de
estados — telas, ordem, respostas — sobre o mesmo catálogo. `kind = 'quiz'` continua
marcando qual é qual; o que muda é o editor mostrar telas em vez de uma página só.

`jornada-modelo.js` (sem DOM), `jornada-editor.js` (sobre o Puck) e `jornada-runtime.js` (o
que vai publicado), como a spec já define.

**Prova:** um quiz de três telas montado no editor, publicado e percorrido no navegador,
com campo obrigatório segurando o avanço e as respostas chegando ao destino.

---

## Fase 2 — Alva Analytics

O Studio já tem coletor próprio em Node: `analytics-collect.mjs`, `analytics-journey.mjs`,
`analytics-repository.mjs` e cinco tabelas `analytics_*` com rollup diário. O Umami foi
adotado depois, e hoje os dois coexistem — o resumo vem do Umami, a jornada vem do banco
próprio, e um comentário no código chama o caminho próprio de "legado".

A decisão deste plano reverte a direção: **o caminho próprio é o que fica.** Ele já responde
o que a tela pede, está em Node, e não custa dois containers.

O que falta para a paridade precisa ser medido antes de desligar o Umami, não depois:
comparar o resumo dos dois lados no mesmo intervalo e listar o que só o Umami responde.

- `UMAMI_RUNTIME_ENABLED` passa a falso por padrão e depois some, junto de
  `umami-analytics.mjs`, `umami-analytics-reader.mjs`, `umami-gateway.mjs`, da imagem e do
  `umami-postgres`.
- A tela passa a dizer Alva Analytics.

**Prova:** o mesmo projeto e o mesmo intervalo dão números equivalentes nos dois caminhos
antes de o Umami sair; depois de sair, a tela de Analytics continua respondendo.

**Ganho:** dois containers.

---

## Fase 3 — Alva Tracking

O NVS Core são 12.248 linhas de PHP com MariaDB, das quais a camada Alva usa 222 linhas de
adaptadores — Meta, TikTok, Google, LinkedIn, Taboola — mais bootstrap, migrações e worker.

Portar para Node significa reescrever o que é usado, não as 12 mil linhas: receber o evento,
deduplicar, enfileirar, enviar ao destino, repetir com recuo quando falhar. As tabelas
nascem no Postgres do Studio, e o outbox comercial que já existe é a base.

O caro aqui não é o adaptador, é o que o Core aprendeu sobre deduplicação, limite de taxa e
retentativa. Essa parte é para ler com cuidado e portar com teste, não reescrever de memória.

- Sai `runtime/nvs/` inteiro: o submódulo do Core, o gateway, o outbox worker e o MariaDB.
- O `nvs-commercial-outbox` do Studio absorve a função e passa a se chamar Alva Tracking.

**Prova:** o mesmo evento produz a mesma chamada ao destino nos dois caminhos, comparadas
lado a lado, incluindo o que acontece quando o destino recusa e quando repete.

**Ganho:** três containers.

---

## Ordem, e por quê

1. **Catálogo** (1.1) — nada depende dele estar pronto, e tudo depende dele existir.
2. **Puck no editor** (1.2) e **migração** (1.3) — juntos, porque um editor novo sem as
   páginas antigas é um editor que ninguém pode usar.
3. **Jornada** (1.4) — depende do catálogo e do host.
4. **Redução dos containers** — juntar os quatro workers num só e pôr Umami e NVS em perfil
   opcional. Uma hora de trabalho, independente de tudo acima, e derruba de onze para
   quatro no dia a dia mesmo antes das fases 2 e 3.
5. **Alva Analytics** (Fase 2).
6. **Alva Tracking** (Fase 3) — por último porque é o de maior risco: é o que fala com
   dinheiro de anúncio.

O passo 4 pode ser feito a qualquer momento e entrega o alívio imediato; as fases 2 e 3
tornam a redução definitiva em vez de opcional.

## Riscos

- **A migração das páginas antigas.** É o ponto onde conteúdo pode se perder. O bloco de
  HTML bruto é a rede de segurança: preserva sem fingir que entendeu.
- **React no editor.** Duas tecnologias no front, com fronteira no editor. Aceitável
  enquanto a fronteira for explícita; ruim se React vazar para o app ou para o publicado.
- **Paridade do analytics.** Desligar o Umami antes de medir a paridade é como trocar de
  régua no meio da obra. Medir primeiro.
- **Deduplicação do tracking.** Evento duplicado em API de conversão significa métrica
  errada e decisão de mídia errada. É o item que mais merece teste.
- **O catálogo duplicar.** Se a Jornada ganhar um `render` próprio "só para este caso", o
  erro de 2026-09-08 volta inteiro. Dois hosts podem existir; dois catálogos, não.

## Seções do wireframe citadas

"Biblioteca visual" (tipografia, botões, cores, campos, item da árvore e opção visual),
"ELEMENTO · Escolha visual", "Estrutura do projeto" e "Visitas nos últimos 7 dias".
