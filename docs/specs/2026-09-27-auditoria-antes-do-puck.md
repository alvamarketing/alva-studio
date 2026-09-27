# Auditoria antes do Puck

27/09/2026. Pedida pelo dono antes de seguir: "estamos no ponto importante, não
vamos cometer erros aqui". Cada afirmação abaixo foi verificada contra o código
e o repositório nesta data, não de memória.

## Estado

`main` limpa, **1180 testes verdes**. Nada em produção, nenhum cliente,
`CONVERSIONS_ENABLED=false`. Os defeitos abaixo não causaram dano real — mas
três commits em `main` afirmam coisas que não são verdade.

---

## Defeitos encontrados

### 1. IP e navegador enviados são os do gateway, não os da pessoa — GRAVE

Commit `9cb27de` ("o endereço e o navegador de quem converteu vão junto").

A página publicada fala com o Studio **através do gateway da Vercel**, e o
gateway repassa só quatro cabeçalhos: `content-type`, `cookie`, `origin`,
`accept`. Isso vale nas duas cópias — o gateway em Node
(`vercel-runtime-gateway.mjs:63`) e o módulo publicado na Vercel.

Logo, nos dois caminhos principais de lead — captura de página e quiz —,
`clienteDaRequisicao(req)` lê:

- **user-agent**: o do `fetch` da função da Vercel, igual para todo visitante;
- **IP**: o que o proxy do Studio põe em `x-forwarded-for` — o da função da
  Vercel, público, igual para muitos visitantes. O filtro de rede privada não o
  pega.

O efeito não é ausência de sinal: é **sinal falso**. A Meta veria todos os leads
vindo do mesmo endereço e do mesmo navegador, o que piora a correspondência — o
problema exato que o commit diz ter evitado.

E a nota de correspondência herda o erro: ela daria pontos por IP e navegador
presentes, quando o que está presente é o do gateway.

**Por que os testes passaram:** alimentam `cliente: { ip: '203.0.113.7', ... }`
direto na fila. Nenhum atravessa o gateway.

No caminho da VSL o dano é menor: o coletor recebe direto do navegador, então o
user-agent é o certo, e o IP lido do socket é o do proxy — rede privada,
descartado. Degrada, não mente.

### 2. O esquema tem desenho próprio de elemento — dois catálogos

Commit `3c931a8`. O plano do Puck fecha com: *"Dois hosts podem existir; dois
catálogos, não."* O `page-schema.js` nasceu com sua própria função de desenho
para cada tipo, ao lado da do `catalogo-elementos.js`. Mesmo erro que originou o
plano do catálogo em 2026-09-08.

### 3. Três tipos do esquema emitem classe sem regra — sairiam sem estilo

Mesmo commit. Verificado contra todas as folhas (`elementosCss`,
`quizElementCss`, `templateCss`, `styles.css`):

| Classe | Regra |
|---|---|
| `.alva-colunas` | **não existe** |
| `.alva-imagem` | **não existe** |
| `.alva-formulario` | **não existe** — o CSS de formulário é `.alva-form` |

O commit afirma que "o HTML que sai é idêntico ao que o editor produzia". Só é
verdade para seção, título, texto, botão, ícone e campo — os que o teste cobre.

### 4. A VSL do esquema não seria encontrada pela publicação

Mesmo commit. A publicação procura o atributo `data-alva-vsl`
(`publication-snapshot.mjs:179,192`); o esquema emite `data-vsl-id`. Uma VSL
numa página do esquema sumiria da página publicada, sem erro.

### 5. O plano que escrevi tem a ordem errada

Commit `7081f1b`, `docs/specs/2026-09-26-esquema-proprio-de-pagina.md`.

- O passo 3 (servidor renderiza do esquema) depende do passo 4 (editor escreve o
  esquema). Na ordem escrita, o 3 exigiria um conversor ao vivo que nasce para
  ser jogado fora.
- A spec diz que "o conversor desaparece". Desapareceu o conversor de **dados
  gravados**; o conversor **ao vivo** não.
- O plano anterior (`2026-09-25-puck-e-alva-nativo.md`) diz "o servidor não é
  tocado"; o novo diz que o servidor renderiza. Os dois não foram reconciliados
  por escrito.

---

## O padrão por trás

Os dois defeitos graves — o 1 e os do esquema — têm a mesma origem: **testar a
peça com entrada inventada, em vez do caminho real.** O teste do IP nunca passou
pelo gateway; o teste do esquema só cobriu os tipos que davam certo.

É a mesma família da cadeia de atribuição de ontem, em que cada lado era testado
com uma forma que a produção nunca produzia. Eu consertei aquela e repeti o erro
nos dois commits seguintes.

A regra que fica: **toda cadeia tem pelo menos um teste que atravessa o caminho
de produção de ponta a ponta**, sem pular a camada que parece óbvia.

## O que continua de pé

Conferido e mantido:

- A cadeia do identificador de clique: gateway assina a partir do `Referer`,
  `cookie` é repassado pelo gateway, o Studio verifica e enfileira, o adaptador
  lê `click_ids`. Cada elo tem teste, e os elos se encontram.
  **Risco residual:** não há um teste único que leve uma requisição HTTP real,
  com o cookie, até o payload da fila. Cada elo foi provado; a corrente inteira,
  não.
- O `_fbp` lido do cookie no gateway: coerente com o que o navegador manda, mas
  **só testado em unidade** — nunca com um pixel real numa página publicada.
- A tela de pixels, a nota de correspondência e o contexto do funil: verificados
  contra o app rodando, com dados no banco.
- A extração de captura sobre o esquema: correta para a árvore do Alva.

---

## Passo a passo corrigido

Nada novo é construído antes de `main` voltar a dizer só a verdade.

### Fase A — Consertar o que está errado em `main`

**A1. IP e navegador pelo gateway.** O gateway passa a repassar o IP e o
navegador de quem visita **dentro da assinatura HMAC** — hoje ela cobre método,
caminho, publicação, ambiente, instante, nonce e corpo, mas nenhum cabeçalho. O
Studio só confia nesses valores quando vierem assinados. Enquanto isso não
existir, o caminho do gateway **não envia** IP nem navegador: nada é melhor que
falso.
*Prova:* uma requisição que atravessa `forwardRuntimeGatewayRequest` até a fila,
e o payload leva o IP da pessoa, não o do gateway.

**A2. Registro honesto.** Os commits já estão no GitHub e não se reescreve
histórico publicado. Commit corretivo com esta auditoria, e as specs ajustadas.

### Fase B — O esquema, do jeito certo

**B1. Um catálogo só.** O esquema consome o desenho do catálogo; não carrega
desenho próprio. Teste que falha se `page-schema.js` voltar a escrever marcação.

**B2. Toda classe emitida tem regra.** Colunas, imagem e formulário passam a usar
classes que existem — formulário usa `.alva-form`. Teste sobre todas as folhas.

**B3. VSL com o marcador que a publicação lê.** `data-alva-vsl`.
*Prova:* uma página do esquema com VSL, e a publicação a encontra.

### Fase C — Puck

**C1.** React e bundler confinados ao editor, como o plano de 25/09 já decidiu.
Medir o peso, confirmar o allowlist, e confirmar que nada de React vaza para o
runtime publicado.

**C2.** O Puck lê e escreve o esquema, consumindo o catálogo.

**C3.** O servidor renderiza a partir do esquema, para páginas do editor novo. O
caminho do GrapesJS fica intocado até o novo estar provado.

**C4.** Verificação visual contra o wireframe, em 1440×900 e 390×844, e registro
em `.estado/`.

Cada passo termina verde e commitado antes do próximo começar.
